# todo — a TodoWrite-style task list for Pi

A whole-list task tracker for Pi, modelled on Claude Code's `TodoWrite`: the
model sends the complete list on every call, so there are no ids to juggle and
no add/toggle bookkeeping. The list follows the active session branch and is
rebuilt on `/resume` and `/tree`, and the extension keeps it honest by asking for
one update when work lands without one.

<img src="../../assets/screens/todo.png" alt="The /todos screen: a Todos title rule, a 3/7 completed summary, and the list with check, spinner, and circle glyphs" width="100%">

## Capabilities

| Capability | How | What you get |
|---|---|---|
| Whole-list tracking | `todo` | One call replaces the list; an empty list clears it. |
| Live progress rail | the `todo` widget | Progress and the active item, one line above the editor. |
| Atomic validation | `todo` validation | At most one `in_progress`, at most 50 items, unique non-empty content, and a known status; a violation returns an error with the unchanged list. |
| Terminal-safe normalization | sanitized `content` and `activeForm` | Control characters, newlines, tabs, and repeated spaces collapse to one terminal-safe line before the list is stored. |
| Compact model result | the `todo` result | The model gets progress and the active item, not an echo of the whole list, so every update does not repeat the table. |
| Transcript rendering | the `todo` transcript block | The call line carries progress; the collapsed rows lead with active work, the expanded rows keep submission order, and a cap ends with `… N more`. |
| Full list on demand | `/todos` | A scrollable screen in the order the model submitted. |
| Headless listing | `/todos` outside `tui` | RPC, print, and JSON modes get the same list as a notification, with no terminal screen. |
| Branch-following state | tool-result `details` | The list survives `/resume` and `/tree`, and abandoned branches never leak in. |
| Lag reminder | the `agent_before_settle` nudge | One hidden reminder and one forced continuation when mutating work lands without a todo update. |
| Structured result | `structuredContent` | Codemode scripts read the list as data. |

## Quickstart

```bash
pi --extension ./extensions/todo    # load just this extension
pi -e .                             # load the whole @gavin-hu/my-pi-agent package
pi install ./                       # install the package for a user
```

```text
/todos                              # show the list, and its progress
```

The model calls `todo` with the complete list; the widget appears above the
editor while anything is unfinished.

## Tool

<img src="../../assets/tools/todo.png" alt="The todo tool's result: the call line and an indented body with the progress line and the task rows below it, each led by a check, spinner, or circle glyph" width="100%">

`todo` — `exposure: "direct"` (the default), `executionMode: "sequential"`,
read-write, closed-world, idempotent. It replaces the list; an empty list clears
it. The result is a compact summary — progress plus the current item — not an
echo of the list the model just sent.

| Parameter | Type | Meaning |
|---|---|---|
| `todos` | array, required | The complete list. Pass `[]` to clear. |
| `todos[].content` | string | Imperative description, e.g. `"Write the parser tests"`. |
| `todos[].status` | `pending` \| `in_progress` \| `completed` | Where the item stands. |
| `todos[].activeForm` | string | Present-continuous label, required when the item is `in_progress` ("Running tests"). |

Result (`details` / `structuredContent`): `{ todos, action, error? }`.

Validation rules (a violation leaves the list unchanged):

- at most **one** item `in_progress`, and it needs a non-blank `activeForm`;
- at most **50** items;
- non-empty, unique content, at most 500 characters each;
- a known `status`.

Before those checks, `content` and `activeForm` are normalized to a single
terminal-safe line: control characters (including `ESC`) are replaced with
spaces and any whitespace run (newlines, tabs, repeated spaces) collapses to
one space. This keeps every surface to one row per item and stops model text
from injecting terminal sequences. An `activeForm` that sanitizes to nothing is
dropped (and then rejected on an `in_progress` item).

The tool's own checks (the semantic rules and the bounds above) return an
`isError` result that carries the unchanged list, so the model can retry. An
unknown `status` or a wrong argument type is rejected by Pi before `execute`
runs, so the host's validation message is returned instead; the list is still
unchanged.

```text
todo({ todos: [{ content: "Write the parser tests", status: "in_progress", activeForm: "Writing the parser tests" }] })
todo({ todos: [] })   // clear
```

The widget is a one-line summary — progress plus the current item — so the
active task is always visible without expanding the list:

