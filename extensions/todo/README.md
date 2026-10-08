# todo — a TodoWrite-style task list for Pi

A whole-list task tracker for Pi, modelled on Claude Code's `TodoWrite`. The
model sends the complete list on every call; the previous list is discarded, so
there are no ids to juggle and no add/toggle bookkeeping.

```
pi --extension ./extensions/todo    # load just this extension
pi -e .                             # load the whole @gavin-hu/my-pi-agent package
pi install ./                       # install the package
```

## What it does

- Registers one model-callable tool, `todo`, that **replaces** the task list.
  An empty list clears it. The tool result is a compact summary — progress plus
  the current item — not an echo of the list the model just sent; the full list
  lives in `/todos` and in each result's `details`.
- Each item has `content`, a `status` (`pending` | `in_progress` |
  `completed`), and an optional `activeForm` ("Running tests") shown while the
  item is in progress.
- Shows a persistent widget above the editor while the list has unfinished
  work (hidden when empty or fully completed), and a scrollable `/todos`
  screen on demand. It is the middle rail, between the [`goal`](../goal/) and
  [`jobs`](../jobs/) widgets (`Goal / Todos / Jobs`).
- Stores the list in tool-result `details`, so it follows the active session
  branch and survives `/resume` and `/tree` — abandoned branches never leak
  into the current list, and stored lists are re-sanitized on replay.

The widget is a one-line summary — progress plus the current item — so the
active task is always visible without expanding the list:

```
Todos · 1/3 · Writing the tests
```

`/todos` is the expanded view and keeps the model's list order (use it to see
the plan as written).

## Tool

| Field | Value |
|---|---|
| `name` | `todo` |
| `todos` | The complete list. Pass `[]` to clear. |
| `todos[].content` | Imperative description, e.g. `"Write the parser tests"`. |
| `todos[].status` | `pending`, `in_progress`, or `completed`. |
| `todos[].activeForm` | Optional present-continuous label for the in-progress item. |

Validation rules (a violation returns an error result and leaves the list
unchanged):

The tool declares an `outputSchema` and returns matching `structuredContent`
(`{ todos, action, error? }`), so codemode/scripts can read the list as data.

- at most **one** item `in_progress`;
- at most **50** items;
- non-empty, unique content, at most 500 characters each;
- a known `status`.

Before those checks, `content` and `activeForm` are normalized to a single
terminal-safe line: control characters (including `ESC`) are replaced with
spaces and any whitespace run (newlines, tabs, repeated spaces) collapses to
one space. This keeps every surface to one row per item and stops model text
from injecting terminal sequences. An `activeForm` that sanitizes to nothing is
dropped.

## Command

| Command | What it does |
|---|---|
| `/todos` | Show the current list. An interactive, scrollable screen in `tui` mode; a notification elsewhere. |

On the `/todos` screen: `↑`/`↓` or `j`/`k` scroll one row, `PgUp`/`PgDn` page,
`Home`/`End` jump, and `Esc` (or `Ctrl-C`) closes. The window grows and shrinks
with the terminal height, so the footer hint stays visible.

## Behaviour by mode

The tool works in every mode. The persistent widget and the `/todos` screen
require interactive (`tui`) mode; RPC and non-interactive runs simply get the
tool result. While any dock screen is open (`/todos`, `/jobs`, `/rewind`,
`/plans`, or the ask-user-question questionnaire), the above-editor rails are
hidden and return on close.

## Configuration

The widget presentation is configurable from `~/.pi/agent/todo.json` and
`<cwd>/.pi/todo.json` (project values override global):

| Key | Default | Meaning |
|---|---|---|
| `hideWhenComplete` | `true` | Hide the one-line widget once every item is completed. An empty list always hides. |

Malformed files and invalid values are ignored, and todo behavior never depends
on config.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: wire the runtime, tool, command, and session events. |
| `types.ts` | `Todo`, `TodoStatus`, `TodoDetails`. |
| `schema.ts` | TypeBox parameters and pure validation/normalization. |
| `state.ts` | Branch reconstruction and status queries (pure). |
| `format.ts` | Model-facing and transcript text (pure). |
| `tui.ts` | Widget and scrollable `/todos` components. |
| `config.ts` | Widget config load/validation (`todo.json`). |
| `runtime.ts` | Session-scoped state and widget synchronization. |
| `tools.ts` | `todo` tool registration and rendering. |
| `commands.ts` | `/todos`. |
