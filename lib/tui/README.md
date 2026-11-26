# lib/tui — the shared terminal design system

The primitives every interactive surface in this package draws with: rules,
rows, columns, gauges, panes, glyphs, color roles, and the tool-transcript kit.
The module-by-module inventory is the `tui/` row of [`../README.md`](../README.md).

**The rules are not here.** What a mark means when you read a screen, and what a
surface must do when you write one, is
[`docs/design-system.md`](../../docs/design-system.md), which also states the
hierarchy: Pi's own design system first, that rule set second, and this file as the
map — which primitive carries which rule, which member a screen subclasses, and which
gate holds the number. Pi's
[Terminal UI](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/tui.md)
and [Themes](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/themes.md)
docs are normative above both, and a surface that re-derives chrome, glyphs, or scroll
math instead of importing it is the bug this directory exists to prevent.

## Primitives

Reach for a `lib/tui/` primitive before composing your own: `plainRule` /
`titleRule` for a heading, `listRow` / `statusRow` / `checkbox` for a list,
`gaugeBar` for a meter, `emptyState` for an empty screen, `splitRow` /
`fitCells` for two columns, `LinePane` for a scrollable log, `ListCursor` /
`IdCursor` for selection, `byRunningFirst` for a live list's order,
`DockListScreen` for a list that opens a pane, `TailResult` for a tool result
that lists rows, heads several row sections, or tails output, `screenFooter` for a
screen's own last three rows, and `ConfirmState` before a destructive action.

## The block frame

A block's shape is [`docs/design-system.md#reading-the-screen`](../../docs/design-system.md#reading-the-screen);
what this module spends is its height. `test/tool-render.test.ts` owns the numbers:
every package fixture's height at 80 columns is a ceiling in `COLLAPSED_ROWS`, and an
entry is debt rather than a blessing, so it may only fall. It reads 2.6 rows on
average across 39 blocks, with `web_search` the tallest at 7.

`plainRule` / `titleRule` draw the rule a block or a screen is framed with, and a
renderer composes its body from the kit rather than printing rows of its own.

## Docked list screens

Every list screen is `dockListFrame`: the header rule, an optional summary and
its blank line, the body, an optional range row, an optional detail block, the
key-hint row, and the closing rule. The frame owns that spacing, so a screen
never hand-rolls it — including the blank line above the detail block, which
keeps a footnote from reading as one more row. A screen that sizes its body
through `fitRows` counts the block with `detailBlockRows`, or the hint row is
pushed off the bottom of a short terminal.

The closing rule is not decoration: Pi's built-in selectors draw one under the
list and over the footer, and the editor a docked screen replaces draws its own,
so a screen that ends on a blank removes the dock's bottom edge. A screen that
lays out its own rows closes its block with `screenFooter(theme, width, hint)`;
a screen whose row above the hint varies places `plainRule` itself.

A list that **opens a pane over one row** — `/jobs`, `/watch`, `/agents` —
subclasses [`dock-screen.ts`](./dock-screen.ts) instead of
re-assembling the frame. `DockListScreen` owns the two modes, the `IdCursor` and
`LinePane`, the navigation and wheel keys, the y/N confirmation, the one-line
feedback notice, and the range rows; the subclass supplies `rows`, `idOf`,
`rowLine`, `detailBlock`, `summaryCells`, `listHints(rows)`, `detailHints(row)`,
`detailFor`, and `handleVerb`. Keep the ordering in `rows()` (the base re-reads
it every render) and return it by stable id, so a live re-sort cannot move the
cursor or swap the open pane out from under the reader.

Four optional members cover what a richer screen needs, and each defaults to
what a plain list wants — do not hand-roll the frame to get one of them:

- `DetailContents.facts(width)` — rows *above* the scrollable body that depend on
  the width (key/value facts, a legend). The body's lines are built once at open,
  so anything width-dependent belongs here, and the base counts the rows against
  the pane's height.
