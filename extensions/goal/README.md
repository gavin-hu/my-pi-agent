# goal — a persistent session objective for Pi

A single high-level objective for the session, kept visible and restated before
every turn. The goal is the *what*; the [`todo`](../todo/) list is the *how*.

```bash
pi --extension ./extensions/goal    # load just this extension
pi -e .                             # load the whole @gavin-hu/my-pi-agent package
pi install ./                       # install the package
```

## What it does

- Registers one model-callable tool, `goal`, that records the session
  objective. Send the complete objective every call; an empty objective clears
  it.
- Tracks `status`: `active` while the goal is being pursued, `achieved` when it
  is done.
- Shows a persistent one-line rail above the editor whenever a goal exists,
  label-first to match the [`todo`](../todo/) widget, pinned at the top of the
  `Goal / Todos` stack when both are loaded:

  ```
  Goal · active · Refactor the parser to support streaming input and ship it …
  ```

  Once achieved the goal is hidden from the widget by default, matching a
  completed todo list; the transcript keeps the record. Set `achieved: "show"`
  in `.pi/goal.json` to keep drawing the dimmed line instead.

- Restates an **active** goal to the model before each turn (an invisible
  `[SESSION GOAL]` message), so it stays on task across long tool sequences.
- Stores tool-set goals in tool-result `details` and command-set goals as a
  `goal` session entry, so either way the goal follows the active session branch
  and survives `/resume` and `/tree` — abandoned branches never leak into the
  current goal.
- Classifies the goal prompt before recording it: `/goal <prompt>` asks the
  session model for one clear, actionable rewrite and, when the goal is too
  vague to act on, up to three clarifying questions. A clear goal is confirmed or
  edited; an unclear one is handed to the agent to ask with
  [`ask_user_question`](../ask-user-question/) before the agent records the
  clarified goal. `/goal set <prompt>` reuses that step but records without
  starting a turn, and `/goal edit` changes the current goal in place. The step
  is best-effort and needs a dialog UI plus a model; the `goal` tool stays the
  silent setter.

## Tool

`goal` is a whole-goal replacement tool. It declares an `outputSchema` and
returns matching `structuredContent` (`{ goal, action, error? }`, with
`goal: null` after a clear), so codemode/scripts can read the goal as data.

| Field | Value |
|---|---|
| `name` | `goal` |
| `objective` | The complete objective, one line. Pass `""` to clear. |
| `status` | `active` (default) or `achieved`. |
| `exposure` | `direct` (default). |
| `executionMode` | `sequential` — calls share the in-memory goal. |
| `annotations` | `idempotentHint: true` (a snapshot write), not read-only. |
| `outputSchema` | `GoalResult` — `{ goal, action, error? }`, also returned as `structuredContent`. |
| `promptGuidelines` | Carry the when-to-use rule and the mark-achieved-with-a-blank-objective rule; the replacement/clear semantics live in the description. |

Validation (a violation returns an error result and leaves the goal unchanged):
a known `status`, an objective of at most 2000 characters, and a non-blank
objective when `status` is `achieved`. A blank objective clears only an
active/default goal; completing a goal requires resending its objective, so
"mark done" can never be mistaken for "forget".

Before those checks, the objective is normalized to a single terminal-safe
line: control characters (including `ESC`) become spaces and any whitespace run
(newlines, tabs, repeated spaces) collapses to one space. This keeps the widget
to one logical line and stops model text from injecting terminal sequences.

`goal` is allowlisted in `plan-mode` (alongside `todo`), so the model can record
or update the objective during read-only exploration without leaving plan mode.

### `/goal` command

The command has no tool result, so it persists each change as a `goal` custom
entry; `reconstructGoal` replays both entry kinds in branch order.

| Command | What it does |
|---|---|
| `/goal` | Show the current goal, or the command usage when none is set. |
| `/goal <prompt>` | Classify `<prompt>` with one model call, then set the goal and start the run. A clear goal opens in a confirm/edit dialog; an unclear one with questions is delegated to the agent's `ask_user_question` tool, after which the agent records the clarified goal. |
| `/goal set <prompt>` | The same classify and confirm/edit step, but record the goal without starting a run. |
| `/goal set` (or `/goal edit`) | Open the editor prefilled with the current goal and save it as the active goal, without starting a run. |
| `/goal done` (or `/goal achieved`) | Mark the current goal achieved. |
| `/goal clear` | Clear the goal. |
| `/goal help` (or `-h` / `--help`) | Show the command usage. |

