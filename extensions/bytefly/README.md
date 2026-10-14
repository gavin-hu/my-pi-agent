# bytefly — a two-line, width-adaptive TUI footer

`bytefly` owns the TUI footer this package adds: one compact, colorful,
width-adaptive two-line bar. Pi's own header is left untouched. DeepSeek is
priced from the provider's published yuan rates and peak tariff by default, and
any other model can be priced from your own rates when Pi's catalog does not
match what a provider actually charges.

```
pi --extension ./extensions/bytefly   # load just this extension
pi -e .                               # load the whole @gavin-hu/my-pi-agent package
pi install ./                         # install the package
```

## What it does

The extension owns one surface: the footer. Pi's own header is left in place.

**Footer.** Two lines, each with a left and right zone:

- **Line 1 — identity:** `pwd` and the session name on the left; git state
  (`⎇ branch · ⑂ worktree`) and the `◉` serve chip on the right.
- **Line 2 — resources:** the context gauge and usage meters on the left, the
  mode/alert slot (`⋮ plan`) trailing after a `│` when present; the model and
  thinking level on the right. The gauge is anchored at column 0, so `%` is
  always in the same place.

```
~/repo/my-pi-agent                                                    ⎇ main · ⑂ smoke
▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥0.31 · ↑42k ↓8.0k · R96k CH 87% │ ⋮ plan    opus-4.5 · high
```

