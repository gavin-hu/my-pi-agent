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
was rejected because a durable side-channel list would not branch. Stored
lists are replayed through `normalizeTodos`, so corrupt or tampered branch data
is re-sanitized or ignored instead of reaching the widget, and rejected
(`error`) results are skipped because they are not state writes.

**Validation is pure and fail-safe.** `normalizeTodos` throws a model-readable
message, and the tool turns that into an `isError` result that carries the
*previous* list. A rejected call never half-applies.

**One `in_progress` item.** Claude Code enforces this and it keeps the widget
honest: the single accented row is the current task. The rule is validated, not
silently coerced, so the model learns it from the error.

**The widget is derived, not authoritative.** `runtime.setTodos` mirrors state
into `ctx.ui.setWidget()`; the widget only exists in `tui` mode and only while
the list has an unfinished item — an empty or fully completed list hides it, so
a finished plan stops crowding the editor while `/todos` still shows it. The
finished-list behaviour (`hideWhenComplete`) comes from `.pi/todo.json`,
mirroring the goal widget's config. It never becomes the only copy of anything.

**The list is the middle rail.** The goal is the *what* and sits above the
list, the *how*; `jobs` sits below it. Pi renders above-editor widgets in
insertion order and re-inserts a widget whenever it is set, so an update to an
upper rail would sink the list below the rails under it. With no ordering
option, the list subscribes on `pi.events` and re-runs `setWidget` whenever a
rail above it changes, then announces so `jobs` re-asserts in turn; because
re-insertion appends, the stack stays `Goal / Todos / Jobs`. The bottom rail
never announces, so the chain cannot ping-pong. See
[`_shared/rails.ts`](../_shared/rails.ts), [goal](../goal/DESIGN.md), and
[jobs](../jobs/DESIGN.md). While a dock screen owns the editor slot, every rail
is hidden via `withRailsSuppressed` and restored on close.

**Content is sanitized to one safe line.** `normalizeTodos` replaces control
characters (including `ESC`) with spaces and collapses whitespace runs before
the length and duplicate checks. Every surface lays items out one per rendered
row, so an embedded newline would corrupt the widget, the screen, and the
transcript numbering; raw escape sequences would let model text restyle or
control the terminal. Sanitizing at the boundary fixes both for every consumer
at once, and keeps the pure `format.ts` helpers free of terminal concerns.

**The widget summarizes; full views keep the model's order.** The persistent
widget is a single line — `Todos · 1/3 · Writing tests` — so progress and the
current item are always visible without expanding the list; `currentTodo` picks
the `in_progress` item, else the first pending one. `/todos` keeps the submitted
order. The transcript result still orders items by status via
`compareByActivity`, so an active task is never hidden behind finished rows.

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
