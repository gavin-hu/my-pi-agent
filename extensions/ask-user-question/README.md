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

```
──────────────────────────────────────────────────────────
 ←  ■ Auth   □ Scope   □ Format   ✓ Submit →
──────────────────────────────────────────────────────────
  Which authentication should we use?

> 1. OAuth
     Uses the provider's OAuth flow
  2. Session cookies
     Simpler, server-side sessions
  3. Other (type something)

  Tab/←→ navigate · ↑/↓ select · Enter confirm · Esc cancel
──────────────────────────────────────────────────────────
```

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
carried on the tool result and drive the transcript rendering:

```
✓ Auth: 1. OAuth
✓ Scope: 2. repo, 4. read:org
✓ Format: (wrote) json for logs
```

## Modes

| Mode | Behavior |
|---|---|
| Interactive TUI | Full tabbed questionnaire with descriptions, multi-select, and an inline editor |
| RPC (`hasUI`) | Forwarded dialogs: `select` per question, `input` for “Other”/free-form, `editor` for multi-select |
| `print` / `json` | The tool is registered inactive (`defaultActive: false`) and never switched on; if invoked anyway it returns a clear error telling the model to ask in prose |

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

## Configuration

None in v1 — the tool is either available (a UI exists) or not.

## Testing

```bash
bun test test/ask-user-question
bun run check
```

The suite covers the pure logic (`schema.ts`, `answers.ts`, `tui-state.ts`), the
dialog fallback with a fake UI, the TUI component's render/wiring, and extension
registration/activation with a fake `pi`. No terminal is required.

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

See [`DESIGN.md`](./DESIGN.md) for the full design and rationale.