(The examples show the default `¥` symbol. For a model the built-in table does
not cover, the number stays Pi's recorded USD amount — see the currency note
under [Configuration](#configuration).)

With no plan mode there is no mode slot, so the `│` is omitted:

```
~/repo/my-pi-agent                                                    ⎇ main · ⑂ smoke
▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥0.31 · ↑42k ↓8.0k · R96k CH 87%             opus-4.5 · high
```

As the terminal narrows, segments shrink and drop by priority rather than
clipping. The branch keeps its name and is dropped when the name no longer
fits, rather than collapsing to a bare glyph:

```
~/repo/project                    ⎇ main · ⑂ smoke
▰▰▰▰▰▰▱▱▱▱ 62% · ¥0.31 │ ⋮ plan    opus-4.5 · high
```

```
project   ⎇ main
62% ⋮   opus-4.5
```

With a named session, the name follows the path and truncates before it drops:

```
~/repo/project · feature-refac…   ⎇ main
▰▰▰▰▰▰▱▱▱▱ 62% │ ⋮ plan         opus-4.5
```

Zero-value meters are omitted, so a fresh session shows only `?/window` instead
of a row of `¥0.00 · ↑0 ↓0 · R0 W0`. Unknown context usage shows a muted `?`
with no gauge (known `0%` still draws the empty gauge), so unknown and zero stay
distinct. Cost keeps the configured precision — the segment drops rather than
rounding to a misleading `¥0.3` — and a positive amount below one minor unit
shows as `¥<0.01` rather than `¥0.00`.

DeepSeek needs no config file at all: the bar prices it from the published yuan
rates and peak tariff built into [`config.ts`](./config.ts). A
`bytefly.json` adds models of your own, or replaces a built-in entry:

```
~/repo/project                                                          ⎇ main
▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥2.50 · ↑42k ↓8.0k · R96k CH 87%             opus-4.5 · high
```

## Commands

| Command | What it does |
|---|---|
| `/bytefly` | Toggle the footer on or off. |
| `/bytefly status` | Report whether the footer is on. |

The `status` subcommand completes with Tab.

## Behaviour by mode

The footer is installed only in interactive (`tui`) sessions. In RPC, JSON, and
print modes the extension loads, registers `/bytefly`, and does nothing visible.

## Configuration

The footer's own content and layout are tuned in [`config.ts`](./config.ts) —
thresholds, gauge glyphs and widths, separators, icons, and status keys. The
price calculation is configured by a JSON file, read the way every other
extension reads its config:

- `~/.pi/agent/bytefly.json` (global)
- `<cwd>/.pi/bytefly.json` (project; overrides the global file)

A `chrome.json` saved under the extension's former name is moved to
`bytefly.json` in the same directory on load (and read in place from an
unwritable directory), so an existing price configuration survives the rename.

Both are optional, and neither is needed for DeepSeek. The built-in table is the
base layer for every session: DeepSeek is priced in yuan at the published peak
and off-peak rates, and every other model keeps Pi's recorded cost, whose number
comes from Pi's catalog. A file can change the currency, replace a built-in
rate, or add rates of your own. A malformed file is ignored, a wrong-typed value
falls back to its default, and an unknown timezone drops the schedule rather
than the session.

```json
{
  "currency": { "symbol": "¥", "decimals": 2 },
  "fallbackToRecordedCost": true,
  "rates": {
    "deepseek/deepseek-flash":  { "input": 2, "output": 8, "cacheRead": 0.04, "cacheWrite": 0, "offPeakMultiplier": 0.5 },
    "deepseek/deepseek-v4-pro": { "input": 9, "output": 27, "cacheRead": 0.3, "cacheWrite": 0, "offPeakMultiplier": 0.5 }
  },
  "peak": {
    "timezone": "Asia/Shanghai",
    "windows": [
      { "days": [1, 2, 3, 4, 5], "from": "09:00", "to": "12:00" },
      { "days": [1, 2, 3, 4, 5], "from": "14:00", "to": "18:00" }
    ]
  }
}
```

That file restates the built-in defaults, so on its own it changes nothing; it
is shown to document every key at once.

| Key | Meaning |
|---|---|
| `currency.symbol` | Printed before the number; at most four characters. Default `¥`. |
| `currency.decimals` | Digits after the point, 0–4. Default `2`. |
| `fallbackToRecordedCost` | Use Pi's recorded cost for a record no rate matches. Default `true`. |
| `rates` | Per-million-token prices in `currency`, keyed by `provider/model`; the built-in DeepSeek table is the base, and a key stated here replaces its entry. |
| `rates.<key>.input` · `output` · `cacheRead` · `cacheWrite` | Rate per token class; a class left out is free. |
| `rates.<key>.offPeakMultiplier` | Multiplier outside every peak window, 0–1. Default `1`. |
| `peak.timezone` | The IANA zone the windows are stated in. |
| `peak.windows` | `days` (1 = Monday … 7 = Sunday; omitted means every day), `from` inclusive, `to` exclusive, `HH:MM` local; a `to` before `from` wraps midnight. An empty list means every moment is peak. |

Rates merge key by key across the two files, so a project file can override one
model without restating the rest; a key present in both is replaced, not merged
field by field. No windows means every moment is peak, so a rate with
`offPeakMultiplier: 0.5` and no schedule stays flat. The file is read when the
footer is installed, so a new session — or `/bytefly` toggled off and on —
picks up an edit.

**Mixing currencies is the sharp edge of the built-in default.** A record priced
from `rates` or the built-in table is in `currency.symbol` units — yuan for
DeepSeek — while a record that fell back carries Pi's USD number under that same
symbol. A session mixing DeepSeek with another provider therefore sums two
currencies into one number. Either cover every model you use (a `"*"` catch-all
helps) and set `fallbackToRecordedCost: false`, or set the symbol to `"$"` and
treat the rates purely as an off-peak correction.

## Cost calculation

Pi prices every model call from its bundled catalog in USD, and the provider API
never returns a price. Built-in and configured rates replace that for the models
they match:

- **Which built-in rates.** [`config.ts`](./config.ts) ships DeepSeek's published
  yuan prices, with the peak schedule that doubles the price during peak hours
  ([DeepSeek's pricing page](https://api-docs.deepseek.com/quick_start/pricing)).
  They are ordinary rate entries, so a `bytefly.json` key replaces one of
  them, and the schedule is the default `peak` every rate is judged against.
- **Which rate.** The most specific key wins, with the model segment outranking
  the provider one: `provider/model`, then `*/model`, then `provider/*`, then
  `*`. A segment ending in a star is a prefix match (`*/gpt-*`); equally
  specific keys are resolved in file order.
- **Which formula.** `tokens × rate ÷ 1,000,000`, summed over the four token
  classes. Cache tokens are never billed again as fresh input.
- **Which tariff.** Each record is dated by its session entry, so a window is
  applied at the local time the tokens were actually spent: an off-peak turn
  stays off-peak when peak starts. A record with no usable timestamp is priced
  at peak, because it cannot be dated.
- **Which source.** A record with no matching rate — built-in or configured —
  keeps Pi's recorded cost, or contributes nothing when
  `fallbackToRecordedCost` is `false`.

For example, DeepSeek flash at `¥2` in and `¥8` out per million, with the
published peak windows and `offPeakMultiplier: 0.5`, prices a 1M-in + 1M-out
turn at `¥10.00` at peak and `¥5.00` off-peak. That example is worked end to end
in [`price/price.test.ts`](./price/price.test.ts), which also prices the built-in
table with no config file at all.

## Content and colors

| Segment | Line / zone | Color | Drops |
|---|---|---|---|
| pwd | 1 left | dim | last |
| session | 1 left | muted, bracketed | after worktree |
| serve | 1 right | success glyph + accent port | first |
| branch | 1 right | muted (warning when detached) | last |
| worktree | 1 right | success | first |
| context gauge + `%` | 2 left | muted ≤70 · warning 71–90 · error >90 | never |
| `/window` | 2 left | dim | before cost |
| cost | 2 left | muted | after tokens |
| tokens `↑in ↓out` | 2 left | dim | after cache |
| cache `R… CH …%` | 2 left | dim | first |
| statuses | 2 left | as emitted by each extension | before the model clips |
| model | 2 right | accent | never |
| thinking level | 2 right | thinking token | before cost |

The worktree status is read from the `worktree` status key, so the
[worktree](../worktree/) extension and the bar agree. The serve chip is read
from the `serve` status key published by [file-browser](../file-browser/) while
its server runs, and shows the two-tone `◉ <port>` (green glyph, accent port).
The trailing slot shows plan-style alerts when present and is omitted otherwise;
a plan chip's trailing plan file name is dropped, so the slot reads `⋮ plan`
even though the built-in footer keeps the name. An alert (a failed job) sorts to
the front of the slot. The slot trails the meters after a `│`, so the context
gauge always starts the line. It keeps each extension's own colour when it
compacts, and it is droppable: a tight bar drops the slot rather than truncating
the model, which sits at the end of the line.

## Limitations

- **One built-in provider.** DeepSeek is the only provider with a built-in
  table; another provider's currency and tariff have to be stated in
  `bytefly.json`.
- **Holidays.** A tariff that excludes public holidays — DeepSeek's peak window
  does — cannot be expressed. A weekend can, by leaving `days` 6 and 7 out.
- **One schedule.** A single `peak` section applies to every rate. Only a rate
  with an `offPeakMultiplier` below 1 is affected by it, so two providers with
  different time-of-day tariffs cannot both be described.
- **No tiers, no special cache writes.** Per-request input tiers and
  Anthropic's 2× one-hour cache write are not modelled; Pi's recorded cost
  covers those models when no rate is configured.
- **No FX conversion.** A fallback record is USD and is never converted into
  the configured currency.
- **The displayed number is the total, rounded once** — not the sum of rounded
  records.

## Non-goals

- No per-segment CLI: the bar's look lives in `config.ts`, the price in
  `bytefly.json`.
- No per-model cost breakdown, no `/bytefly price`, and no on-screen marker
  for which tariff or which source produced a number.
- No todo-count segment; the [todo](../todo/) widget already shows progress.
- No shelling out for git ahead/behind; the footer data provider exposes only
  the branch.
- No header customization: Pi's built-in header is kept as is. The footer owns
  the session, model, and working-directory data.

The built-in footer's `(auto)` auto-compact indicator and `(sub)`
subscription-cost marker are not reachable from `ExtensionContext` (there is no
`autoCompactEnabled` or provider subscription check), so the bar omits them
rather than showing a wrong value.

## Pi integration

| Integration point | Details |
|---|---|
| Footer | `ctx.ui.setFooter` with a custom component, replacing Pi's built-in footer; installed only when `ctx.mode === "tui"` and the footer is on. Pi's header is not touched. |
| Command | `/bytefly [status]` toggles the footer and reports its state (tui only; a no-op elsewhere), with Tab completion. |
| Status routing | Reads `footerData.getExtensionStatuses()` (a custom footer replaces the built-in one entirely); `worktree` routes to line 1, plan/alert statuses to line 2's trailing slot. |
| Config | `bytefly.json` from the agent directory and `<cwd>/.pi`, read when the footer is installed — a new session, or `/bytefly` toggled back on. A legacy `chrome.json` is migrated to `bytefly.json` on load. Nothing watches the file. |
| Data sources | `footerData.getGitBranch()`, `footerData.getAvailableProviderCount()`, `ctx.getContextUsage()`, `ctx.sessionManager.getEntries()`, `ctx.sessionManager.getSessionName()`, `ctx.model`; subscribes to `footerData.onBranchChange` to repaint. |
| State storage | None besides the one-time config migration. The bytefly reads session entries and the price config (a memoized scan) and writes no tool-result `details` or `pi.appendEntry`; it renames a legacy `chrome.json` to `bytefly.json`. |
| Lifecycle | `session_start` installs the footer; `session_tree` reinstalls; `session_shutdown` restores Pi's built-in footer and disposes the branch subscription. |

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
  and `serve` are location, plan/alert is mode). The [wechat](../wechat/)
  extension publishes `✆ wechat` while its bridge runs, joining the mode/alert
  slot; this is why the bar must render `getExtensionStatuses()` at all.
- **Serve joins the git state.** The `◉ <port>` chip is routed beside `⎇` branch
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
- **Statuses compact with their colour.** A themed status's compact icon form
  reattaches its opening and closing SGR sequences around the visible text, so a
  red `✗1` stays red instead of losing its colour exactly when the bar tightens.
  A two-token `icon count` badge (for `rewind`: `↺ 2`) compacts to `↺2`, keeping
  the count. The slot sorts an alert (a failed job) ahead of the modes and is
  droppable, so it goes before the model is clipped.
- **Neutral by default; color means something.** Only the context gauge carries
  status color, and it stays `muted` below 70%; cost is `muted`, the session and
  branch are `muted`, and tokens/cache/window are `dim`, so yellow and red are
  reserved for the gauge crossing a threshold rather than always on.
- **Data is read fresh, except the usage scan.** The component resolves the
  theme through a getter and reads a fresh snapshot each render. The expensive
  part — summing token/cost totals across the session — is memoized by
  `sessionId:leafId` (every append moves the leaf), avoiding
  `getEntryCount()`, which is not exposed on the read-only session manager.
- **TTY-only, fail-safe.** The bytefly is installed only in `tui` mode;
  non-interactive runs load the extension and change nothing.
- **The price is a stage, not a branch in the renderer.** Entries are reduced to
  usage records (`collect/`), records are priced into totals (`price/`), and the
  snapshot is drawn (`render/`). Pricing is a pure function of records and rates
  — no session, terminal, or theme to stub — which is what lets the published
  DeepSeek example be a unit test. The recorded-cost fallback keeps the stage
  opt-in per model: a record with no matching rate is exactly Pi's own number,
  in Pi's catalog units. The built-in DeepSeek table is only the default value
  of `rates`, so nothing in the pricer is provider-specific.
- **DeepSeek is built in, not bundled as a catalog.** Its published price is in
  yuan at two tariffs, while Pi's catalog holds one USD number per model, so an
  unconfigured DeepSeek session showed a bill that was neither the right
  currency nor the right amount outside peak. The table sits beside `CONFIG` as
  the default `rates` and `peak`, which keeps config in charge and leaves the
  pricer a pure function of records and rates.
- **A record is dated, not the frame.** The peak schedule is evaluated against
  each entry's own timestamp, so a total is stable as the clock crosses a
  boundary — and memoizing the scan by `sessionId:leafId` stays valid.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: install/restore the footer; `/bytefly`. |
| `config.ts` | Bar tuning (`CONFIG`), the built-in DeepSeek rates and peak tariff, and the `bytefly.json` schema, defaults, normalizer, loader, and `chrome.json` migration. |
| `types.ts` | `StatusSnapshot`, `Segment`, `LineSpec`, the price config, `UsageRecord`, footer/TUI shapes. |
| `collect/entries.ts` | Session entries → usage records, each resolved to the model in effect. |
| `collect/snapshot.ts` | Snapshot assembly; memoized pricing scan per branch leaf. |
| `price/rates.ts` | Model-key matching: exact and wildcard, most specific first. |
| `price/schedule.ts` | Peak-window parsing and evaluation in a configured zone. |
| `price/price.ts` | Records → totals: rates, peak multiplier, recorded-cost fallback. |
| `render/format.ts` | Pure formatters (tokens, cost in the configured currency, cwd, gauge, colors). |
| `render/segments.ts` | The segment builders: forms, weights, separators, colors. |
| `render/lines.ts` | Snapshot → two `LineSpec`s; status routing. |
| `render/layout.ts` | Width reduction and right-zone folding. |
| `render/footer.ts` | `StatusBar` component and footer factory. |

## Testing

`extensions/bytefly/` covers the install/restore/toggle lifecycle
(`extension`),
the formatters (`render/format`), entry
reduction and model inheritance (`collect/entries`), snapshot assembly and its
memoization (`collect/snapshot`), rate matching (`price/rates`), window parsing
and peak evaluation in two zones (`price/schedule`), the pricing formula, the
off-peak multiplier, the built-in DeepSeek table with no config file, and the
fallback (`price/price`), the config schema, its clamping, the built-in defaults
and their replacement, and the two file layers (`config`), the legacy
`chrome.json` migration (`config`), zone/priority
assignment
(`render/lines`), the reduction, separator collapse, and right-zone folding
across a width sweep from 6 to 120 plus wide characters (`render/layout`), exact
golden output at fixed widths (`render/render`), and the install/skip/restore/
toggle lifecycle plus a config-driven price (`extension`).