- `liveDetail()` — set it when the pane's source changes between frames on its
  own (a child's output) rather than on a poll. The base then re-reads
  `detailById` while rendering, without asking for another frame, and closes the
  pane if the row is gone.
- `detailById(id)` — the poll source job and watch read every 500 ms; omit it
  when nothing polls the pane.
- `handleDetailVerb(key, row)` — a verb that also works while reading the pane
  (`c` collect, `x` cancel). Return `true` for the keys it claimed; everything
  else falls through to the pane's scroll keys.

A pane is a log by default: it opens at the tail and its subtitle says
`following` or `paused`. Two more fields cover the other body:

- `DetailContents.text` — prose instead of `lines`, wrapped to the width the pane
  renders at and re-wrapped on a resize. One source line is one paragraph; a blank
  line stays blank. `lines` remains the right shape for output that is already
  split.
- `DetailContents.tail: false` — a prose or list pane opens at the top and never
  claims to follow anything. Leave it out for a log.

A screen whose list is one of several scopes overrides `headerLabel()` (the
header rule's name) and `emptyLabel()` (the empty-list line), so `Tab` can change
what is listed without a second renderer; both default to the screen's options.

A destructive action asks through [`confirm.ts`](./confirm.ts):
`ConfirmState.ask(prompt, accept)` holds the question, `resolve(data)` accepts on
`y`/`Y`/Enter, dismisses on `n`/`N`/Esc/`q`, and returns `undefined` for any
other key so a stray arrow cannot cancel the question. The prompt ends in
`? y/N`.

The detail block carries footnotes about the focused row: what the row does not
already say. Never repeat its label, verdict, or duration — the row is one line
above, and a second copy is noise the reader has to compare. Prose that the hint
row already says with keys does not belong there either; a sentence that long is
clipped mid-word at the widths the screen runs at.

## Color roles

The rule — a role, never a literal, and what a reader may conclude from a color — is
[`docs/design-system.md#color-is-a-role`](../../docs/design-system.md#color-is-a-role).
`paint(theme, role, text)` resolves a `TuiRole` through `TUI_TOKENS`, the one place
the kit names a Pi token, its tool vocabulary (`toolTitle`, `toolOutput`) included, so
a renderer draws a tool block the way it draws a list. Use the shared
`selectionMarker`, `GLYPHS`, `SEPARATORS`, and `STATUS_KEYS` instead of retyping their
literals, `screenHint` / Pi's `keyHint` for the hint row, and `screenFooter` for the
hint row with its blank and closing rule.

A list accents the focused row's label (`labelRole: selected ? "accent" : "label"`).
`ScreenHint.color` is a `TuiRole`, so a key is painted by the page's rule rather than
by taste.

## Glyph records

The vocabulary and its four rules are
[`docs/design-system.md#a-glyph-is-one-column-and-one-meaning`](../../docs/design-system.md#a-glyph-is-one-column-and-one-meaning),
and the table there is held against `GLYPHS` by `glyphs.test.ts`. This file
owns the record: `GLYPHS` holds the literal and `GLYPH_SPECS` the facts about it, one
record per name — the `ink` class, the measured East-Asian `width`, and the one thing
it `says`. A glyph without a record, or a record without a glyph, does not compile, and
one shape that serves several jobs declares them with `also`.

`glyphs.test.ts` holds the recorded class against the measured one, and
`test/conventions.test.ts` fails a literal re-typed in shipped source. A browser
surface is out of that reach: a mark inside `content:"▸"` is a font glyph with no
column to spend. Where a line must spell one, it says why — `reasonFor`'s body is
serialized for the page, where an import would not exist, so its glyph carries
`allow:glyph`, and a fixture quoting a process's output is data rather than a chip.

## Width utilities

The rule is [`docs/design-system.md#width-is-columns`](../../docs/design-system.md#width-is-columns).
Use `visibleWidth`, `truncateToWidth`, and `wrapTextWithAnsi`, and start the
arithmetic from `Math.max(1, width)`. `fitCells` prices the clipped cell itself, so a
caller passes a width and gets a line that fits. Size from the live viewport — `titleRule`, `viewportRows`,
`fitRows`, and `ListCursor`, fed by a `ViewportRowsSource` (number or getter) with a
sensible fallback — so a resize is picked up. List screens stay docked; only the plan
review uses `FULL_SCREEN_OVERLAY`.

## Sanitizing text

The rule is [`docs/design-system.md#text-you-did-not-type`](../../docs/design-system.md#text-you-did-not-type),
and what is trusted is [`docs/security.md`](../../docs/security.md)'s. The choice this
file makes is which function: `sanitizeLine` for anything bound for a widget or the
terminal, and `stripControlChars` alone for multi-line text that must keep its
newlines.

Program output — a log file, a child's stdout, a tailed file — goes through
`sanitizeUntrustedLine` instead. It removes OSC, CSI, and single-character escapes
whole (so the printable tail of an escape never reaches the terminal), then resolves
`\r` the way a terminal would, squeezes whitespace, and clips. `sanitizeLine` would
leave `[31m` behind, because it turns ESC into a space.

## Keys

`matchesKey` / `Key` match a binding, and the bindings the page lists are the ones
every surface answers.

## Components

Implement `Component` with `invalidate()`, update an instance in place, read live
state on each render, and call `requestRender()` only after state changes. Never
hold themed strings in state unless `invalidate()` rebuilds them.

Pi renders the whole tree every frame, so a component that derives its lines from
another one memoizes them with `RenderCache` — `lines()` keyed on width and the
source lines' identity, or `keyed()` for a component with no inner component (a
header's view, a footer's snapshot), keyed on the parts it read: primitives by
value, an object such as the theme by identity — and drops the memo in
`invalidate()`. Re-deriving every line per frame is what makes a long transcript
feel slow. The rule the memo serves — a widget is derived from state, never
authoritative — is [`docs/design-system.md#building-a-surface`](../../docs/design-system.md#building-a-surface).

## Focus

Reserve the name `focused` for a real focus `get` / `set` pair. Pi's `setFocus`
duck-types a focusable with `"focused" in component` and then assigns a boolean
there, so any other member of that name — a method, say — is silently shadowed
and the first call throws at runtime.

## Tests

A capability suite groups the modules it covers and asserts fields, width
bounds, ordering, and glyphs — never literal column padding. An extension's
screen coverage lives in its declared capability suite (for example `ui.test.ts`).