`/goal <prompt>` classifies only when a dialog UI and a session model are present
(TUI or RPC). In print and JSON mode the typed text is set and run unchanged. A
failed, timed-out, or unusable clarification falls back to the typed text;
dismissing the confirm/edit dialog cancels the command, changing nothing. When
the clarifier is unclear, the goal is delegated only if `ask_user_question` is
active (its extension is loaded with a UI); otherwise the proposed goal opens in
the confirm/edit dialog instead. A delegated goal is not set by the command: the
agent asks the questions, then records the clarified objective with the `goal`
tool. A plain-text clarifier reply is still accepted and treated as a clear
rewrite, so a model that ignores the JSON instruction still clarifies.
`/goal set <prompt>` follows the same path but stops before the run; a delegated
record-only goal tells the agent not to start the work. A bare `/goal set` and
`/goal edit` need a dialog UI — without one they show the usage instead.

## Behaviour by mode

The tool works in every mode. The persistent widget requires interactive
(`tui`) mode; the reminder and the `/goal` command work everywhere. The
`/goal <prompt>` classify step uses a cancellable `tui` spinner in interactive
mode and the host dialogs in RPC; in print and JSON mode it is skipped and the
typed text is sent. When it delegates clarification, the questions are asked by
the running agent through `ask_user_question`, so they use that extension's
questionnaire. The widget is always a single line; the transcript result
keeps the full glyph rail, separated from the call line by a blank line:

```
goal → set: Refactor the parser to support streaming input

Goal · active
  ◎ Refactor the parser to support streaming input and ship it with tests
```

The renderer reuses the slot's component (`context.lastComponent`) rather than
rebuilding it each render. Achieved goals are hidden from the widget by default
(restore the dimmed line with `achieved: "show"`), and they are no longer
restated to the model. While a dock screen is open (`/todos`, `/jobs`,
`/rewind`, or the ask-user-question questionnaire), the rail is hidden and
returns on close.

## Configuration

The widget presentation is configurable from `~/.pi/agent/goal.json` and
`<cwd>/.pi/goal.json` (project values override global):

| Key | Default | Meaning |
|---|---|---|
| `achieved` | `"hide"` | How an achieved goal renders in the one-line widget: `show` draws the dim line, `hide` removes it. |

Malformed files and invalid values are ignored, and goal behavior never depends
on config.

## Non-goals

- No multiple or nested goals — one objective per session.
- No due dates, priorities, or success criteria — that is the todo list's job.
- No cross-session persistence beyond the session branch.
- No per-field edit tool; the model resends the whole goal.
- No automatic completion detection; the model (or `/goal done`) decides.
- No interception of ordinary user prompts — only the text passed to
  `/goal <prompt>` is clarified.

## Pi integration

| Aspect | Detail |
|---|---|
| Tool | `goal` (direct, active by default) |
| Command | `/goal` — show, clarify+set+run, record (`set`/`edit`), done/achieved, or clear |
| Execution mode | `sequential` — calls share the in-memory goal |
| Annotations | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| Output schema | `GoalResult` — `{ goal, action, error? }`, returned as `details` and `structuredContent` |
| State storage | tool-result `details` plus a `pi.appendEntry("goal", { goal })` custom entry for command-set goals |
| Lifecycle hooks | `session_start` (load config, reconstruct), `session_tree` (reconstruct), `session_shutdown` (clear widget); `before_agent_start` (inject `goal-context`), `context` (filter stale/duplicate reminders) |
| UI | `ctx.ui.setWidget` one-line rail in `tui` mode; coordinated through `pi.events` so it stays the top rail |
| Classify model call | `ctx.modelRegistry.complete` on the session model, 30 s timeout, `cacheRetention: "none"`; skipped without a dialog UI or a model; its usage is not counted in session totals |
| Clarification | When the goal is unclear, `/goal` sends the agent a delegation prompt naming `ask_user_question`; the agent asks, then sets the goal with the `goal` tool. No extra state is stored by the command. |

## Design notes

