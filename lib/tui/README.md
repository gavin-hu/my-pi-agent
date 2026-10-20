# lib/tui — the shared terminal design system

The primitives every interactive surface in this package draws with: rules,
rows, columns, gauges, panes, glyphs, color roles, and the tool-transcript kit.
The module-by-module inventory is the `tui/` row of [`../README.md`](../README.md);
this file is the conventions those modules exist to make easy.

Pi's [Terminal UI](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/tui.md)
and [Themes](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/themes.md)
docs are normative. Follow Pi's built-in design system and do not invent a
private visual language; a surface that re-derives chrome, glyphs, or scroll math
instead of importing it is the bug this directory exists to prevent.

## Host before custom code

Reach down the ladder in order and stop at the first rung that works:
`ctx.ui.select` / `confirm` / `input` / `editor`, then `notify` / `setStatus` /
`setWidget`, then the pi-tui components. Reach for `ctx.ui.custom()` or a
tool/entry renderer only when a surface needs its own layout or input, and never
build a second terminal renderer.

## Block grammar

- Match the built-in block grammar: one leading blank line per transcript block,
  nothing trailing (the host owns spacing).
- Frame screens with a plain `─` rule, not box corners.
- Compact by default, expand for detail: label-first one-line widgets, with more
  revealed on demand or on a dedicated screen.

## Primitives

Reach for a `lib/tui/` primitive before composing your own: `plainRule` /
`titleRule` for a heading, `listRow` / `checkbox` for a list, `gaugeBar` for a
meter, `emptyState` for an empty screen, `splitRow` / `fitCells` for two columns,
`LinePane` for a scrollable log, and `ListCursor` / `IdCursor` for selection.

## Docked list screens

Every list screen is `dockListFrame`: the header rule, an optional summary and
its blank line, the body, an optional range row, an optional detail block, and
the blank-padded hint. The frame owns that spacing, so a screen never hand-rolls
it — including the blank line above the detail block, which keeps a footnote
from reading as one more row. A screen that sizes its body through `fitRows`
counts the block with `detailBlockRows`, or the hint row is pushed off the
bottom of a short terminal.

The block carries footnotes about the focused row: what the row does not already
say. Never repeat its label, verdict, or duration — the row is one line above,
and a second copy is noise the reader has to compare. Prose that the hint row
already says with keys does not belong there either; a sentence that long is
clipped mid-word at the widths the screen runs at.

## Color is a role

Resolve colors through a [`tokens.ts`](./tokens.ts) role
(`paint(theme, role, text)`), never a literal ANSI sequence, hex value, or Pi
token named inline; a theme swap must re-skin every surface. Use the shared
`selectionMarker`, `GLYPHS`, `SEPARATORS`, and `STATUS_KEYS` instead of retyping
their literals, and `screenHint` / Pi's `keyHint` for the hint row.

A list accents the focused row's label (`labelRole: selected ? "accent" :
"label"`); the `❯` marker alone is not enough to tell which row is live. The
hint row colors by role, not by taste: `accent` for the screen's primary action,
`warning` for one that discards state (a revert, a kill, a stop, a clear, a
forget), and `error` for one that ends the session. Keys that navigate, scroll,
or select stay dim, so a colored key is one worth a second thought.

## Width is columns

Width is terminal columns, not string length. Use `visibleWidth`,
`truncateToWidth`, and `wrapTextWithAnsi`; every returned line must fit the
width, and width arithmetic starts from `Math.max(1, width)`. Size from the live
viewport — `titleRule`, `viewportRows`, `fitRows`, and `ListCursor`, fed by a
`ViewportRowsSource` (number or getter) with a sensible fallback — so a resize is
picked up. List screens stay docked; only the plan review uses
`FULL_SCREEN_OVERLAY`.

## Sanitize at the boundary

Run model- or file-authored text through `sanitizeLine` before it reaches a
widget or the terminal: it neutralizes control characters and then collapses the
text to one line. `stripControlChars` alone is for multi-line text that must keep
its newlines.

## Keyboard first

Use `matchesKey` / `Key`, give every mouse interaction a keyboard path, and keep
the shared bindings: Esc closes, `j` / `k` and arrows scroll, `g` / `G` and
Home/End jump.

## Components are derived and cheap

Implement `Component` with `invalidate()`, update an instance in place, read live
state on each render, and call `requestRender()` only after state changes. Never
hold themed strings in state unless `invalidate()` rebuilds them. A widget is
derived from state, never authoritative.

Pi renders the whole tree every frame, so a component that derives its lines from
another one memoizes them with `RenderCache` (keyed on width and the source
lines' identity) and drops the memo in `invalidate()`. Re-deriving every line per
frame is what makes a long transcript feel slow.

## Focus

Reserve the name `focused` for a real focus `get` / `set` pair. Pi's `setFocus`
duck-types a focusable with `"focused" in component` and then assigns a boolean
there, so any other member of that name — a method, say — is silently shadowed
and the first call throws at runtime.

## Tests

A module here gets a sibling `<module>.test.ts` covering fields, width bounds,
ordering, and glyphs — never literal column padding. An extension's screen test
is the `tui.test.ts` beside its `tui.ts`.
