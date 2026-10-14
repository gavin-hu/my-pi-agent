# bytefly — the TUI header, footer, turn rule, extensions picker, and doctor

`bytefly` owns the terminal chrome, configuration, and diagnostics surfaces
this package adds: one themed startup header that recolors Pi's brand mark and
version, one compact, colorful, width-adaptive two-line footer, a labeled rule
that marks each completed turn in the transcript, the `/extensions` picker that
lists and toggles every resolved Pi extension, and the `/doctor` surface that
reports whether each extension has what it needs. DeepSeek is priced from the
provider's published yuan rates and peak tariff by default, and any other model
can be priced from your own rates when Pi's catalog does not match what a
provider actually charges.

```
pi --extension ./extensions/bytefly   # load just this extension
pi -e .                               # load the whole @gavin-hu/my-pi-agent package
pi install ./                         # install the package
```

## What it does

The extension owns five surfaces: the startup header, the footer, the rule
between completed turns, the `/extensions` picker, and the `/doctor` report.

**Header.** Pi's brand mark and version, drawn from the active theme's tokens
(`accent` and `warning`, plus `dim` for the version) instead of the fixed brand
palette, so the mark follows `bytefly-dark` and `bytefly-light`. The content is
Pi's own — only the styling and spacing change, tuned in
[`header/config.ts`](./header/config.ts) — and it is installed only in
interactive (`tui`) sessions.

```
 Pi v1.2.0
```

(The default is the two-tone `Pi` wordmark; set `mark: "logo"` for the two-line
half-block logo, or `mark: "none"` to show only the version.)

**Footer.** Two lines, each with a left and right zone:

- **Line 1 — identity:** `pwd` and the session name on the left; git state
  (`⎇ branch · ⑂ worktree`) and the `◉` browse chip on the right.
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
rates and peak tariff built into [`footer/price/config.ts`](./footer/price/config.ts). A
`bytefly.json` adds models of your own, or replaces a built-in entry:

```
~/repo/project                                                          ⎇ main
▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥2.50 · ↑42k ↓8.0k · R96k CH 87%             opus-4.5 · high
```

