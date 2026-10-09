# status-bar — a two-line colorful footer for Pi

Replaces Pi's built-in footer with one compact, colorful, width-adaptive bar.
It surfaces the information this package already produces — the working
directory and session name, git branch and worktree, plan mode, context usage,
and cost/token totals — in one consistent place.

```
pi --extension ./extensions/status-bar    # load just this extension
pi -e .                                  # load the whole @gavin-hu/my-pi-agent package
pi install ./                            # install the package
```

## What it does

Two lines, each with a left and right zone:

- **Line 1 — identity:** `pwd` and the session name on the left; git state
  (`⎇ branch · ⑂ worktree`) and the `⊙` serve chip on the right.
- **Line 2 — resources:** the context gauge and usage meters on the left, the
  mode/alert slot (`≡ plan`) trailing after a `│` when present; the model and
  thinking level on the right. The gauge is anchored at column 0, so `%` is
  always in the same place.

```
~/repo/my-pi-agent                                                    ⎇ main · ⑂ smoke
▰▰▰▰▰▰▱▱▱▱ 62%/200k · $0.31 · ↑42k ↓8.0k · R96k CH 87% │ ≡ plan    opus-4.5 · high
```

With no plan mode there is no mode slot, so the `│` is omitted:

```
~/repo/my-pi-agent                                                    ⎇ main · ⑂ smoke
▰▰▰▰▰▰▱▱▱▱ 62%/200k · $0.31 · ↑42k ↓8.0k · R96k CH 87%             opus-4.5 · high
```

As the terminal narrows, segments shrink and drop by priority rather than
clipping. The branch keeps its name and is dropped when the name no longer
fits, rather than collapsing to a bare glyph:

```
~/repo/project                    ⎇ main · ⑂ smoke
▰▰▰▰▰▰▱▱▱▱ 62% · $0.31 │ ≡ plan    opus-4.5 · high
```

```
project   ⎇ main
62% ≡   opus-4.5
```

With a named session, the name follows the path and truncates before it drops:

```
~/repo/project · feature-refac…   ⎇ main
▰▰▰▰▰▰▱▱▱▱ 62% │ ≡ plan         opus-4.5
```

Zero-value meters are omitted, so a fresh session shows only `?/window` instead
of a row of `$0.00 · ↑0 ↓0 · R0 W0`. Unknown context usage shows a muted `?`
with no gauge (known `0%` still draws the empty gauge), so unknown and zero stay
distinct. Cost always keeps two decimals — the segment drops rather than
rounding to a misleading `$0.3` — and a positive sub-cent spend shows as
`<$0.01` rather than `$0.00`.

## Commands

| Command | What it does |
|---|---|
| `/status-bar` | Toggle between the custom bar and Pi's built-in footer. |

## Behaviour by mode

The bar is installed only in interactive (`tui`) sessions. In RPC, JSON, and
print modes the extension loads, registers `/status-bar`, and does nothing
visible.

## Configuration

There is no per-segment CLI or config-file surface; tuning lives in
[`config.ts`](./config.ts) — thresholds, gauge glyphs and widths, separators,
icons, and status keys.

## Content and colors

| Segment | Line / zone | Color | Drops |
|---|---|---|---|
| pwd | 1 left | dim | last |
| session | 1 left | dim | after worktree |
| serve | 1 right | success glyph + accent port | first |
| branch | 1 right | purple (warning when detached) | last |
| worktree | 1 right | success | first |
| context gauge + `%` | 2 left | muted ≤70 · warning 71–90 · error >90 | never |
| `/window` | 2 left | dim | before cost |
| cost | 2 left | muted | after tokens |
| tokens `↑in ↓out` | 2 left | dim | after cache |
| cache `R… CH …%` | 2 left | dim | first |
| statuses | 2 left | as emitted by each extension | last |
| model | 2 right | accent | never |
| thinking level | 2 right | thinking token | before cost |

The worktree status is read from the `worktree` status key, so the
[worktree](../worktree/) extension and the bar agree. The serve chip is read
from the `serve` status key published by [file-browser](../file-browser/) while
its server runs, and shows the two-tone `⊙ <port>` (green glyph, accent port).
The trailing slot shows plan-style alerts when present and is omitted otherwise;
a plan chip's trailing plan file name is dropped, so the slot reads `≡ plan`
even though the built-in footer keeps the name. The slot trails the meters
after a `│`, so the context gauge always starts the line.

## Non-goals

- No per-segment CLI configuration; edit `config.ts`.
- No todo-count segment; the [todo](../todo/) widget already shows progress.
- No shelling out for git ahead/behind; the footer data provider exposes only
  the branch.

The built-in footer's `(auto)` auto-compact indicator and `(sub)`
subscription-cost marker are not reachable from `ExtensionContext` (there is no
`autoCompactEnabled` or provider subscription check), so the bar omits them
rather than showing a wrong value.