```text
Todos · 1/3 · Writing the tests
```

In the transcript, the call line carries progress only (`todo → 1/4`); the
result keeps the `✓` / `◒` / `◌` rows, directly under the call line. The item
text lives on the rows, so the call line never repeats it. Collapsed, it leads
with active work; expanded, it keeps the submitted order:

```text
todo → 1/4
  ◒ Writing tests
  ◌ Ship it
  ◌ Write docs
  ✓ Write schema
```

Progress lives on the call line, so the rows have no footer; the persistent
widget and `/todos` still show the count. A capped collapsed rail ends with
`… N more` and the `app.tools.expand` hint.

## Commands

| Command | What it does |
|---|---|
| `/todos` | Show the current list. An interactive, scrollable screen in `tui` mode; a notification elsewhere. |

`/todos` is the expanded view and keeps the model's list order, so it shows the
plan as written. On the screen: `↑`/`↓` or `j`/`k` scroll one row, `PgUp`/`PgDn`
page, `g`/`G` or `Home`/`End` jump to the ends, and `Esc` (or `Ctrl-C`) closes.
The window grows and shrinks with the terminal height, so the footer hint stays
visible.

The TUI label is status-dependent: an `in_progress` row shows its `activeForm`
(`Writing the parser tests`), while pending and completed rows show `content`.
The same item can therefore read differently in the list and in the submitted
plan. The non-TUI notification prints `content` for every row.

## Behaviour by mode

The tool works in every mode. The persistent widget and the `/todos` screen
require interactive (`tui`) mode; RPC and non-interactive runs simply get the
tool result. The lag reminder is mode-independent, because it rides the agent
boundary and not the terminal UI. While any dock screen is open (`/todos`,
`/jobs`, `/rewind`, or the `question` questionnaire), the above-editor rails are
hidden and return on close.

## Configuration

