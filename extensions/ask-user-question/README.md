# ask-user-question — structured questions for Pi

A single model-facing tool, `ask_user_question`, that lets the model ask the
human one or more structured questions mid-turn and wait for typed answers.
Modelled on Claude Code's `AskUserQuestion`.

```
pi --extension ./extensions/ask-user-question   # load just this extension
pi -e .                                         # load the whole @gavin-hu/my-pi-agent package
pi install ./                                   # install the package
```

## What it does

The model calls `ask_user_question` with 1–4 questions. Each question offers up
to four labelled options (plus an automatic **“Other (type something)”** free-form
entry); a question with no options asks for free-form text. The tool blocks until
the user answers or cancels, then returns the answers as text the model can act
on.

- Multiple questions: a tab bar, per-question answered indicators, and a Submit
  tab that refuses to submit until every question is answered.
- `multiSelect: true`: `Space` toggles options, `Enter` confirms the set.
- `Esc` cancels; the model receives “User cancelled the question.” and can
  continue or ask in prose.

## Tool

| | |
|---|---|
| Name | `ask_user_question` |
| Exposure | `model-only` (declared to the model, not callable from codemode scripts) |
| Annotations | read-only, not destructive, not open-world |
| Execution | sequential |

### Parameters

```jsonc
{
  "questions": [
    {
      "question": "Which authentication should we use?",
      "header": "Auth",              // optional short tab label (≤12 chars)
      "options": [                   // omit or empty for a free-form question
        { "label": "OAuth", "description": "Uses the provider's OAuth flow" },
        { "label": "Session cookies" }
      ],
      "multiSelect": false           // optional, default false
    }
  ]
}
```

Limits (enforced before any UI opens; an invalid call returns a failed result the
model can correct): 1–4 questions, 0 or 2–4 options per question, unique labels,
unique headers.

### Result

```
Auth: user selected: 1. OAuth
Scope: user selected: 2. repo, 4. read:org
Format: user wrote: json for logs
```

Structured details (`questions`, `answers`, `cancelled`, `unavailable`) are
carried on the tool result and drive the transcript rendering. The call line
lists the headers and one option line per question; the result renders one line
per answer:

```
ask_user_question 2 questions (Auth, Scope)
  Auth: OAuth, Session cookies, Other
  Scope: repo, admin, Other

✓ Auth: 1. OAuth
✓ Scope: 2. repo, 4. read:org
✓ Format: (wrote) json for logs
```

## Behaviour by mode

| Mode | Behavior |
|---|---|
| Interactive TUI (local turn) | Full tabbed questionnaire with descriptions, multi-select, and an inline editor |
| RPC (`hasUI`) | Forwarded dialogs: `select` per question, `input` for “Other”/free-form, `editor` for multi-select |
| Remote turn (WeChat) | Same forwarded dialogs, routed to the remote channel by the `ctx.ui` adapter; the full-screen component is skipped |
| `print` / `json` | The tool is registered inactive (`defaultActive: false`) and never switched on; if invoked anyway it returns a clear error telling the model to ask in prose |

Whether a turn uses the rich component or dialogs is decided by
`askHuman(ctx, { custom, dialogs })` from `lib/interaction.ts`, not by reading
`ctx.mode`; a remote-answered turn reports no custom-UI support.

## Configuration

None in v1 — the tool is either available (a UI exists) or not.

## Limitations

- The tool must be the only thing the model is waiting on; it runs sequentially.
- Multi-select in RPC is a prefilled editor where the user types numbers or
  labels, because RPC cannot forward a custom multi-select component.
- There is no timeout: the question waits until the user answers, cancels, or
  the turn is aborted. An aborted turn dismisses the TUI component and the
  forwarded `select`/`input` dialogs and returns `cancelled` (the RPC
  multi-select editor has no abort signal).
- In a child `pi` process (a subagent) there is no UI, so the tool stays
  inactive; the subagent cannot ask and should report the open question back to
  the parent instead.

