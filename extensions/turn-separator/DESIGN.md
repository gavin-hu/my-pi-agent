# `turn-separator` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Make the boundary between completed turns visible in Pi's transcript. Pi draws
no separator and exposes no setting for one, so the extension has to record a
marker and render it.

## Decisions

**`agent_settled`, not `turn_end`.** An agent run can contain several turns
(one assistant message per tool-calling round). `turn_end` fires for each, so
using it would draw a line between intermediate rounds. `agent_settled` fires
once after a run fully settles, with no retry, compaction, or queued
continuation pending — exactly one user turn.

**Append a custom entry; render it.** `pi.appendEntry()` records durable data
excluded from LLM context, and `registerEntryRenderer()` draws it in the
transcript. This survives resume and fork (the entry is in the session) at zero
token cost, unlike a custom *message*, which would be resent to the model.
Pi's `CustomEntryComponent` inserts one spacer line before the renderer output,
which gives the rule breathing room.

**Number by branch, not by a counter.** The turn number is
`count(separators on the current branch) + 1`, not a module-level counter. A
resumed or forked session therefore continues the parent's numbering instead of
restarting at 1, and abandoned branches do not leak counts.

**Degrade, don't clip.** `separatorParts` centers the label and fills the
remainder with the glyph. When the label cannot fit, it returns a plain dashed
rule of the requested width. Every returned line matches the requested column
count (floored at one, so a zero width still yields a single glyph), using
`visibleWidth` rather than string length so wide glyphs and ANSI styling cannot
overflow.

**TTY-only, inert elsewhere.** The append is guarded by `ctx.mode === "tui"`.
Non-interactive modes still load the extension; they simply record nothing, so
RPC/JSON/print session logs are not seeded with entries only an interactive
viewer understands.

## Non-goals

- No runtime command or settings file; edit `config.ts`.
- No suppression of the trailing separator after the final turn. It is a normal
  custom entry and can be removed with tree navigation.