One key, in the `todo` section of the shared `bytefly.json` (global document,
then project document, project wins; resolution rules in
[`../configuration.md`](../configuration.md#todo--the-todo-widget)):

| Key | Default | Meaning |
|---|---|---|
| `hideWhenComplete` | `true` | Hide the one-line widget once every item is completed. An empty list always hides. |

Malformed documents and invalid values are ignored, and todo behavior never
depends on config.

## Non-goals

- No priorities, due dates, or dependencies — a flat ordered checklist.
- No per-item edit tool; the model resends the list.
- No cross-session persistence beyond the session branch.
- No separate "complete the current item" shortcut; the model controls status.

## Pi integration

| Integration point | Value |
|---|---|
| Tool | `todo`; direct exposure (the default), `executionMode: "sequential"` |
| Annotations | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| Output | `outputSchema` `TodoResult` — `{ todos, action, error? }` — also returned as `structuredContent` |
| Command | `/todos` |
| State | tool-result `details`; rebuilt from `ctx.sessionManager.getBranch()` |
| Lifecycle | `session_start` loads config and reconstructs; `session_tree` reconstructs; `session_shutdown` clears the widget |
| Reminder | `tool_execution_end` marks a successful mutating call; `agent_before_settle` injects one hidden `custom_message` (`todo-nudge`) and returns `continue: true`; `before_agent_start` clears the lag window and expires the reminder; `context` keeps only the newest current reminder |

## Design notes

- **Whole-list replacement, not mutations.** Every call is a snapshot, so
  `todos: []` is the natural clear and there is no "forgot to toggle" failure
  mode. No ids or per-item update actions exist.
- **State in tool-result `details`.** `lib/todo-state.ts`'s `lastTodos` replays
  the active branch and takes the last write that fully validates, so `/resume`
  and `/tree` reproduce the list for that point in history. The same replay is
  what `plan` and `goal` read, so there is one rule for which write is a state
  write. `pi.appendEntry()` was rejected because a side-channel list would not
  branch; error results are skipped as non-writes.
- **Validation is pure and fail-safe.** The parser (`normalizeTodos` in
  `lib/todo-state.ts`) throws a model-readable message, and the tool turns that
  into an `isError` result that carries the *previous* list. A rejected call
  never half-applies, and branch replay follows the same rule: a stored write
  that fails validation is ignored whole rather than partially applied.
- **One `in_progress` item, with a label.** The rule is validated, not silently
  coerced, so the model learns it from the error. The item must carry a
  non-blank `activeForm`; branch replay passes `{ requireActiveForm: false }`
  so lists written before the rule still load on `/resume`.
- **The widget is derived, not authoritative.** `runtime.setTodos` mirrors state
  into `ctx.ui.setWidget()`; it exists only in `tui` mode and only while the
  list has an unfinished item, so a finished plan stops crowding the editor
  while `/todos` still shows it.
- **The `/todos` screen follows the live list.** The command subscribes to
  `runtime.onChange` while the screen is open and re-renders on every update,
  then unsubscribes once `ctx.ui.custom` resolves. The component reads the list
  through a getter, so even an untriggered render shows current state.
- **The list is the bottom rail.** Pi re-inserts a widget whenever it is set, so
  a goal update would sink the list; the list subscribes on `pi.events` and
  re-runs `setWidget` whenever a rail above it changes, keeping the stack
  `Goal / Todos`. It never announces, so the chain cannot ping-pong. See
  [`lib/rails.ts`](../../lib/rails.ts) and [`goal`](./goal.md).
- **The reminder is a bounded nudge, not a nag.** A prompt guideline cannot
  guarantee a timely update, so the extension backs it with one forced
  continuation. `tool_execution_end` counts a successful call by an explicit
  mutator list plus `readOnlyHint: false` — a failed or blocked call is ignored,
  and a false positive costs a whole extra model request, so an unrecognized
  reader is treated as harmless. An open item makes one call enough; a run with
  no list at all must reach `EMPTY_LIST_MUTATIONS` (three) first and include a
  file write, because a shell call cannot be told apart from `rg` and counts as
  work but not as a write; a list the model wrote or cleared this turn is its own
  answer and never reopens that path. `nudged` caps it at one per user turn,
  `setTodos` clears the counters, and `context` drops the hidden message on the
  next user turn so it never accumulates.
- **Content is sanitized at the boundary.** `normalizeTodos` in
  `lib/todo-state.ts` replaces control characters and collapses whitespace
  before the length and duplicate checks, keeping `format.ts` free of terminal
  concerns and every surface to one row per item.
- **The widget summarizes; full views keep the model's order.** The persistent
  widget is a single line (`currentTodo` picks the `in_progress` item, else the
  first pending); `/todos` keeps the submitted order, and the transcript result
  orders by status via `compareByActivity` so active work is never hidden. The
  transcript result draws the glyph rows at the block's body indent (the frame
  supplies `BODY_INDENT`; `GLYPH_GAP` comes from
  [`lib/tui/glyphs.ts`](../../lib/tui/glyphs.ts)), wrapping long items with
  continuation rows aligned under the text. Progress lives on the call line, so
  the rows carry no footer.
- **The transcript reuses its components.** `renderCall` reuses the slot's
  `Text`, and `renderResult` reuses the `TodoResult` view via
  `context.lastComponent`, updating each in place instead of allocating on every
  render — the built-in pattern.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: wire the runtime, tool, command, reminder events, and session events. |
| `types.ts` | `Todo`, `TodoDetails`; re-exports `TodoStatus` / `TODO_STATUSES` from `lib/todo-state.ts`. |
| `schema.ts` | TypeBox parameters; the parser and limits live in `lib/todo-state.ts`. |
| `state.ts` | Status queries over the replayed list (pure). |
| `nudge.ts` | Lag detection: mutating and file-write classification, due check, reminder text (pure). |
| `format.ts` | Model-facing and transcript text, plus the item row both surfaces draw (pure). |
| `render.ts` | The `TodoResult` transcript block over the memoized rail, drawn from `lib/tui/render-cache.ts`. |
| `widget.ts` | The persistent one-line widget and its `WIDGET_KEY`, drawn from the `lib/tui/` kit. |
| `view/todo-screen.ts` | The scrollable `/todos` screen, loaded on first use (`titleRule`, `dockListFrame`, `emptyState`). |
| `config.ts` | Widget config load/validation (the `todo` section of `bytefly.json`). |
| `runtime.ts` | Session-scoped state, lag tracking, and widget synchronization. |
| `tools.ts` | `todo` tool registration and rendering. |
| `commands.ts` | `/todos`. |
| `tools.test.ts`, `runtime.test.ts`, `view/todo-screen.test.ts` | The capability suites, declared in `test/suite-manifest.ts`. |