- **One goal, whole-value replacement.** `todo` replaces its list each call; the
  goal does the same with one value. There is no id or append. An empty
  objective on an active/default goal clears; a blank objective with
  `status: "achieved"` is rejected, so "mark done" can never be mistaken for
  "forget" and a rejected call cannot half-apply. Marking achieved keeps the
  record and stops the reminder, which a single empty-clear cannot express.
- **The command classifies, then runs, records, or delegates.** `/goal <prompt>`
  is the user-driven path: one clarifier call (`clarify-prompt.ts` + `clarify.ts`) returns
  `{ clear, goal, questions }`. A clear goal opens a prefilled `ctx.ui.editor`,
  then `pi.sendUserMessage` sets and runs it. `/goal set` reuses the same step but
  skips the send, and `/goal set` (bare) or `/goal edit` opens the editor
  prefilled with the current goal. An unclear goal is delegated to the
  agent, which asks the questions with `ask_user_question` and records the
  clarified goal itself; the command cannot call that `model-only` tool directly
  and never sets a half-formed goal. Classification is best-effort (a failure
  falls back to the typed text) and a dismissed dialog cancels the command, so
  nothing is half-applied. No conversation history is sent: the clarifier must
  not invent scope the user did not state. The `goal` tool remains the model's
  silent setter.
- **State in `details` and a custom entry.** A `goal` tool call stores the goal
  in its result's `details`; the `/goal` command appends a `goal` custom entry
  (`pi.appendEntry`). `reconstructGoal` replays both in branch order, last
  writer wins, so `/resume` and `/tree` reproduce the goal that was correct at
  that point and stale branches never leak. An appendEntry-only design was
  rejected because a durable side-channel would not branch with the
  conversation.
- **The reminder is an injected, filtered message.** While the goal is active,
  `before_agent_start` returns a `goal-context` message (`[SESSION GOAL]`,
  `display: false`). The `context` hook keeps only the newest injection while
  the goal is active and removes all of them once it is cleared or achieved, so
  repeated instructions never accumulate and stale ones never survive a
  `/resume`.
- **Visibility is derived; the goal is the top rail.** `runtime.setGoal` mirrors
  the goal into `ctx.ui.setWidget()`; the tool works in every mode while the
  widget exists only in `tui`. Because Pi re-inserts a widget on every set and
  re-insertion appends, `lib/rails.ts` coordinates on `pi.events`: the goal
  announces, `todo` re-asserts, and the stack stays `Goal / Todos`. Dock screens
  hide all rails and restore them on close.
- **One-line widget, achieved hidden by default.** The rail follows the
  `todo` grammar (`Goal · active · <objective>`): accent label leads, status
  follows, no prefixed glyph, clipped to the terminal. The transcript keeps the
  multi-line `◎` / `✓` rail. `achieved: "show"` restores the dimmed line; config
  only affects presentation.
- **Sanitize at the boundary.** `normalizeGoal` and `parseClarification` both route
  model text through `lib/format.ts`'s `sanitizeLine`, so an embedded newline
  cannot corrupt the widget and raw escapes cannot restyle the terminal.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: wire the runtime, tool, command, reminder, and session events. |
| `types.ts` | `Goal`, `GoalStatus`, `GoalDetails`. |
| `schema.ts` | TypeBox parameters and pure validation/normalization. |
| `clarify-prompt.ts` | Clarifier system prompt, message builders, and the delegation text (pure). |
| `clarify-parse.ts` | Parse the `{ clear, goal, questions }` reply (and the plain-text fallback), normalize questions, and expose the limits (pure). |
| `clarify.ts` | Clarifier model call, cancellable loader, and the confirm/edit dialog (host). |
| `state.ts` | Branch reconstruction (pure). |
| `format.ts` | Model-facing and terminal text plus the transcript `◎` / `✓` symbols and the rail vocabulary (pure). |
| `config.ts` | Widget config load/validation (`goal.json`). |
| `tui.ts` | The persistent goal widget and the transcript result rail. |
| `runtime.ts` | Session-scoped state and widget synchronization. |
| `tools.ts` | `goal` tool registration and rendering. |
| `commands.ts` | `/goal`. |

## Testing

Unit tests cover config, validation/normalization, branch reconstruction,
prompt clarification (parse and flow), formatting, the TUI renderers, and the
tool/extension wiring:

```bash
bun test extensions/goal
```