**Turn separator.** After each completed turn the extension appends an inert
entry and draws a centered `╌╌╌ turn N ╌╌╌` rule across the transcript; see
[Turn separator](#turn-separator). No config file is needed and there is no
command.

**Extensions picker.** `/extensions` opens a keyboard-driven dock list of every
Pi extension the session resolves — across personal settings and, when trusted,
the project — and writes a `+pattern` / `-pattern` toggle into the matching
`settings.json`; see [Extensions picker](#extensions-picker). There is no
config file, and changes apply on reload.

**Doctor.** `/doctor` reports whether each extension has what it needs at
runtime — a binary on `PATH`, an optional package, a login/state file, or a
config file that fails to parse — and `run_doctor` returns the same report as
text and typed data. Only a missing *hard* requirement warns at session start;
everything else waits in the report. See [Doctor](#doctor).

## Commands

| Command | What it does |
|---|---|
| `/bytefly` | Toggle the footer on or off. |
| `/bytefly status` | Report whether the footer is on. |
| `/extensions` | Open the extensions picker in the TUI, or print the grouped list elsewhere. |
| `/doctor [extension] [refresh]` | Probe the extensions and show the report; in the TUI this opens a docked list screen. |

The `status` subcommand completes with Tab.

## Behaviour by mode

The header, footer, and turn rule are installed only in interactive (`tui`)
sessions; `/bytefly` is a no-op elsewhere. The picker is available in every
mode: in `tui` it opens the dock screen, while in RPC, JSON, and print modes
`/extensions` prints the same grouped list and does not toggle. `/doctor` probes
in every mode: in `tui` it opens its list screen, while RPC, JSON, and print
modes print the same report, and the proactive session-start warning is skipped
when there is no UI.

## Configuration

The header's own styling and layout are tuned in [`header/config.ts`](./header/config.ts) —
the mark and version tokens, and the padding and gap. The footer's content and
layout are tuned in [`footer/config.ts`](./footer/config.ts) — thresholds, gauge
glyphs and widths, separators, icons, and status keys. The turn separator has no
JSON either: its glyph, label prefix, padding, and colors are tuned in
[`separator/config.ts`](./separator/config.ts). The price
calculation is configured by a JSON file, read the way every other extension
reads its config:

- `~/.pi/agent/bytefly.json` (global)
- `<cwd>/.pi/bytefly.json` (project; overrides the global file)

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

### `doctor.json`

The doctor surface has its own file, read the same way:

- `~/.pi/agent/doctor.json` (global)
- `<cwd>/.pi/doctor.json` (project; overrides the global file)

| Key | Default | Meaning |
|---|---|---|
| `proactive` | `true` | Probe the extensions with hard requirements at session start and warn once when something is missing. |
| `timeoutMs` | `2000` | Per-probe timeout for one spawned command, clamped to 100–30000. |
| `skip` | `[]` | Extension names to leave out of every report. |

A malformed `doctor.json` is ignored like every other config file — and named
by the report `doctor` produces.

## Security

- Project settings are only read or written when the project is trusted
  (`ctx.isProjectTrusted()`); an untrusted session offers Global scope only.
- Discovery never installs or fetches a package: missing sources are skipped.
- The picker registers no model-facing tool, so the model cannot change resource
  configuration.

## Cost calculation

Pi prices every model call from its bundled catalog in USD, and the provider API
never returns a price. Built-in and configured rates replace that for the models
they match:

- **Which built-in rates.** [`footer/price/config.ts`](./footer/price/config.ts) ships DeepSeek's published
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
in [`footer/price/price.test.ts`](./footer/price/price.test.ts), which also prices the built-in
table with no config file at all.

## Content and colors

| Segment | Line / zone | Color | Drops |
|---|---|---|---|
| pwd | 1 left | dim | last |
| session | 1 left | muted, bracketed | after worktree |
| browse | 1 right | success glyph + accent port | first |
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
[worktree](../worktree/) extension and the bar agree. The browse chip is read
from the `browse` status key published by [file-browse](../file-browse/) while
its server runs, and shows the two-tone `◉ <port>` (green glyph, accent port).
The trailing slot shows plan-style alerts when present and is omitted otherwise;
a plan chip's trailing plan file name is dropped, so the slot reads `⋮ plan`
even though the built-in footer keeps the name. An alert (a failed job) sorts to
the front of the slot. The slot trails the meters after a `│`, so the context
gauge always starts the line. It keeps each extension's own colour when it
compacts, and it is droppable: a tight bar drops the slot rather than truncating
the model, which sits at the end of the line.

## Turn separator

`agent_settled` fires once after an agent run fully settles — exactly one user
turn — which is why it is used instead of `turn_end` (that fires once per
assistant message, so tool-calling rounds would each get a line). On each
settled run the extension appends an inert custom entry and a renderer draws
it:

```
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ turn 3 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
```

- The turn number is `count(separators on the current branch) + 1`, so a
  resumed or forked session continues the parent's numbering and abandoned
  branches do not leak counts.
- The entry is excluded from LLM context, so it costs no tokens, and it
  survives resume and fork. It is drawn under the `bytefly-separator` custom
  entry type.
- The line is centered and width-adaptive: the label is filled out with the
  glyph, and when it cannot fit the line becomes a plain dashed rule rather
  than overflowing.
- The rule is installed only in interactive (`tui`) sessions; RPC, JSON, and
  print sessions append nothing.
- Separators recorded by the retired `turn-separator` extension are not
  rendered, and `PI_DISABLED_EXTENSIONS=turn-separator` no longer affects the
  rule; disable the whole extension with `bytefly` instead.
- There is no runtime command; the glyph, label prefix, padding, and colors are
  tuned in [`separator/config.ts`](./separator/config.ts).

## Extensions picker

`/extensions` is a keyboard-driven dock list of every extension Pi resolves for
the session, so the list matches what actually loads. It reuses Pi's own settings
and package resolution (`SettingsManager` plus `DefaultPackageManager` with
`onMissing: "skip"`), so opening the screen never installs or fetches a package.

- Lists every resolved extension, grouped by source (each package, user
  settings, project settings), sorted packages-first and then by display name.
- Omits `bytefly` itself, so the tool that manages the list is never a row.
  Turn the footer off with `/bytefly`; use `pi config` to disable bytefly
  entirely.
- Shows whether each one is enabled (`[x]`) or disabled (`[ ]`).
- Toggles the focused extension with `Space` / `Enter`, writing `+pattern` /
  `-pattern` into `extensions` (and package filter objects) in the active
  scope.
- Switches the write scope with `Tab`: **Global** (personal
  `settings.json`) or **Project** (`.pi/settings.json`, only when the project
  is trusted).
- Offers a reload after pending changes, so the new selection takes effect
  without leaving the session.

### Keys

| Key | Effect |
|---|---|
| `Space` / `Enter` | Toggle the focused extension. |
| `Tab` | Switch between Global and Project scope. |
| `↑`/`↓`, `j`/`k` | Move the selection. |
| `PgUp`/`PgDn` | Move a page. |
| `g` / `G`, `Home` / `End` | Jump to the first or last extension. |
| `Esc` / `Ctrl+C` | Close the screen. |

Mouse wheel scrolling works; every action also has a keyboard path.

## Doctor

`/doctor` probes every declared extension and reports each check as `ok`,
`missing`, `degraded`, or `info`; `run_doctor` returns the same report as text
plus a typed `structuredContent` report. Only `missing` and `degraded` are
problems: `missing` means an enabled extension cannot do its job, `degraded`
means reduced capability — an optional package that is absent, a config file
that fails to parse, a login that has not happened. `doctor` never changes
anything and never installs anything.

`/doctor <extension>` narrows the report to one extension — including the
checks that passed — and `/doctor refresh` ignores the findings cached earlier
in the session. In the TUI the report is a docked list screen: one row per
extension with a severity glyph, the focused extension's findings underneath.
`Enter` switches between problems only and every check, `r` re-probes, `Esc`
closes; while a re-probe is in flight the hint shows `refreshing…` and a second
`r` is ignored, so probes cannot stack. Every other mode prints the same report
as text.

### Keys

| Key | Effect |
|---|---|
| `↑`/`↓`, `j`/`k` | Move the selection. |
| `PgUp`/`PgDn` | Move a page. |
| `g` / `G`, `Home` / `End` | Jump to the first or last extension. |
| `Enter` | Toggle between problems only and every check. |
| `r` | Re-probe. |
| `Esc` | Close the screen. |

### What is checked

| Extension | Hard requirement | Optional / degraded |
|---|---|---|
| worktree | `git` | `.worktreeinclude` symlinks need symlink support |
| rewind | `git` | — |
| document | — | — |
| subagent | a runnable nested `pi` | project-local agents need a trusted project |
| plan | — | `git` for project-local `.pi/plans`; an interactive UI |
| memory | — | `git` for the project-scope root |
| file-browse | — | `git` for the branch chip; the browser opener is best-effort |
| web-access | — | `unpdf` |
| wechat | — | `wechat/credentials.json` (not logged in) |
| job | — | Windows has no `EXIT` trap; `ps` is POSIX-only |
| todo, goal | — | their config files |
| bytefly | — | TUI only for the header, footer, and turn rule; the picker's project scope needs a trusted project; `bytefly.json` and `doctor.json` |
| question | — | needs an interactive UI |

Every extension that reads a config file also gets the malformed-JSON check:
the file and the parse error are named instead of being silently ignored. The
install guidance a tool error shows and the hint this report prints come from
the same entry in `lib/requirements.ts`, so the two cannot drift.

## Limitations

- **The picker manages only the `extensions` resource type.** Skills, prompts,
  and themes are handled by Pi's own `pi config`.
- **Built-in extensions are not listed** (`builtin:mcp`, `builtin:codemode`, …):
  their authoritative names are not exposed to extensions. Use `pi config`.
- **Packages are not installed, removed, or updated here**; use `pi install`,
  `pi remove`, and `pi update`.
- **Project toggles are two-state** (`enable`/`disable`). Resetting an override
  back to "inherit" is done in `pi config`.
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
- **`doctor` can only check what is declared.** A new extension with no
  `REQUIREMENTS` entry is invisible to it — `test/structure.test.ts` fails on
  exactly that, which is why the table cannot rot quietly.
- **The disabled check reads `PI_DISABLED_EXTENSIONS`** through `lib/env.ts`; it
  does not read Pi's own `settings.json` disable list, so an extension disabled
  only there may still be probed.
- **A probe proves a binary runs, not that it works:** a `git` that crashes on a
  specific repository is still `ok`.
- **Config scope is checked for `<agent-dir>/<file>.json` and
  `<cwd>/.pi/<file>.json` only**; a `jobs.json` `registryDir` override is not
  followed.

## Non-goals

- No per-segment CLI: the bar's look lives in `footer/config.ts`, the price in
  `bytefly.json`.
- No per-model cost breakdown, no `/bytefly price`, and no on-screen marker
  for which tariff or which source produced a number.
- No todo-count segment; the [todo](../todo/) widget already shows progress.
- No shelling out for git ahead/behind; the footer data provider exposes only
  the branch.
- No session or model data in the header: it shows Pi's brand mark and version
  only. The footer owns the session, model, and working-directory data.
- No auto-fix: `doctor` reports the install command; it never runs it.
- No aggregation of runtime failures: a tool that errored earlier in the session
  is not a prerequisite problem, and `doctor` does not pretend to know about it.
- No status chip for the doctor report: it is on demand plus one warning, not a
  permanent footer segment.

The built-in footer's `(auto)` auto-compact indicator and `(sub)`
subscription-cost marker are not reachable from `ExtensionContext` (there is no
`autoCompactEnabled` or provider subscription check), so the bar omits them
rather than showing a wrong value.

## Pi integration

| Integration point | Details |
|---|---|
| Header | `ctx.ui.setHeader` with a custom component, replacing Pi's built-in header; installed only when `ctx.mode === "tui"`. The mark and version are drawn from the active theme's tokens. |
| Footer | `ctx.ui.setFooter` with a custom component, replacing Pi's built-in footer; installed only when `ctx.mode === "tui"` and the footer is on. |
| Command | `/bytefly [status]` toggles the footer and reports its state (tui only; a no-op elsewhere), with Tab completion. |
| Turn separator | `registerEntryRenderer("bytefly-separator")` draws each rule; `agent_settled` appends `pi.appendEntry("bytefly-separator", { turn })` in `tui` mode only. |
| Picker command | `pi.registerCommand("extensions")`; `tui` opens a dock screen via `ctx.ui.custom()` with the rails suppressed, other modes print through `ctx.ui.notify()`. |
| Picker discovery | `SettingsManager.create(...)` plus `DefaultPackageManager.resolve({ onMissing: "skip" })`, both public exports; both views drop `bytefly`'s own entrypoint. |
| Picker writes | `SettingsManager` setters (`setExtensionPaths`, `setPackages`, `setProjectExtensionPaths`, `setProjectPackages`) then `flush()`; `ctx.reload()` after the screen closes when changes are pending. |
| Doctor tool | `pi.registerTool("run_doctor")`, read-only (`readOnlyHint: true`), `exposure: "direct"`, active by default, with a typed `outputSchema` mirroring `structuredContent`. Its `readOnlyHint` is what the shared default-deny policy in `lib/policy.ts` reads to allow it in plan mode. |
| Doctor command | `pi.registerCommand("doctor")`; `tui` opens a dock screen via `ctx.ui.custom()` with the rails suppressed, other modes print through `ctx.ui.notify()`. |
| Doctor probes | `run_doctor` and `/doctor` share the session cache; `/doctor refresh` and `refresh: true` re-probe. Probes spawn `<binary> --version`, lazily import optional packages, and read config files through `lib/requirements.ts`; nothing is ever written. |
| Status routing | Reads `footerData.getExtensionStatuses()` (a custom footer replaces the built-in one entirely); `worktree` routes to line 1, plan/alert statuses to line 2's trailing slot. |
| Config | `bytefly.json` from the agent directory and `<cwd>/.pi`, read when the footer is installed — a new session, or `/bytefly` toggled back on. `doctor.json` is read at `session_start`. Nothing watches either file. |
| Data sources | `footerData.getGitBranch()`, `footerData.getAvailableProviderCount()`, `ctx.getContextUsage()`, `ctx.sessionManager.getEntries()`, `ctx.sessionManager.getSessionName()`, `ctx.model`; subscribes to `footerData.onBranchChange` to repaint. |
| State storage | None besides the inert separator entries. The footer reads session entries and the price config (a memoized scan) and writes no tool-result `details`; it appends `bytefly-separator` entries excluded from LLM context. The picker derives its screen from live runtime state and persists only through `settings.json`. Doctor's findings are session-scoped in memory only — cached for the session, never written to the session or a file. |
| Lifecycle | `session_start` installs the header and footer and points the doctor runtime at the session cwd, probing the extensions with hard requirements when `doctor.json`'s `proactive` is on; `session_tree` reinstalls the header and footer; `session_shutdown` restores Pi's built-in header and footer, disposes the branch subscription, and drops doctor's cached findings. |

## Design notes

- **The header keeps Pi's content and only recolors it.** Pi's built-in brand
  colors are fixed, so the mark ignores the active theme; bytefly's header
  reproduces the mark and version and draws them from `accent`/`warning`/`dim`,
  which is what makes the optional `bytefly-dark` and `bytefly-light` themes
  read as one system. It adds no session or model data — that is the footer's
  job.
- **Two lines, four zones.** Line 1 is identity (`pwd` left, branch + worktree
  right); line 2 is resources (meters left, model + level right). This keeps
  "where am I / what state" separate from "how much am I burning".
- **The gauge is anchored at column 0.** A leading mode slot would shift the
  context percentage left and right as plan mode came and went; trailing it
  after a `│` keeps the percentage in a fixed place while the mode stays
  visible as the meters drop.
- **Statuses are routed, not repeated.** The built-in footer renders every
  `setStatus` value on its own line; the bar splits them by meaning (`worktree`
  and `browse` are location, plan/alert is mode). The [wechat](../wechat/)
  extension publishes `✆ wechat` while its bridge runs, joining the mode/alert
  slot; this is why the bar must render `getExtensionStatuses()` at all.
- **Browse joins the git state.** The `◉ <port>` chip is routed beside `⎇` branch
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
- **The picker reuses Pi's resolution; only the toggle is ported.** Reading
  `SettingsManager` and `DefaultPackageManager` (public exports) makes the list
  match what Pi loads; the `+`/`-` pattern arithmetic is a trimmed port of Pi's
  config selector, kept pure and separately tested so a future drift is easy to
  diff.
- **Two picker views, one write scope.** Personal (`global`) and effective
  (`project`) resources are resolved separately, mirroring `pi config`; the
  screen shows the view for the active scope and writes through the matching
  store. A project package override is written with `autoload: false`, so it
  filters the personal entry instead of replacing it.
- **Doctor declarations live in `lib/`, probes in the extension, presentation in
  a third layer.** An extension cannot import another extension's modules, so
  the only legal home for a shared prerequisite table is `lib/requirements.ts`;
  the report itself is a pure function of the probe results.
- **The install hint has one home.** `document` and `web-access` format their
  tool errors from the same `REQUIREMENTS` entries `doctor` prints, so a user
  reads the same command whether a tool failed or the report named it.
- **The doctor is quiet by default at startup.** Only `missing` findings warn,
  only for enabled extensions, only with a UI, and only once per session;
  `degraded` findings — including a malformed config — wait in `/doctor`, because
  a session that nags about an optional package is worse than one that never
  mentions it.
- **Probe the real thing.** `subagent`'s requirement resolves through the same
  `getPiInvocation` the extension uses rather than re-guessing whether a `pi`
  binary exists.
- **The prerequisite table is data.** No I/O, no host access, no module state:
  every probe dependency arrives as a seam, so `probeExtension` is testable with
  no process and `lib/` stays value-only.

## Files

The five surfaces are folders: `header/`, `footer/` (the status bar and its
price calculation), `separator/`, `picker/`, and `doctor/`.

| File | Responsibility |
|---|---|
| `index.ts` | Composition root: the disable guard and the five `register*` calls. |
| `header/config.ts` | Header tuning (`HEADER_CONFIG`): mark, theme tokens, padding, gap. |
| `header/component.ts` | `ByteflyHeader`: the themed brand-mark and version component, plus its factory. |
| `header/register.ts` | Installs/restores the header and owns its session lifecycle. |
| `footer/register.ts` | Installs/restores the footer, registers `/bytefly`, and owns its session lifecycle. |
| `footer/config.ts` | Bar tuning (`CONFIG`): thresholds, gauge, separators, icons, status keys, labels. |
| `footer/types.ts` | `StatusSnapshot`, `Segment`, `LineSpec`, `UsageRecord`, and footer/TUI shapes. |
| `footer/collect/entries.ts` | Session entries → usage records, each resolved to the model in effect. |
| `footer/collect/snapshot.ts` | Snapshot assembly; memoized pricing scan per branch leaf. |
| `footer/price/types.ts` | `Currency`, `ModelRates`, `PeakWindow`/`PeakSchedule`, `ByteflyConfig`. |
| `footer/price/config.ts` | `bytefly.json` schema, defaults, built-in DeepSeek rates/tariff, normalizer, loader. |
| `footer/price/rates.ts` | Model-key matching: exact and wildcard, most specific first. |
| `footer/price/schedule.ts` | Peak-window parsing and evaluation in a configured zone. |
| `footer/price/price.ts` | Records → totals: rates, peak multiplier, recorded-cost fallback. |
| `footer/render/format.ts` | Generic formatters (tokens, cost in the configured currency, cwd, gauge, colors). |
| `footer/render/status.ts` | Status-chip transforms: `compactStatus` and `dropStatusDetail`. |
| `footer/render/segments.ts` | The segment builders: forms, weights, separators, colors. |
| `footer/render/lines.ts` | Snapshot → two `LineSpec`s; status routing. |
| `footer/render/layout.ts` | Width reduction and right-zone folding. |
| `footer/render/footer.ts` | `StatusBar` component and footer factory. |
| `separator/config.ts` | Turn-rule tuning: `customType`, glyph, label prefix, padding, and colors. |
| `separator/register.ts` | Registers the entry renderer and appends a separator on `agent_settled`. |
| `separator/component.ts` | `SeparatorComponent`: the stateless entry renderer. |
| `separator/format.ts` | Pure `separatorLabel` / `separatorParts` / `separatorLine`. |
| `separator/types.ts` | `TurnSeparatorData`, `SeparatorParts`. |
| `picker/types.ts` | Picker host seams (`SettingsStore`, `ExtensionResolver`, `Discovery`) and row types. |
| `picker/resources.ts` | Pure grouping, labels, display names, pattern helpers, text listing. |
| `picker/toggle.ts` | Pure next-settings transforms for global and project toggles. |
| `picker/discovery.ts` | Host wiring: builds the global and effective views from Pi's managers. |
| `picker/runtime.ts` | Picker scope, live view copies, dirty tracking, and persistence. |
| `picker/tui.ts` | `ExtensionsListComponent`, the dock screen. |
| `picker/commands.ts` | `/extensions`: TUI path and text fallback. |
| `doctor/register.ts` | Registers `run_doctor`, `/doctor`, and the proactive session-start check; returns the runtime. |
| `doctor/runtime.ts` | Host seams, the session cache, and the two probe modes. |
| `doctor/tools.ts` | The `run_doctor` tool and its renderers. |
| `doctor/commands.ts` | The `/doctor` command and its TUI wiring. |
| `doctor/schema.ts` | Tool parameters and the structured output schema. |
| `doctor/config.ts` | `DEFAULT_CONFIG`, `normalizeConfig`, `loadConfig` for `doctor.json`. |
| `doctor/format.ts` | Pure report text, rows, glyphs, and the proactive warning sentence. |
| `doctor/tui.ts` | `DoctorScreen`, the docked list screen with its detail pane. |

## Testing

`extensions/bytefly/` covers the install/restore/toggle lifecycle
(`extension`), the header's rendering, width shedding, and live theme
(`header/component`),
the formatters (`footer/render/format`), the status-chip transforms
(`footer/render/status`), entry
reduction and model inheritance (`footer/collect/entries`), snapshot assembly
and its memoization (`footer/collect/snapshot`), rate matching
(`footer/price/rates`), window parsing
and peak evaluation in two zones (`footer/price/schedule`), the pricing formula,
the off-peak multiplier, the built-in DeepSeek table with no config file, and the
fallback (`footer/price/price`), the config schema, its clamping, the built-in
defaults and their replacement, and the two file layers
(`footer/price/config`), zone/priority
assignment
(`footer/render/lines`), the reduction, separator collapse, and right-zone
folding across a width sweep from 6 to 120 plus wide characters
(`footer/render/layout`), exact
golden output at fixed widths (`footer/render/render`), and the install/skip/
restore/toggle lifecycle plus a config-driven price (`extension`). The turn
separator
is covered by its pure formatting (`separator/format`) and its
register/append/render/disable lifecycle (`separator/register`). The picker is
covered by the pure helpers (`picker/resources`), the toggle transforms
(`picker/toggle`), discovery with an injected factory (`picker/discovery`), the
runtime state machine (`picker/runtime`), the screen's rendering and key
handling (`picker/tui`), and the command through the bytefly factory
(`picker/commands`). The doctor surface is covered by its pure report
formatting (`doctor/format`), the screen's rendering and key handling
(`doctor/tui`), its config loader (`doctor/config`), and registration, the
proactive warning, the session cache, and `run_doctor` through the factory
(`doctor/register`).
