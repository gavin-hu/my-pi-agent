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
  An empty list clears it.
- Each item has `content`, a `status` (`pending` | `in_progress` |
  `completed`), and an optional `activeForm` ("Running tests") shown while the
  item is in progress.
- Shows a persistent widget above the editor whenever the list is non-empty,
  and a full-screen `/todos` view on demand.
- Stores the list in tool-result `details`, so it follows the active session
  branch and survives `/resume` and `/tree` — abandoned branches never leak
  into the current list.

```
Todos 1/3 completed
  ✓ Write the schema
  ◐ Writing the tests
  ○ Ship it
```

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

- at most **one** item `in_progress`;
- at most **50** items;
- non-empty, unique content, at most 500 characters each;
- a known `status`.

## Command

| Command | What it does |
|---|---|
| `/todos` | Show the current list. An interactive screen in `tui` mode; a notification elsewhere. |

## Behaviour by mode

The tool works in every mode. The persistent widget and the `/todos` screen
require interactive (`tui`) mode; RPC and non-interactive runs simply get the
tool result.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: wire the runtime, tool, command, and session events. |
| `types.ts` | `Todo`, `TodoStatus`, `TodoDetails`. |
| `schema.ts` | TypeBox parameters and pure validation/normalization. |
| `state.ts` | Branch reconstruction and status queries (pure). |
| `format.ts` | Model-facing and transcript text (pure). |
| `tui.ts` | Widget and `/todos` components. |
| `runtime.ts` | Session-scoped state and widget synchronization. |
| `tools.ts` | `todo` tool registration and rendering. |
| `commands.ts` | `/todos`. |
