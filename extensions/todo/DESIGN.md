# `todo` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the model a first-class task list, modelled on Claude Code's `TodoWrite`,
the same symmetry `pi-worktree` and `ask-user-question` have with their Claude
Code counterparts. Pi ships a single-file `todo.ts` example but no reviewed,
tested, packaged implementation.

## Decisions

**Whole-list replacement, not mutations.** Claude Code's `TodoWrite` sends the
entire list every call; the server never assigns ids. This removes an entire
class of state (ids, per-item update actions) and makes every call idempotent.
A call is a snapshot, so `todos: []` is the natural clear and there is no
"forgot to toggle" failure mode.

**State in tool-result `details`.** This is Pi's recommended storage for state
that must follow the active branch. `reconstructTodos` replays
`ctx.sessionManager.getBranch()` and takes the last `todo` result, so `/resume`
and `/tree` reproduce the list for that point in history. `pi.appendEntry()`
was rejected because a durable side-channel list would not branch.

**Validation is pure and fail-safe.** `normalizeTodos` throws a model-readable
message, and the tool turns that into an `isError` result that carries the
*previous* list. A rejected call never half-applies.

**One `in_progress` item.** Claude Code enforces this and it keeps the widget
honest: the single accented row is the current task. The rule is validated, not
silently coerced, so the model learns it from the error.

**The widget is derived, not authoritative.** `runtime.setTodos` mirrors state
into `ctx.ui.setWidget()`; the widget only exists in `tui` mode and only while
the list is non-empty, so it never becomes the only copy of anything.

## Non-goals

- No priorities, due dates, or dependencies — a flat ordered checklist.
- No per-item edit tool; the model resends the list.
- No cross-session persistence beyond the session branch.
- No separate "complete the current item" shortcut; the model controls status.

## Model surface

| Field | Value |
|---|---|
| `name` | `todo` |
| `exposure` | `direct` (default) |
| `executionMode` | `sequential` — calls share the in-memory list |
| `annotations` | `idempotentHint: true` (a snapshot write), not read-only |

`promptGuidelines` teach the replacement semantics and the one-`in_progress`
rule, since both are easy for a model to get wrong.
