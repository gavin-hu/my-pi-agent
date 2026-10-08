# `ask_user_question` — Design

Status: **implemented** (see [`README.md`](./README.md)). The open questions below
are resolved as noted.

## Goal

Give the model a first-class way to ask the human one or more *structured*
questions mid-turn and get typed answers back, modelled on Claude Code's
`AskUserQuestion` tool — the same symmetry `pi-worktree` has with
`EnterWorktree`.

Today the model either asks in prose (a full turn is spent, and answers are
unstructured) or a bespoke extension (`question`, `questionnaire` in the Pi
examples) registers its own one-off tool. This extension packages one reviewed,
tested implementation.

## Non-goals

- Not a prompt template or a `/`-command that asks the *model* something
  (that is `qna`-style tooling).
- Not a replacement for plain-text questions when there is no UI.
- No cross-session persistence: the answer lives in the tool result, which is
  already branch-scoped session state.

## Model surface

| Field | Value |
|---|---|
| `name` | `ask_user_question` |
| `label` | `Ask user` |
| `exposure` | `model-only` (declared to the model, not callable from `ctx.executeTool`/codemode) |
| `executionMode` | `sequential` |
| `annotations` | `readOnlyHint: true`, `openWorldHint: false`, `destructiveHint: false` |
| `promptSnippet` / `promptGuidelines` | short “ask the user before guessing” guidance |

