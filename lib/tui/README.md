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

A collapsed tool block is the call line and one body row, and a third row has to
earn itself. `test/tool-render.test.ts` owns the numbers: every package fixture's
height at 80 columns is a ceiling in `COLLAPSED_ROWS`, and an entry is debt rather
than a blessing, so it may only fall. It reads 2.6 rows on average across 39 blocks,
with `web_search` the tallest at 7 — a listing whose rows are the answer. Every row
above the rule is a row still to earn.

- The call line carries the outcome, so a success that adds no fact draws no body row.
- Rows the person did not ask for are either the answer itself — a listing whose
  items are the subject — or they are behind the expand hint.
- A block never prints what a widget, a footer status, or a dedicated screen already
  shows; the person read it there.
- The block shows the person's line, while the result's `content` keeps the model's
  prose: an error's instructions belong behind the expand hint, not in every rejection.
- No blank row inside a block, not even above a section heading, and a row that only
  restates the row above it is noise.

## Primitives

Reach for a `lib/tui/` primitive before composing your own: `plainRule` /
`titleRule` for a heading, `listRow` / `statusRow` / `checkbox` for a list,
`gaugeBar` for a meter, `emptyState` for an empty screen, `splitRow` /
`fitCells` for two columns, `LinePane` for a scrollable log, `ListCursor` /
`IdCursor` for selection, `byRunningFirst` for a live list's order,
`DockListScreen` for a list that opens a pane, `TailResult` for a tool result
that lists rows, heads several row sections, or tails output, `screenFooter` for a
screen's own last three rows, and `ConfirmState` before a destructive action.

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

The block carries footnotes about the focused row: what the row does not already
say. Never repeat its label, verdict, or duration — the row is one line above,
and a second copy is noise the reader has to compare. Prose that the hint row
already says with keys does not belong there either; a sentence that long is
clipped mid-word at the widths the screen runs at.

## Color is a role

Resolve colors through a [`tokens.ts`](./tokens.ts) role
(`paint(theme, role, text)`), never a literal ANSI sequence, hex value, or Pi
token named inline; a theme swap must re-skin every surface. The role table is
the one place a Pi token is named, its tool vocabulary (`toolTitle`,
`toolOutput`) included, so a renderer draws a tool block the way it draws a
list. Use the shared `selectionMarker`, `GLYPHS`, `SEPARATORS`, and `STATUS_KEYS`
instead of retyping their literals, `screenHint` / Pi's `keyHint` for the hint
row, and `screenFooter` for the hint row with its blank and closing rule.

A list accents the focused row's label (`labelRole: selected ? "accent" :
"label"`); the `❯` marker alone is not enough to tell which row is live. The
hint row colors by role, not by taste — `ScreenHint.color` is a `TuiRole`:
`accent` for the screen's primary action, `warn` for one that discards state (a
revert, a kill, a stop, a clear, a forget), and `bad` for one that ends the
session. Keys that navigate, scroll, or select stay `faint`, so a colored key is
one worth a second thought.

## A glyph is a vocabulary

Every glyph comes from [`glyphs.ts`](./glyphs.ts): `GLYPHS` owns the literal and
`GLYPH_SPECS` the facts about it, one record per name — the `ink` class, the
measured East-Asian `width`, and the one thing it `says`. Four rules, each held by
`glyphs.test.ts` and `test/conventions.test.ts`:

- **One column, and the class is recorded.** Never wide, fullwidth, or emoji;
  `ambiguous` is allowed and costs a second column under a CJK-width profile, so
  the record says which class it is instead of leaving it to the font.
- **One meaning.** No two glyphs may say the same thing. `⏵` and `▶` were two
  distinct characters that both read "go", which a distinctness test on the
  literals cannot see and a unique `says` refuses.
- **One ink per family.** A slot's glyphs share a weight: a filled mark beside a
  hairline one reads as two vocabularies, not one.
- **One shape may serve several jobs**, declared with `also` — `→` is a join and a
  cue, `▸` a running job and a closed fold.

A re-typed literal in shipped source fails `test/conventions.test.ts`. A browser
surface is out of its reach: a mark inside `content:"▸"` is a font glyph with no
column to spend. Where a line must spell one, it says why — `reasonFor`'s body is
serialized for the page, where an import would not exist, so its glyph carries
`allow:glyph`, and a fixture quoting a process's output is data rather than a chip.

## A hue identifies, a verdict judges

`ok` / `warn` / `bad` say how something *is*, and a surface that shows them is
making a judgement. `hue1`…`hue5` — blue, purple, pink, green, amber — say only
which category a row belongs to, which is what a table or a bar needs to be
told apart at a glance. They are the same tokens in places (green is `success`,
amber is `warning`), so the two vocabularies do not mix on one surface: a screen
that paints hues keeps its verdicts to the gauge, a status word, or a feedback
line, and a hue never lands in a slot that also carries a judgement. Color is
redundant there — the label, the order, and the printed number already say what
the hue repeats — so nothing may be encoded by hue alone.

## Width is columns

Width is terminal columns, not string length. Use `visibleWidth`,
`truncateToWidth`, and `wrapTextWithAnsi`; every returned line must fit the
width, and width arithmetic starts from `Math.max(1, width)`. A summary that
could not keep a cell says so: `fitCells` ends the line with `…`, priced into
the width, so a narrow screen never reads as the whole summary. Size from the live
viewport — `titleRule`, `viewportRows`, `fitRows`, and `ListCursor`, fed by a
`ViewportRowsSource` (number or getter) with a sensible fallback — so a resize is
picked up. List screens stay docked; only the plan review uses
`FULL_SCREEN_OVERLAY`.

## Sanitize at the boundary

Run model- or file-authored text through `sanitizeLine` before it reaches a
widget or the terminal: it neutralizes control characters and then collapses the
text to one line. `stripControlChars` alone is for multi-line text that must keep
its newlines.

Program output — a log file, a child's stdout, a tailed file — goes through
`sanitizeUntrustedLine` instead. It removes OSC, CSI, and single-character
escapes whole (so the printable tail of an escape never reaches the terminal),
then resolves `\r` the way a terminal would, squeezes whitespace, and clips.
`sanitizeLine` would leave `[31m` behind, because it turns ESC into a space.

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
another one memoizes them with `RenderCache` — `lines()` keyed on width and the
source lines' identity, or `keyed()` for a component with no inner component (a
header's view, a footer's snapshot), keyed on the parts it read: primitives by
value, an object such as the theme by identity — and drops the memo in
`invalidate()`. Re-deriving every line per frame is what makes a long transcript
feel slow.

## Focus

Reserve the name `focused` for a real focus `get` / `set` pair. Pi's `setFocus`
duck-types a focusable with `"focused" in component` and then assigns a boolean
there, so any other member of that name — a method, say — is silently shadowed
and the first call throws at runtime.

## Tests

A capability suite groups the modules it covers and asserts fields, width
bounds, ordering, and glyphs — never literal column padding. An extension's
screen coverage lives in its declared capability suite (for example `ui.test.ts`).
