# `status-bar` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Replace Pi's built-in two-line footer with a colorful, width-adaptive one that
surfaces the information this package already produces — git branch, worktree,
plan mode, context usage — in one consistent place, without duplicating the
built-in's private formatting helpers.

## Decisions

**Two lines, four zones.** Line 1 is identity (`pwd` left, branch + worktree
right); line 2 is resources (meters left, model + level right). This keeps
"where am I / what state" separate from "how much am I burning", and puts the
model where a reader looks for it.

**The gauge is anchored at column 0.** On line 2 the meters come first
(`gauge %/window`, cost, tokens, cache) and the mode/alert slot trails after a
`│`. Anchoring the gauge means the context percentage always sits in the same
place, so it can be read without hunting; a leading slot would shift it left and
right as plan mode came and went. The trailing mode slot is still
weight 1, so it stays visible as the meters drop.

**Statuses are routed, not repeated.** The built-in footer renders every
`ctx.ui.setStatus()` value on its own line. The bar splits them: the `worktree`
status goes to line 1's right zone (it is really location), and everything else
— plan mode and future alerts — goes to line 2's trailing slot. This is why the
bar must render `getExtensionStatuses()` at all: a custom footer replaces the
built-in one entirely.

**Segments degrade; they do not clip.** Each `Segment` carries progressively
shorter `forms` and a `weight`. `layout.ts` renders, and while the line is too
wide it advances the lowest-priority form or drops the lowest-priority segment.
This makes narrow terminals predictable: the gauge steps `10 → 5 → 3 → 0`
blocks, the mode slot compacts to an icon, cost goes before tokens, and the gauge,
statuses, and model survive to the end. Only after everything is minimal does
`truncateToWidth` apply.

**Neutral by default; color means something.** Only the context gauge carries
status color (`success`/`warning`/`error`); cost is `muted`, and
tokens/cache/window are `dim`. Yellow is reserved for the gauge crossing 70%, so
it is never "always on" the way a yellow cost would be.

**Data is read, never cached, except the usage scan.** The component resolves
the theme through a getter and reads a fresh snapshot each render, so theme and
settings changes are picked up without rebuilding. The one expensive part —
summing token/cost totals across a session that can hold thousands of entries —
is memoized by `sessionId:leafId`. Every append moves the leaf, so the key is
enough to know the totals are stale, and it avoids `getEntryCount()`, which is
not exposed on the read-only session manager.

**TTY-only, fail-safe.** The footer is installed only when `ctx.mode === "tui"`.
Non-interactive runs load the extension, register `/status-bar`, and change
nothing.

## Non-goals

- No per-segment CLI configuration; edit `config.ts`.
- No todo-count segment; the [todo](../todo/) widget already shows progress.
- No shelling out for git ahead/behind; the footer data provider exposes only
  the branch.

## Test surface

`test/status-bar/` covers the pure formatters (`format`), the usage scan and
snapshot assembly (`snapshot`), zone/priority assignment (`lines`), the
reduction and right-zone folding at widths 100/64/44/24/8 plus wide characters
(`layout`), and the install/skip/restore/toggle lifecycle
(`extension`).
