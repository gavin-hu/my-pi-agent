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
| `promptGuidelines` | Teach the replacement/clear semantics and the mark-achieved-when-done rule, since both are easy for a model to get wrong. |

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
| `/goal` | Show the current goal (or report that none is set). |
| `/goal <text>` | Set the goal to `<text>` and mark it active. |
| `/goal done` (or `/goal achieved`) | Mark the current goal achieved. |
| `/goal clear` | Clear the goal. |

## Behaviour by mode

The tool works in every mode. The persistent widget requires interactive
(`tui`) mode; the reminder and the `/goal` command work everywhere. The widget
is always a single line; the transcript result keeps the full glyph rail,
separated from the call line by a blank line:

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

## Pi integration

| Aspect | Detail |
|---|---|
| Tool | `goal` (direct, active by default) |
| Command | `/goal` — show, set, done/achieved, or clear |
| Execution mode | `sequential` — calls share the in-memory goal |
| Annotations | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| Output schema | `GoalResult` — `{ goal, action, error? }`, returned as `details` and `structuredContent` |
| State storage | tool-result `details` plus a `pi.appendEntry("goal", { goal })` custom entry for command-set goals |
| Lifecycle hooks | `session_start` (load config, reconstruct), `session_tree` (reconstruct), `session_shutdown` (clear widget); `before_agent_start` (inject `goal-context`), `context` (filter stale/duplicate reminders) |
| UI | `ctx.ui.setWidget` one-line rail in `tui` mode; coordinated through `pi.events` so it stays the top rail |

## Design notes

- **One goal, whole-value replacement.** `todo` replaces its list each call; the
  goal does the same with one value. There is no id or append. An empty
  objective on an active/default goal clears; a blank objective with
  `status: "achieved"` is rejected, so "mark done" can never be mistaken for
  "forget" and a rejected call cannot half-apply. Marking achieved keeps the
  record and stops the reminder, which a single empty-clear cannot express.
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
- **Sanitize at the boundary.** `normalizeGoal` replaces control characters with
  spaces and collapses whitespace runs, so an embedded newline cannot corrupt the
  widget and raw escapes cannot restyle the terminal.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: wire the runtime, tool, command, reminder, and session events. |
| `types.ts` | `Goal`, `GoalStatus`, `GoalDetails`. |
| `schema.ts` | TypeBox parameters and pure validation/normalization. |
| `state.ts` | Branch reconstruction (pure). |
| `format.ts` | Model-facing and terminal text plus the transcript `◎` / `✓` symbols and the rail vocabulary (pure). |
| `config.ts` | Widget config load/validation (`goal.json`). |
| `tui.ts` | The persistent goal widget and the transcript result rail. |
| `runtime.ts` | Session-scoped state and widget synchronization. |
| `tools.ts` | `goal` tool registration and rendering. |
| `commands.ts` | `/goal`. |

## Testing

Unit tests cover config, validation/normalization, branch reconstruction,
formatting, the TUI renderers, and the tool/extension wiring:

```bash
bun test extensions/goal
```