`model-only` is the exposure the extension docs recommend for tools that ask the
user. Because it is still *declared*, the tool is available in interactive and
RPC sessions; in `print`/`json` mode the extension leaves it **inactive** (see
[Activation](#activation)) so the model is never offered a tool that cannot work.

### Parameters (TypeBox)

Mirrors Claude Code's shape so the model's prior is useful:

```ts
ask_user_question({
  questions: [
    {
      question: string,            // full question text
      header?: string,             // short tab label, ≤ 12 chars; defaults Q1, Q2…
      options?: {                  // omitted/empty ⇒ free-form only
        label: string,             // what the model receives back
        description?: string,      // secondary line in the picker
      }[],
      multiSelect?: boolean,       // default false
    },
  ],
})
```

Limits enforced in `schema.ts` (invalid input ⇒ thrown error result, model can
retry):

- 1–4 questions
- 0 or 2–4 options per question (0 = free-form only; 1 is rejected as ambiguous)
- `header` truncated to 12 columns, duplicate headers rejected
- at least one answerable question after normalization

Always appended to the option list in the UI: **“Other (type something)”**,
unless `options` is empty (then the editor opens directly). This matches Claude
Code, which always offers a free-form escape hatch.

### Result

```ts
// content (model-facing text), e.g.
// Q1 (Auth): user selected: 2. OAuth
// Q2 (Scope): user wrote: only the settings screen

// details (renderer + tests)
{
  questions: Question[],
  answers: {
    id: string,
    header: string,
    question: string,
    values: string[],     // machine values (labels, or typed text)
    labels: string[],     // display labels
    wasCustom: boolean,
    indices?: number[],   // 1-based option numbers, when picked
  }[],
  cancelled: boolean,
  unavailable?: boolean,
}
```

Cancellation is **not** an error: the model receives
`"User cancelled the question."` with `cancelled: true` so it can proceed or ask
in prose. No-UI execution returns `isError: true` with
`"No interactive UI available; ask the user in your reply instead."`.

## Behavior by mode

`ctx.mode`/`ctx.hasUI` decide which driver runs:

| Mode | Driver | Notes |
|---|---|---|
| `tui` | custom component (`tui.ts`) | Full tabbed UI: descriptions, multi-select, inline “Other” editor |
| `rpc` (`hasUI`, not tui) | dialog fallback (`dialogs.ts`) | `ui.select` per question; “Other…” → `ui.input`; multi-select via `ui.editor` with a numbered list |
| `print` / `json` | none | Tool kept inactive at `session_start` |

The fallback driver depends on a small `QuestionUI` interface
(`select`/`input`/`editor`) rather than `ctx`, so it is unit-testable with a
fake and reusable by another host.

## TUI component

Based on the Pi `questionnaire.ts` example, with the interaction state machine
extracted for testing.

- Tab bar across questions + a Submit tab; `□`/`■` for answered state.
- Single question ⇒ no tab bar, selection submits immediately.
- `↑`/`↓` move, `Enter` confirms, `Esc` cancels.
- `multiSelect`: `Space` toggles, `Enter` confirms the set, at least one required.
- “Other” opens an inline `Editor`; `Esc` there returns to the list.
- Descriptions render as a muted second line, wrapped with
  `wrapTextWithAnsi`/`visibleWidth` so wide characters and ANSI stay correct.
- Render output is cached and cleared from `invalidate()`; themed strings are
  never stored across renders.

`tui-state.ts` holds a pure reducer (`key(state, key) → state' | submit | cancel`)
so navigation, toggling, tab movement, and submit gating are tested without a
terminal. `tui.ts` only maps reducer state to lines and forwards input.

### Rendering the transcript

- `renderCall`: `ask_user_question 2 questions (Auth, Scope)` plus dim option
  labels.
- `renderResult`: `✓ Q1 (Auth): 2. OAuth` per answer, `(wrote)` marker for
  custom text, warning-colored `Cancelled`, dim `No UI` when unavailable.

## Visual reference (mockups)

Sketches for an 80-column terminal; the rules shrink to the available width. The
`>` marker and colored labels come from theme tokens (`accent` for selection,
`muted` for descriptions, `success` for answered/submitted, `warning` for
cancel, `dim` for the help line).

### Single question

```text
──────────────────────────────────────────────────────────
  Which authentication should we use?

> 1. OAuth
     Uses the provider's OAuth flow
  2. Session cookies
     Simpler, server-side sessions
  3. API keys
     Good for machine clients
  4. Other (type something)

  ↑/↓ navigate · Enter select · Esc cancel
──────────────────────────────────────────────────────────
```

One question has no tab bar: `Enter` on an option submits immediately.

### Multiple questions (tab bar + Submit)

```text
──────────────────────────────────────────────────────────
 ←  ■ Auth   □ Scope   □ Format   ✓ Submit →
──────────────────────────────────────────────────────────
  Which authentication should we use?

> 1. OAuth
     Uses the provider's OAuth flow
  2. Session cookies
     Simpler, server-side sessions
  3. API keys
     Good for machine clients
  4. Other (type something)

  Tab/←→ navigate · ↑/↓ select · Enter confirm · Esc cancel
──────────────────────────────────────────────────────────
```

`■` marks an answered question (`success`, `□` while unanswered); the active tab
is drawn with `selectedBg`.

### Multi-select question

```text
──────────────────────────────────────────────────────────
 ←  ■ Auth   ■ Scope   □ Format   ✓ Submit →
──────────────────────────────────────────────────────────
  Which scopes should the token request?

  1. [ ] read:user
        Read the user's profile
  2. [x] repo
        Read and write repositories
> 3. [ ] read:org
        Read the user's org memberships
  4. Other (type something)

  ↑/↓ move · Space toggle · Enter confirm · Esc cancel
  Selected: repo
──────────────────────────────────────────────────────────
```

`Enter` is gated until at least one option (or typed text) is chosen.

### “Other” — free-form answer

```text
──────────────────────────────────────────────────────────
  Which authentication should we use?

  1. OAuth
     Uses the provider's OAuth flow
  2. Session cookies
     Simpler, server-side sessions
  3. API keys
     Good for machine clients
> 4. Other (type something) ✎

  Your answer:
  mycompany-sso

  Enter to submit · Esc to go back
──────────────────────────────────────────────────────────
```

### Submit tab

```text
──────────────────────────────────────────────────────────
 ←  ■ Auth   ■ Scope   ■ Format   ✓ Submit →
──────────────────────────────────────────────────────────
  Ready to submit

  Auth:   1. OAuth
  Scope:  2. repo, 4. read:org
  Format: (wrote) json for logs

  Press Enter to submit
──────────────────────────────────────────────────────────
```

With an unanswered question instead:

```text
  Unanswered: Scope
```

### Cancel

```text
ask_user_question 2 questions (Auth, Scope)
```

```text
⚠ Cancelled
```

The model receives `"User cancelled the question."` with `cancelled: true`.

### Transcript rendering

```text
ask_user_question 3 questions (Auth, Scope, Format)
  Options: Auth: OAuth, Session cookies, API keys, Other
```

```text
✓ Auth: 2. OAuth
✓ Scope: 2. repo, 4. read:org
✓ Format: (wrote) json for logs
```

### RPC fallback (no custom components)

The RPC client renders each question through the forwarded dialogs:

```text
Which authentication should we use?
  1. OAuth
  2. Session cookies
  3. API keys
  4. Other (type something)
> _
```

Choosing “Other (type something)” follows with a text-input dialog; a
multi-select question opens a prefilled editor instead (`2, 4`).

### No UI (`print` / `json`)

The tool is not activated, so it never appears in the tool list. If it is
somehow invoked, the model gets an error result:

```text
No interactive UI available; ask the user in your reply instead.
```

## Activation

The tool is registered with `defaultActive: false` and switched on in
`session_start` only when `ctx.hasUI` is true. Resumed sessions and RPC clients
get it; `--print`/`--json` runs never expose it, even if `session_start` is not
dispatched in a host. A `tool_call` guard is unnecessary — `execute()` still
degrades safely if invoked.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: register tool, activation on `session_start` |
| `schema.ts` | TypeBox schema, normalization, validation, id/header defaults (pure) |
| `types.ts` | `Question`, `Answer`, `Result` shared types |
| `answers.ts` | Answer collection → model text + `details` (pure) |
| `tui-state.ts` | Pure keyboard/navigation state machine |
| `tui.ts` | Custom component: render + input |
| `dialogs.ts` | RPC/no-custom fallback over `QuestionUI` |
| `tools.ts` | `registerTool` + `renderCall`/`renderResult` |
| `README.md` | User-facing docs (written at implementation) |

`package.json` gains `"./extensions/ask-user-question/index.ts"` in
`pi.extensions`, and the root `README.md` contents table gains a row.

## Testing

`bun test` suite under `test/ask-user-question/`, following the worktree
conventions (module mocks for `typebox` / the host package, fake `pi`/`ctx`):

- `schema.test.ts` — defaults, id derivation, header truncation, all limits.
- `answers.test.ts` — single, multi, custom, mixed, cancel, unavailable.
- `tui-state.test.ts` — navigation, tab cycling, multi-select toggle, submit
  gating, cancel.
- `dialogs.test.ts` — fallback sequencing (select → input, editor for
  multi-select), cancel propagation, no-UI path, using a fake `QuestionUI`.
- `tui.test.ts` — component render and wiring with a fake tui/theme: options,
  tabs, free-form editor, multi-select highlight, submit, and cancel.
- `extension.test.ts` — fake `pi`: tool registered with `exposure: "model-only"`
  and `defaultActive: false`, activated on `session_start` when `hasUI`, safe
  degradation in print mode.

No terminal is required for any test. `bun run check` stays green.

## Milestones

- **M1** — schema + answers + `ask_user_question` tool + TUI single/multi-select
  + renderers + unit tests.
- **M2** — RPC dialog fallback, activation gating, README, root README row.
- **M3** — polish: abort-signal handling (done: the component and forwarded
  dialogs are dismissed and return `cancelled`), narrow-width and theme-change
  checks, and a decision on optional configuration (skipped).

## Open questions (resolved)

1. **Name.** `ask_user_question` (snake_case, like `worktree_enter`). ✅
2. **Multi-select in v1?** Included — `multiSelect: true`, `Space` toggles. ✅
3. **Option shape.** `{ label, description? }` (Claude Code-style; the label is
   the value). ✅
4. **Free-form-only questions.** Allowed: `options: []` opens the editor
   directly. ✅
5. **RPC multi-select fallback.** `ui.editor` with a numbered list and
   number/label parsing; unrecognised input is kept as free-form text. ✅
6. **Config.** None in v1. ✅
7. **Abort.** Wired: `signal` aborts the custom component and the forwarded
   dialogs, returning `cancelled`. ✅