## Pi integration

| Integration point | Details |
|---|---|
| Footer | `ctx.ui.setFooter` with a custom component, replacing Pi's built-in footer; installed only when `ctx.mode === "tui"`. |
| Command | `/status-bar` toggles the custom bar and the built-in footer (tui only; a no-op elsewhere). |
| Status routing | Reads `footerData.getExtensionStatuses()` (a custom footer replaces the built-in one entirely); `worktree` routes to line 1, plan/alert statuses to line 2's trailing slot. |
| Data sources | `footerData.getGitBranch()`, `footerData.getAvailableProviderCount()`, `ctx.getContextUsage()`, `ctx.sessionManager.getEntries()`, `ctx.sessionManager.getSessionName()`; subscribes to `footerData.onBranchChange` to repaint. |
| State storage | None written. The bar reads session entries (a memoized usage scan) and writes no tool-result `details` or `pi.appendEntry`. |
| Lifecycle | `session_start` installs the footer; `session_tree` reinstalls it; `session_shutdown` restores the built-in footer and disposes the branch subscription. |

## Design notes

- **Two lines, four zones.** Line 1 is identity (`pwd` left, branch + worktree
  right); line 2 is resources (meters left, model + level right). This keeps
  "where am I / what state" separate from "how much am I burning".
- **The gauge is anchored at column 0.** A leading mode slot would shift the
  context percentage left and right as plan mode came and went; trailing it
  after a `│` keeps the percentage in a fixed place while the mode stays
  visible as the meters drop.
- **Statuses are routed, not repeated.** The built-in footer renders every
  `setStatus` value on its own line; the bar splits them by meaning (`worktree`
  and `serve` are location, plan/alert is mode). This is why it must render
  `getExtensionStatuses()` at all.
- **Serve joins the git state.** The `⊙ <port>` chip is routed beside `⎇` branch
  and `⑂` worktree rather than after `pwd`, so the left zone stays the
  filesystem identity (path + session name) and every "where am I / what is
  running" fact sits on line 1 right.
- **Segments degrade; they do not clip.** Each `Segment` carries progressively
  shorter `forms` and a `weight`; the layout advances the lowest-priority form
  or drops the lowest-priority segment, and only truncates once everything is
  minimal. The gauge steps `10 → 5 → 3 → 0` blocks, tokens drop before cost,
  and a branch that no longer fits its name drops rather than collapsing to a
  glyph. The gauge floors its fill and shows at least one block for any
  non-zero usage, so it reads full only at 100% and a small percentage never
  disappears; unknown usage draws no gauge at all. Only at extreme widths does
  `truncateToWidth` clip the remaining text.
- **Separators shrink to a single space.** Padded separators (` · `, ` │ `)
  collapse to one space before `truncateToWidth` applies, so adjacent segments
  never collide and the ellipsis never replaces a `│` with nothing after it.
- **Statuses compact from plain text.** A themed status's compact icon form is
  derived from the visible text, not the styled string, whose opening SGR code
  lacks its reset and would bleed color into the rest of the line. A two-token
  `icon count` badge (for `rewind`: `↺ 2`) compacts to `↺2`, keeping the count.
- **Neutral by default; color means something.** Only the context gauge carries
  status color, and it stays `muted` below 70%; cost is `muted` and
  tokens/cache/window are `dim`, so yellow and red are reserved for the gauge
  crossing a threshold rather than always on.
- **Data is read fresh, except the usage scan.** The component resolves the
  theme through a getter and reads a fresh snapshot each render. The expensive
  part — summing token/cost totals across the session — is memoized by
  `sessionId:leafId` (every append moves the leaf), avoiding
  `getEntryCount()`, which is not exposed on the read-only session manager.
- **TTY-only, fail-safe.** The footer is installed only in `tui` mode;
  non-interactive runs load the extension and change nothing.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: install/restore the footer, `/status-bar`. |
| `config.ts` | Thresholds, gauge glyphs, separators, icons, status keys. |
| `types.ts` | `StatusSnapshot`, `Segment`, `LineSpec`, footer/TUI shapes. |
| `snapshot.ts` | Gather data; memoized usage/cost/cache scan. |
| `format.ts` | Pure formatters (tokens, cost, cwd, gauge, colors). |
| `lines.ts` | Snapshot → two `LineSpec`s; status routing. |
| `layout.ts` | Width reduction and right-zone folding. |
| `footer.ts` | `StatusBar` component and footer factory. |

## Testing

`extensions/status-bar/` covers the pure formatters (`format`), the usage scan and
snapshot assembly (`snapshot`), zone/priority assignment (`lines`), the
reduction, separator collapse, and right-zone folding across a width sweep from
6 to 120 plus wide characters (`layout`), exact golden output at fixed widths
(`render`), and the install/skip/restore/toggle lifecycle (`extension`).