## Non-goals

- Not a prompt template or a `/`-command that asks the *model* something
  (that is `qna`-style tooling).
- Not a replacement for plain-text questions when there is no UI.
- No cross-session persistence: the answer lives in the tool result, which is
  already branch-scoped session state.

## Pi integration

| Integration point | Value |
|---|---|
| Tool | `ask_user_question`; `exposure: "model-only"`, `defaultActive: false`, activated in `session_start` when `ctx.hasUI` is true. |
| Execution | `executionMode: "sequential"`. |
| Annotations | `readOnlyHint: true`, `openWorldHint: false`, `destructiveHint: false`. |
| Output schema | None. Structured data is returned as tool-result `details` (not `structuredContent`). |
| State storage | Tool-result `details` (`questions`, `answers`, `cancelled`, `unavailable`). No `pi.appendEntry`. |
| Lifecycle | `session_start` only: add the tool to the active set when a UI exists. No `session_shutdown`. |

## Design notes

- **One reviewed, tested tool.** The model otherwise asks in prose (a wasted
  turn, unstructured answers) or a bespoke extension registers its own one-off
  `question`/`questionnaire` tool; this packages a single implementation modelled
  on Claude Code's `AskUserQuestion`.
- **`model-only` exposure, declared and activated.** `model-only` is the
  recommended exposure for tools that ask the user. It is still declared, so it
  works in interactive and RPC sessions; in `print`/`json` it is left inactive so
  the model is never offered a tool that cannot work. A `tool_call` guard is
  unnecessary because `execute()` still degrades safely.
- **A `QuestionUI` seam for the fallback.** The dialog driver depends on a small
  `select`/`input`/`editor` interface rather than `ctx`, so it is unit-testable
  with a fake and reusable by another host.
- **Capability, not mode.** `execute()` calls `askHuman` so a remote-answered
  turn takes the dialog path while a local TUI turn keeps the component. Adding a
  new rich interaction means supplying both `custom` and `dialogs` thunks to
  `askHuman`; interaction built only from standard dialogs supports remote turns
  for free.
- **A pure state machine behind the TUI.** `tui-state.ts` holds a reducer
  (`reduce(state, action) → { state, effect }`) so navigation, toggling, tab
  movement, and submit gating are tested without a terminal; `tui.ts` only maps
  state to lines and forwards input. Render output is cached and cleared from
  `invalidate()`, and themed strings are never stored across renders.
- **Claude-Code-compatible parameter shape.** `{ label, description? }` options
  with 1–4 questions and 0 or 2–4 options per question mirror the model's prior.
  “Other (type something)” is always appended unless there are no options, in
  which case the editor opens directly.
- **Cancellation is not an error.** `cancelled: true` with
  `"User cancelled the question."` lets the model proceed or ask in prose; only
  the no-UI path returns `isError: true`.
- **Transcript rendering is driven by `details`.** `renderCall` summarises the
  question count and headers and lists one option line per question;
  `renderResult` renders `✓ Auth: 1. OAuth` per answer, `(wrote)` for custom
  text, warning-colored `Cancelled`, and dim `No UI` when unavailable.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Extension factory: register the tool, gate it by UI availability |
| `schema.ts` | TypeBox parameters, validation, defaulting (pure) |
| `types.ts` | Shared raw/normalized types |
| `answers.ts` | Answer normalization and model-facing formatting (pure) |
| `tui-state.ts` | Pure keyboard/navigation state machine |
| `tui.ts` | Custom terminal component (render + input) |
| `dialogs.ts` | `select`/`input`/`editor` fallback driver |
| `tools.ts` | Tool registration and transcript renderers |

## Testing

```bash
bun test extensions/ask-user-question
bun run check
```

The suite covers the pure logic (`schema.ts`, `answers.ts`, `tui-state.ts`), the
dialog fallback with a fake UI, the TUI component's render/wiring, and extension
registration/activation with a fake `pi`. No terminal is required.
