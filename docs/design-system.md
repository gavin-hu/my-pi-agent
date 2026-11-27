# Design system

Every terminal surface in this pack is drawn with one kit, and the kit is Pi's:
the same block grammar, the same color roles, the same glyphs, no private visual
language. The browser surfaces are drawn by [the web layer](https://github.com/gavin-hu/my-pi-agent/blob/main/lib/web/README.md)
instead, which derives its palette from these themes and has components of its own.
This page is the terminal kit's rule set — what a mark means when you *read* a
screen, and what a surface must do when you *write* one. The module-by-module
contract that implements it lives beside the code, in
[`lib/tui/README.md`](https://github.com/gavin-hu/my-pi-agent/blob/main/lib/tui/README.md);
the name of a function, a screen's members, and every ceiling are there, and this
page is what those modules exist to make easy.

## Reading the screen

A **tool block** is its call line and one body row, with one leading blank line and
nothing trailing — the host owns the spacing between blocks. The call line carries
the outcome, so a success that adds no fact draws nothing beneath it, and a third row
has to earn itself: rows you did not ask for are the answer itself or they are behind
the expand hint. A block never prints what a widget, a footer status, or a dedicated
screen already shows, because you read it there; no blank row belongs inside one,
and a row that only restates the row above it is noise.

Compact by default, expanded for detail: a widget is a label first, one line, with
more on demand or on a dedicated screen. A block shows your own line and the result
it produced, while the model keeps the prose — so an error's instructions wait behind
the expand hint rather than appearing at every rejection.

A **list screen** arrives in the dock, in the same frame every time: a header rule
naming the screen, an optional summary, the rows, the focused row's detail, a hint row
of keys, and a closing rule. Nothing is drawn as a box; a heading is a plain `─` rule
with a title.

The focused row is accented, not merely marked — the `❯` says where the keys are, and
the color says which row is live.

A line that cannot fit is clipped, not wrapped: a summary that loses a cell ends in
`…`, priced into the width, so a narrow terminal never reads as the whole thing. A
resize is picked up on the next frame rather than at the next open.

The keys are shared: `Esc` closes, `j`/`k` and the arrows scroll, `g`/`G` and
`Home`/`End` jump. Every mouse interaction has a key path, and the hint row names the
rest.

## Color is a role

A surface names a role and the theme supplies the color, so switching `bytefly-dark`
for `bytefly-light` re-skins every screen without one of them changing. There is no
literal color anywhere in a surface: not a hex value, not an ANSI sequence, not a Pi
token inline. The roles are:

| Role | Paints | Means |
|---|---|---|
| `accent` | `accent` | The brand highlight: selection, focus, a model name. |
| `title` | `accent` | A screen, section, or panel title. |
| `label` | `text` | Primary body text. |
| `meta` | `muted` | Secondary text: counts, paths, summaries. |
| `faint` | `dim` | Tertiary text and de-emphasis — and the keys that only navigate. |
| `rule` | `borderMuted` | A divider. |
| `ruleStrong` | `border` | A heavier divider. |
| `ok` | `success` | Success. |
| `warn` | `warning` | Warning. |
| `bad` | `error` | Error. |
| `info` | `muted` | A neutral notice. |
| `hue1` | `accent` | A category: blue. |
| `hue2` | `mdListBullet` | A category: purple. |
| `hue3` | `mdCode` | A category: pink. |
| `hue4` | `success` | A category: green. |
| `hue5` | `warning` | A category: amber. |
| `toolTitle` | `toolTitle` | A tool call's name. |
| `toolOutput` | `toolOutput` | A tool result's body. |

A role is not a token: six of these paint a color another one already paints, which
is the point of naming a role. The `Paints` column is what the kit maps to, never
something a surface writes — a surface names the role.

### A hue identifies, a verdict judges

`ok` / `warn` / `bad` say how something *is*, so a surface that shows one is making a
judgement. `hue1`…`hue5` say only which category a row belongs to, which is what a
table or a bar needs to be told apart at a glance — and the table above is where two
of them land on a token a verdict already uses. That is why one surface keeps one
vocabulary: a screen that paints hues keeps its verdicts to the gauge, a status word,
or a feedback line, and a hue never lands in a slot that also carries a judgement.
Nothing is encoded by color alone, either: the label, the order, and the printed
number say what the hue repeats.

On a key, color means consequence: `accent` for a screen's primary action, `warn` for
one that discards state (a revert, a kill, a stop, a clear, a forget), and `bad` for
one that ends the session — `/wechat`'s control screen ships its logout in `bad`.
Keys that only navigate, scroll, or select stay `faint`, so a colored key is always
one worth a second thought.

## A glyph is one column and one meaning

The vocabulary a reader meets most:

| Mark | Reads as |
|---|---|
| `❯` | The prompt, and the row the keys act on. |
| `▸` | A job that is running. |
| `✗` | A job that failed. |
| `⊘` | Something stopped. |
| `⊝` | Something killed. |
| `◌` | Pending: not started yet. |
| `◒` | Half done. |
| `✓` | Done, or a check that passed. |
| `✕` | Crossed out: cancelled, removed, failed a check. |
| `⚠` | Attention: detached, or a finding worth reading. |
| `⚑` | The lead of a team. |
| `⎇` | A branch. |
| `⑂` | A worktree. |
| `↺` | A rewind: the prompt snapshot it returns to. |
| `⬥` | A recorded state. |

Four rules hold the vocabulary together; `lib/tui/glyphs.test.ts` gates two of them:

- **One column.** Never wide, fullwidth, or emoji, which cost two columns in every
  profile. East-Asian *ambiguous* marks are allowed and are recorded as such, because
  a CJK-width profile draws those two.
- **One meaning.** No two marks may say the same thing. Two shapes that both read "go"
  are one too many, and only the words a mark says can catch it.
- **One ink per family**, a rule a reviewer holds rather than a gate — no table records a
  family. A slot's marks share a weight; a filled mark beside a hairline one reads as two.
- **One shape may serve several jobs**, declared once — an arrow is a join and a cue,
  a caret a running job and an open fold.

## Width is columns

Width is terminal columns, never string length: a CJK character or a combining mark
takes a different count than the characters in the source. Every line a surface
returns fits the width it was given, and the arithmetic starts from a width of at
least one.

## Text you did not type

Anything the model wrote, or a file contained, is neutralized before it reaches a
widget: control characters go, and the text collapses to a single line. A program's
own output is a different problem — a log file, a child's stdout, a tailed file — and
its escape sequences are removed whole rather than left behind as printable text.

What you can rely on as a reader: a log line, a filename, or a search result cannot
move the cursor, repaint the screen, or hide what follows it. What that means for the
trust boundary is [security](./security.md)'s subject.

## Building a surface

Reach down the ladder in order and stop at the first rung that works: Pi's own
`ctx.ui.select`, `confirm`, `input`, and `editor`; then `notify`, `setStatus`, and
`setWidget`; then the pi-tui components. Only a surface that needs its own layout and
input gets its own renderer, and nothing ever builds a second terminal renderer.

Then the rules, in one line each:

- A color comes from a role.
- A width is in terminal columns, and a line that cannot fit loses a cell to `…`.
- A glyph is one column, one meaning, and one recorded weight.
- Text you did not type is sanitized at the boundary.
- A widget is derived from state and never authoritative; a frame that derives its
  lines from another memoizes them by width and by identity, and drops the memo when
  it is invalidated.
- Keys are matched by the shared matcher, and the shared bindings stay shared.

The ceilings are not prose. A gate is a test that fails a change; a ratchet is a ledger
whose entries rise only when the reason is written beside one. `COLLAPSED_ROWS` is a
ratchet — an entry per shipped block at 80 columns, its module and suite in the [terminal
kit's README](https://github.com/gavin-hu/my-pi-agent/blob/main/lib/tui/README.md) — and
`test/dependencies.test.ts` a gate: a new row, primitive, or glyph is argued at one of them.

## Related docs

| Topic | Document |
|---|---|
| The chrome these rules draw: header, footer, notices, the control center | [bytefly](./extensions/bytefly.md) |
| Every tool and command, by name | [Tools and commands](./tools-and-commands.md) |
| Themes, and the settings that choose one | [Configuration](./configuration.md) |
| What leaves the machine, and what text is trusted | [Security](./security.md) |
| Every surface, one page each | [All extensions](./extensions/README.md) |
