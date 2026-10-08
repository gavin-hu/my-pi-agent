# `goal` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the model a single, persistent objective for the session: a north star it
restates before every turn so it stays on task across many tool calls, and a
visible marker the user can see above the editor. It is
the high-level companion to `todo`: the goal is *what*, the todo list is *how*.

## Decisions

**One goal, whole-value replacement.** `todo` replaces its list each call; the
goal does the same with one value. There is no id, no per-field mutation, and
no "append". An empty objective is the clear, so a rejected call cannot
half-apply. `status` is the only other field.

**`active` vs `achieved`, not delete-to-finish.** Marking a goal achieved keeps
the objective in the transcript, keeps it visible in the widget (dimmed), and
stops the per-turn reminder. Clearing removes it entirely. This distinguishes
"done" from "forget", which a single empty-clear cannot express.

**State in `details` and a custom entry.** A `goal` tool call stores the goal
in its result's `details` and is rebuilt by replaying
`ctx.sessionManager.getBranch()`, exactly like `todo`. The `/goal` command has
no tool result, so it appends a `goal` custom entry (`pi.appendEntry`) instead;
`reconstructGoal` replays both kinds in branch order and the last writer wins.
`/resume` and `/tree` therefore reproduce the goal that was correct at that
point, and abandoned branches never leak a stale objective. A single
`pi.appendEntry()`-only design was rejected for tool-set goals because a
durable side-channel would not branch with the conversation.

**The reminder is an injected, filtered message.** While the goal is active,
`before_agent_start` returns a `goal-context` message (marker `[SESSION GOAL]`,
`display: false`). The `context` hook keeps only the newest injection while the
goal is active and removes all of them once it is cleared or achieved, so
repeated instructions never accumulate and stale ones never survive a
`/resume`. This is the mechanism `plan-mode` uses for its own context.

**Visibility is derived, never authoritative.** `runtime.setGoal` mirrors the
goal into `ctx.ui.setWidget()`. The widget exists only in `tui` mode; the tool
works in every mode.

**The goal is pinned above the todo rail.** Pi renders above-editor widgets in
insertion order and re-inserts a widget whenever it is set, so a goal update
would otherwise move the goal *below* the todo list. There is no ordering
option, so `_shared/rails.ts` coordinates on `pi.events`: after the goal sets
its widget it announces, and the list (the lower rail) re-asserts itself, which
re-appends it at the bottom. Only upper rails announce — a re-asserting rail
must not, or the two would ping-pong. The coordination is value-only (a channel
constant and pure helpers), never shared module state, because extensions load
with isolated module caches.

**The goal widget is one line, matching the todo widget.** The persistent
widget is a single glyph-led rail line, `◎ Goal · active · <objective>`. The
goal deliberately does not own a separate visual language: the goal is the
*what*, the todo list the *how*, and reading them as one family makes that
relationship legible at a glance. The line is drawn from literal characters (no
panel or layout engine) and clipped to the terminal, so it stays legible without
crowding the editor. The transcript result keeps the multi-line glyph rail
(`Goal · active` then `  ◎ <objective>`), which is where the full objective is
read.

**An achieved goal is dimmed, not expanded.** The widget line becomes
`✓ Goal · achieved · <objective>` with a dim objective, so finished work is
visually retired; `/goal` and the transcript keep the record. `achieved` in
`.pi/goal.json` accepts `collapse`/`block` (both render the one line) or `hide`
to remove it. Config only affects presentation; behavior never depends on it.

**Sanitize at the boundary.** `normalizeGoal` replaces control characters
(including `ESC`) with spaces and collapses whitespace runs, so an embedded
newline cannot corrupt the widget and raw escapes cannot restyle the terminal.
The widget assumes one logical line and clips it to the width.

**Available while planning.** `plan-mode` keeps its `PLAN_SAFE_TOOLS` — the
structured readers plus the plan and goal trackers — so the model can record or
update the objective during read-only exploration without leaving plan mode.

## Non-goals

- No multiple or nested goals — one objective per session.
- No due dates, priorities, or success criteria — that is the todo list's job.
- No cross-session persistence beyond the session branch.
- No per-field edit tool; the model resends the whole goal.
- No automatic completion detection; the model (or `/goal done`) decides.

## Model surface

| Field | Value |
|---|---|
| `name` | `goal` |
| `objective` | The complete objective, one line. `""` clears. |
| `status` | `active` or `achieved`; defaults to `active`. |
| `exposure` | `direct` (default) |
| `executionMode` | `sequential` — calls share the in-memory goal |
| `annotations` | `idempotentHint: true` (a snapshot write), not read-only |

`promptGuidelines` teach the replacement/clear semantics and the
mark-achieved-when-done rule, since both are easy for a model to get wrong.
The `goal` tool is allowlisted in `plan-mode` alongside `todo`.
