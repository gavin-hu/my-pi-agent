# bytefly — the TUI header, footer, user-message marker, turn rule, extension screen, and notifications

`bytefly` owns the terminal chrome, configuration, and diagnostics surfaces this
package adds: the startup header and footer, the user-message nameplate, the turn
rule, the shared notice and tool-block frames, the working line, the `/bytefly`
control center, OS notifications, and the package-update check. Every surface is
drawn from the package's `lib/tui/` design system, so a theme swap re-skins the
whole chrome. The footer prices a session from DeepSeek's published rates by
default, and from `bytefly.json` otherwise.

## Capabilities

### Chrome

| Capability | How | What you get |
|---|---|---|
| Startup header | `quietStartup` | One two-tone nameplate with the agent and chrome versions and the live help keys, in place of Pi's startup header and resource listing. |
| Two-line footer | every `tui` session | State on one line — location, modes, and alerts — and meters on the other — context, spend, tokens, cache, and model — each shedding parts rather than clipping. |
| Extension status chips | `footerData.getExtensionStatuses()` | Worktree, browse, plan, and alert statuses appear in the footer, using each extension's own colour. A failed job is the one chip no width drops. |
| Priced session total | the `price` section of `bytefly.json` | The session's spend in yuan or dollars, with DeepSeek priced out of the box. |
| Delegated-run cost roll-up | the `↳` footer segment | A finished subagent's cost appears beside the session total, without merging the two ledgers. |
| User-message nameplate | every `tui` session | Each user message opens with a two-row `You` label and rule. |
| Turn receipt | the `bytefly-separator` entry | One rule per completed turn, recording its number, duration, tool count, and outcome. |
| Shared notices | the `my-pi-agent/notice` type | Any extension's notice renders at the transcript margin with a severity-coloured rail. |
| Compaction canvas | the shipped `themes/` palettes | Pi's `/compact` block keeps its content and loses its fill, so it sits on the canvas. |
| Tool-block frame | `registerToolRenderer` | Every tool block leads with its own call line and hangs its result from the transcript rail. |
| Working line | `ctx.ui.setWorkingMessage` | The composer's top border carries it beside Pi's spinner: the elapsed count, then how many tools the run has started. |
| Plan-mode chord | `Shift+Tab` at the main editor | Flips `auto` and plan through `plan`'s request channel; the footer mode segment and the composer border follow. Shift+Tab is taken from Pi's thinking cycle only while `plan` is loaded, and restored on shutdown. |

### Control center

| Capability | How | What you get |
|---|---|---|
| One frame, three sections | `/bytefly`, `/bytefly skills`, `/bytefly settings` | Extensions, skills, and settings in one dock: the worst problem in the header, each section's count on the tabs, the write scope at the right, and one body height for all three, so changing section never resizes the screen. |
| Resource rows and the block | `Space`, `Enter`, `?` | A name-first row — `worktree`, not `worktree/index.ts` — with one checkbox, one status glyph and one verdict word, and the focused row's findings, path, source, state, and health beside the list at 96 columns and under it below. |
| Grouped settings | `/bytefly settings` | Fifteen preferences under `Startup`, `Notifications`, `Session`, `Board`, and `Price`, each value in one aligned column and editable in place; `J` shows the stored JSON section. |
| Theme selection | the `Theme` row in `/bytefly settings` | `system` and the package's `bytefly-dark` and `bytefly-light` palettes are one selection; a reload applies it. |
| Filters and scope | `/`, `!`, `s`, `x` | Narrow the rows by text or to what needs attention — the chips on the tab row say which — and choose where a toggle lands, the personal or project `settings.json`, with `x` clearing a project override. |
| Reload after changes | `R` | `unsaved changes` joins the header while a write is pending, and `R` reloads to apply it instead of leaving the session to be restarted by hand. |
| Health report | `run_doctor`, `/bytefly doctor` | Prerequisites, parse errors, and aged rate tables as text and typed data. |

### Upkeep

| Capability | How | What you get | Status |
|---|---|---|---|
| Currency and peak tariff | `price.currency.code`, `price.peak` | `CNY` and `USD` are separate pricing methods with published rates; DeepSeek's peak windows apply per token record. | Shipped |
| Session budget alert | `price.budget` | The session total shows as `spent/limit` in the footer, and one notice plus one OS notification fires when it reaches the threshold. | Partial |
| Unpriced-record notice | `price.currency.code` | A `CNY` session names the records it could not price, and the two ways to fix it. | Shipped |
| Desktop notifications | `notify.enabled`, `notify.turnFinished`, `notify.needsInput`, `notify.jobFinished`, `notify.matchFound` | An OS notification when a run settles, the agent needs you, a job finishes, or a watcher matches. | Shipped |
| Proactive health check | `doctor.proactive` | At session start, when the startup header is on, a hard requirement is probed once and reported before the first turn. | Shipped |
| Update check | `/bytefly update` | One notice per session lists every package behind, and the header marks a new version. | Shipped |
| Update action | `/bytefly upgrade` | Pi's own package manager installs the configured packages behind a confirmation, clearing the marker and naming the reload the new version needs. | Unreleased |
| Pi release notice | `automatic: Pi's release notice` | Pi's own newer version gets the same themed notice and header marker, without a second check. | Shipped |

## Quickstart

```bash
pi --extension ./extensions/bytefly    # load just this extension
pi -e .                                # load the whole @gavin-hu/my-pi-agent package
pi install ./                          # install the package for a user
```

```text
/bytefly                            # the control center, on Extensions
/bytefly doctor                     # the report run_doctor returns
```

## Tool

<img src="../../assets/tools/run_doctor.png" alt="The run_doctor tool's result: the call line and a one-line, indented doctor summary with a collapsed expand hint" width="100%">

`run_doctor` — `exposure: "direct"` (the default), `executionMode: "sequential"`,
read-only, closed-world. It reports whether each extension has what it needs at
runtime — binaries on `PATH`, optional packages and browsers, login and state
files, and config files that fail to parse — and it probes and changes nothing.
Its `readOnlyHint` is what the shared default-deny policy in `lib/policy.ts`
reads to allow it in plan mode.

| Parameter | Type | Meaning |
|---|---|---|
| `extension` | string, optional | Report a single extension instead of every extension. |
| `refresh` | boolean, optional | Ignore the findings cached earlier in this session and probe again. |

Result (`details` / `structuredContent`): `{ headline, missing, degraded, extensions }`,
one finding per check with its `check`, `severity`, `detail`, and optional `hint`.
The same report is what `/bytefly doctor` prints, and what
[the control center](#the-control-center) draws.

## Commands

One command runs the screen, prints the report, and re-checks updates:

| Command | What it does |
|---|---|
| `/bytefly [extension] [refresh]` | Open the control center on Extensions. In `tui` it mounts a docked list; every other mode prints the grouped listing, or one extension's full findings when named. |
| `/bytefly settings` | Open the control center on Settings. Outside `tui` it prints one `Label: Value` line per setting. |
| `/bytefly skills` | Open the control center on Skills. Outside `tui` it prints the grouped skills listing with one row per skill. |
| `/bytefly doctor [extension] [refresh]` | Print the doctor report. Outside `tui` it prints `run_doctor`'s text for every extension, or one named extension's findings; in `tui` it mounts the same docked screen. |
| `/bytefly prices` | Name the models this session could not price: the `price.rates` key for each, the records behind it, and where to add it. It prices the session when asked, so it answers in every mode — the footer that carries the same fact exists only in `tui`. No rate is suggested. |
| `/bytefly update` | Re-run the package update check now, ignoring the cache window, and report what it found — the updateable packages, this package's version and release URL when known, `PI_OFFLINE`, or an unreadable list. It resolves no packages and probes no extension. |
| `/bytefly upgrade` | Install what the check found, behind a confirmation: Pi's own package manager updates every configured package, the marker is re-read, and one line reports the result and the reload it needs. `PI_OFFLINE` and a pinned npm version skip the work. It resolves no packages and mounts no screen. |

Tab completes the subcommands, extension names after `doctor`, and `refresh`;
`/bytefly settings`, `/bytefly skills`, `/bytefly prices`, `/bytefly update`, and
`/bytefly upgrade` take no name.

## Behaviour by mode

The footer and turn rule are installed only in interactive (`tui`) sessions;
the header is too, but only when Pi's `quietStartup` is `true` (the **Bytefly
startup TUI** toggle). `false`, `"header"`, and unset leave Pi's built-in
header in place. Every mode loads the extension, and non-TUI modes change
nothing. The screen is available in every mode: in `tui`, `/bytefly` and
`/bytefly doctor` mount the docked screen, while RPC, JSON, and print modes
print the grouped listing with a per-row health suffix and the headline, or that
extension's full findings when one is named. In `tui` the screen opens on the
session's cached report and probes on the first Extensions view; the text modes
probe before they print. `/bytefly settings` prints the
flat settings listing with each row's value outside `tui`; it does not
resolve packages or probe the doctor. The
proactive session-start check posts a transcript notice through the shared
`my-pi-agent/notice` renderer rather than a transient notification, and is
skipped when there is no UI or when Pi's `quietStartup` setting is not `true`
(`false`, `"header"`, and unset leave Pi's startup surface in charge, so the
notice is silent). Notify runs in every
mode and picks its method from the environment; the OSC methods need a TTY, so a
print/JSON/RPC run gets an OS-level notification or none.

## Configuration

Two things are JSON: the transcript rail's glyph (`chrome.rail`, default `╎`,
read at `session_start`/`session_tree`) and this extension's three config
sections — `price`, `notify`, and `doctor`. Everything else about the look is
tuned in code: the header in [`header/config.ts`](../../extensions/bytefly/header/config.ts) (mark and
identity tokens, tagline, grouped help), the footer in
[`footer/config.ts`](../../extensions/bytefly/footer/config.ts) (thresholds, gauge glyphs and widths,
separators, icons, status keys), and the turn separator in
[`separator/config.ts`](../../extensions/bytefly/separator/config.ts) (glyph, label prefix, padding,
minimum duration, outcome wording, colors).

Every key of every section is listed with its type, default, and bounds in
[`docs/configuration.md`](../configuration.md); this section
covers what that table cannot — when each section is read, and what the cost
does when no rate matches.

`bytefly.json` is one shared document with a top-level section per extension (see
[Configuration](../configuration.md)). It is read from the global
document, then `<cwd>/.pi/bytefly.json`, project winning. The old per-extension
files (`document.json`, `jobs.json`, …) are no longer read; `bun run config:migrate`
moves them into the shared document.

Neither document is needed for DeepSeek. The built-in table for the selected
currency is the base layer for every session: `CNY` prices DeepSeek in yuan and
`USD` in dollars, both at the published peak and off-peak rates. A document can
change the currency, replace a built-in rate, or add rates of your own.

```json
{
  "price": {
    "currency": { "code": "CNY", "decimals": 2 },
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
}
```

That file restates the built-in defaults, so on its own it changes nothing; it is
shown to document every key at once.

Rates merge key by key across the two documents, so a project document can
override one model without restating the rest; a key present in both is replaced,
not merged field by field. No windows means every moment is peak, so a rate with
`offPeakMultiplier: 0.5` and no schedule stays flat.

**Only configured models get a price.** A record priced from `rates` or the
built-in table contributes to the total. A model with no matching rate differs by
currency: `CNY` contributes nothing, so the bar shows no cost rather than a
mixed-currency figure, while `USD` adds Pi's recorded dollar amount, which is
already in the right unit. To price the model yourself, add a rate entry (a `"*"`
catch-all prices everything).

### When each section is read

| Section | Read at | Applies to |
|---|---|---|
| `chrome` | `session_start`, `session_tree` | the rail glyph |
| `price` | the footer install (`session_start`, `session_tree`) | the cost total and the budget ceiling beside it |
| `notify` | `session_start` | which events are announced, and how |
| `doctor` | `session_start` | the proactive check |

Nothing watches a file, so an edit applies at the next read — a reload, a new
session, or a tree change. A malformed document is ignored by every loader and
named by `doctor`; a wrong-typed value falls back to its default, and a
wrong-typed timezone drops the peak schedule rather than the session.

The notify capability is **off by default**: `enabled: true` is the whole setup
needed for an unattended run, and the four trigger flags then narrow what is
announced (see [Notifications](#notifications)).

The proactive doctor check is part of the bytefly startup TUI, so it posts only
when Pi starts with `"quietStartup": true`, the same setting that hides Pi's own
header and loaded-resource listing. `false`, `"header"`, and unset leave Pi's
startup surface in charge, so the notice stays silent. When it does post, the
notice enters the message flow once per session, so it stays in scrollback and
the model reads the same sentence.

## Security

- Project settings are only read or written when the project is trusted
  (`ctx.isProjectTrusted()`); an untrusted session offers Global scope only.
- Discovery never installs or fetches a package: missing sources are skipped.
- The extension screen registers no model-facing tool; toggling writes only
  through Pi's `settings.json`, and `run_doctor` is read-only.

## Startup header

A nameplate: a two-tone half-block mark from the active theme's `accent` /
`warn` roles, the agent identity (`Pi`, bold, and its version), the chrome
identity (`enhanced by bytefly` and the package version), a signature rule whose
`accent` lead sits under the mark, and a grouped help block. The help keys
resolve live from Pi's keybindings, so a rebound key shows the user's chord; the
one raw hint, `shift+tab to toggle plan`, is bytefly's own editor chord rather
than a bindable Pi action. The identity and help text are `meta` / `faint` so the
mark keeps the eye. It opens
with a blank row, so the nameplate clears the top edge. It is installed only in
interactive (`tui`) sessions when Pi's `quietStartup` is `true` — the Settings
row **Startup screen** — and `false`, `"header"`, and unset leave Pi's
built-in header in place; on terminals that cannot render half blocks the mark
falls back to a two-tone `Pi` wordmark.

```
 █▀█  Pi v1.2.0
 █▀ █ enhanced by bytefly v0.8.1
 ─────────────────────────────────────────────────
   escape to interrupt · ctrl+c to clear · ctrl+d to exit (empty)
   ctrl+o to expand tools · ctrl+t to expand thinking · ctrl+l to select model
   / commands · ! bash · !! bash (no context) · /bytefly extensions
```

As the terminal narrows, the identity sheds the chrome marker, then the chrome
version, then the chrome line, then Pi's marker with the agent name, and the help
rows drop whole keys, so nothing wraps or clips mid-word. Height sheds the same way: at 28 rows
all three help groups print, below 28 the middle group (the expand and model
chords) goes first, below 22 only the `/` commands row survives, and below 16 the
help block and the leading blank row go, leaving the nameplate and its rule. An
unknown height keeps the full header. The nameplate sits on the transcript
margin, which follows Pi's `outputPad` (the value the tool frame and the notice
use too), and the help hangs one body indent inside it. The mark, tokens,
identity, and grouped help are tuned in
[`header/config.ts`](../../extensions/bytefly/header/config.ts).

## Content and colors

Two lines, each with a left and right zone:

- **Line 1 — identity:** `pwd` and the session name on the left; on the right the
  alert, then the remaining status chips (a job count, a rewind timeline, the
  `✆` bridge), then `⎇ branch · ⑂ worktree`, then the session's page port
  (`◉ 4780`) while anything is served on it. One server serves every page of a
  session, so it is one number from one status key.
- **Line 2 — resources:** the mode (`▶ auto` or `≡ plan`), the context gauge and
  usage meters on the left, the child-run roll-up (`↳ 3 · ¥0.12`, present only
  once a subagent has finished), and the model and thinking level on the right.
  The gauge follows the mode, so `%` stays put once the mode stops changing.
  The roll-up is its own number, never folded into the session's cost: a subagent
  runs in its own process, and the footer prices those runs with the same rate
  table and currency as the session so a currency change moves both. It covers
  the last 500 child runs of the current process, and starts from zero after
  `/resume` (the events are not session entries).

```
~/repo/my-pi-agent                                                                  ⎇ main · ⑂ smoke
≡ plan · ▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥0.31 · ↳ 2 · ¥0.06 · ↑42k ↓8.0k · R96k CH 87%      opus-4.5 · high
```

(The examples show the default `¥` symbol. A model that neither `rates` nor the
built-in table covers contributes nothing in `CNY` mode, so the bar shows no
figure rather than a guessed one; `USD` mode adds Pi's recorded dollars for that
record instead — see [Cost calculation](#cost-calculation).)

With no plan mode the mode segment reads its other state:

```
~/repo/my-pi-agent                                                                  ⎇ main · ⑂ smoke
▶ auto · ▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥0.31 · ↑42k ↓8.0k · R96k CH 87%                    opus-4.5 · high
```

While a page is served, the session's port joins the run beside the worktree:

```
~/repo/my-pi-agent                                                                 ⎇ main · ◉ 4780
▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥0.31 · ↑42k ↓8.0k · R96k CH 87%                               opus-4.5 · high
```

As the terminal narrows, segments shrink and drop by priority rather than
clipping. The branch keeps its name and is dropped when the name no longer
fits, rather than collapsing to a bare glyph:

```
~/repo/my-pi-agent       ⎇ main · ⑂
≡ plan · ▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥0.31   opus-4.5 · high
```

```
~/my-pi-agent     ⎇ main
▶ auto · ▰▰▰▰▰▰▱▱▱▱ 62%  opus-4.5
```

The port drops the digits before the page they name: it compacts to `◉` once
the number no longer fits, so the narrowest bar that fits the location chips still
says a page is up.

```
~/repo/my-pi-agent            ⎇ main · ◉
≡ plan · ▰▰▰▰▰▰▱▱▱▱ 62% · ¥0.31   opus-4.5 · high
```

With a named session, the name follows the path and truncates before it drops:

```
~/repo/project · [feature-refac…]         ⎇ main
▶ auto · ▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥0.31      opus-4.5 · high
```

Zero-value meters are omitted, so a fresh session shows only `?/window` instead
of a row of `¥0.00 · ↑0 ↓0 · R0 W0`. Unknown context usage shows a muted `?`
with no gauge (known `0%` still draws the empty gauge), so unknown and zero stay
distinct. Cost keeps the configured precision — the segment drops rather than
rounding to a misleading `¥0.3` — and a positive amount below one minor unit
shows as `¥<0.01` rather than `¥0.00`.

Each segment reads a theme role and carries its own drop order:

| Segment | Line / zone | Color | Drops |
|---|---|---|---|
| pwd | 1 left | dim | last |
| session | 1 left | muted, bracketed | after worktree |
| branch | 1 right | muted (warning when detached) | last |
| worktree | 1 right | success | first |
| port `◉ 4780` | 1 right | success glyph + accent port | first |
| mode `≡ plan` / `▶ auto` | 2 left | warning while planning, accent otherwise | never |
| context gauge + `%` | 2 left | muted ≤70 · warning 71–90 · error >90 | never |
| `/window` | 2 left | dim | before cost |
| cost | 2 left | muted | after tokens |
| tokens `↑in ↓out` | 2 left | dim | after cache |
| cache `R… CH …%` | 2 left | dim | first |
| statuses | 1 right | as emitted by each extension | before branch |
| model | 2 right | accent | never |
| thinking level | 2 right | thinking token | before cost |

The worktree status is read from the `worktree` status key, so the
[worktree](./worktree.md) extension and the bar agree. The port is the `http`
status key, published by [serve](./serve.md) while anything is mounted on the
session's server — one number, because one socket serves every page a session
opens. It is a two-tone `<glyph> <port>` with a green glyph and an accent port,
and it compacts from `◉ 4780` to `◉` before it drops, so a bar too narrow for
the number still says a page is up.

The mode segment leads the resource line: `≡ plan` in the warning role while
planning, `▶ auto` in accent otherwise. The bar draws that word itself and reads
only the presence of the `plan-mode` status key, so neither the plan file name nor
a chip truncated elsewhere can reach it. `auto` is not a
behaviour of its own: it names Pi's default mode, every tool as it ships and writes
included, so the segment states which mode the session is in and `≡ plan` is the one
override that withholds — a mode added later is a third value of this one chip, never a
second indicator saying what the session may do. `Shift+Tab` at
the main editor asks [plan](./plan.md) to flip it; the chip and the composer
border are read from the branch, so `/plan` and the model's own `exit_plan_mode`
move them too. Bytefly unsets Pi's `app.thinking.cycle` chord while it holds the
key, so `/hotkeys` and the header stop claiming Shift+Tab, and restores it on
shutdown. A session without `plan` still reads `▶ auto` and keeps the thinking
cycle.

The status slot beside the branch holds everything else an extension publishes: a
job count, a rewind timeline, the `✆` bridge, and an alert's front position. An
alert (a failed job) sorts to the front of it. It keeps each extension's own
colour when it compacts, and it is droppable: a tight bar drops the slot rather
than truncating the model, which sits at the end of the line.

## Cost calculation

Pi prices every model call from its bundled catalog in USD, and the provider API
never returns a price. The footer can total that catalog directly, or replace
it with its own rates for the models they match:

- **Which built-in rates.** [`footer/price/config.ts`](../../extensions/bytefly/footer/price/config.ts) ships DeepSeek's published
  yuan prices for `CNY` and its published dollar prices for `USD`, per model, with
  the peak schedule that doubles the price during peak hours
  ([DeepSeek's pricing page](https://api-docs.deepseek.com/quick_start/pricing)).
  They are ordinary rate entries, so a `bytefly.json` key replaces one of
  them, and the schedule is the default `peak` every rate is judged against.
- **Which rate.** The most specific key wins, with the model segment outranking
  the provider one: `provider/model`, then `*/model`, then `provider/*`, then
  `*`. A segment ending in a star is a prefix match (`*/gpt-*`); equally
  specific keys are resolved in file order. A key splits at its first slash, so
  the model segment may contain one: an OpenRouter id is
  `anthropic/claude-fable-5` and its key is
  `openrouter/anthropic/claude-fable-5`.
- **Which formula.** `tokens × rate ÷ 1,000,000`, summed over the four token
  classes. Cache tokens are never billed again as fresh input.
- **Which tariff.** Each record is dated by its session entry, so a window is
  applied at the local time the tokens were actually spent: an off-peak turn
  stays off-peak when peak starts. A record with no usable timestamp is priced
  at peak, because it cannot be dated.
- **Which algorithm.** `price.currency.code` chooses `CNY` (the default) or
  `USD`. Both price matched records from `rates` and the same `peak` tariff; the
  code selects which built-in table `rates` starts from — DeepSeek's yuan prices
  or its dollar prices — and the two are separate methods, not an exchange rate.
  Neither mode converts one currency into the other. `currency.decimals` only
  changes how the total is printed; the symbol follows the code.
- **Which source.** Both currencies price a matched record from `rates`; only
  the unmatched case differs. `CNY` contributes nothing for a model it cannot
  price and counts the record instead, so the session can name what its total
  leaves out; `USD` adds Pi's recorded dollar amount for that record, because
  that number is already dollars and already per model.

DeepSeek needs no config file at all: the bar prices it from the published yuan
rates and peak tariff built into [`footer/price/config.ts`](../../extensions/bytefly/footer/price/config.ts).
Those tables record the day they were last checked against the published tariff,
and `doctor` reports how old that is, so a re-pricing shows up as a warning instead
of a quietly wrong total. A `bytefly.json` can switch to the published dollar table,
add models of your own, or replace a built-in entry:

```
~/repo/project                                                          ⎇ main
▰▰▰▰▰▰▱▱▱▱ 62%/200k · ¥2.50 · ↑42k ↓8.0k · R96k CH 87%             opus-4.5 · high
```

`price.budget` puts a threshold under that total, in the same currency: when the
session's cost reaches it, one `bytefly · Session budget reached` notice names
what was spent against the budget, and one OS notification follows when notify
is enabled. It is an alert, not a limit — no turn is blocked or aborted — and it
fires once per session, on the turn where the crossing becomes final (the run
settling), because a warning per turn after that is noise. `0`, the default,
turns it off. The check reads the total the footer already priced, and the
footer exists only in `tui` sessions, so a print or JSON run has no budget
alert; the footer's own numbers are visible in every interactive session.

A record nothing prices contributes nothing to the total. `CNY` has no fallback at
all; `USD` falls back to Pi's recorded amount, which is `0` for a model its catalog
does not know either. So "unpriced" means the same thing in both modes — no
`price.rates` key matched **and** nothing else priced it — and it is counted by
*model*, because a count says the total is short while a key says what to do:

- The footer's cost segment marks it: `¥1.23 · 2 unpriced`, dropping to the count
  alone on a narrow bar. A session where nothing could be priced shows `2 unpriced`
  beside no price at all, where it used to show nothing.
- `/bytefly prices` lists them — the key, the records behind it, and the line saying
  where the keys go. It prices the session when asked, so it works in every mode,
  including the ones with no footer.
- One `bytefly · Records with no rate` notice fires per session, on the run that
  settles, naming up to three keys. The two fixes it offers are both honest: switch
  `price.currency.code` to `USD` (Pi's catalog is per model, tiers included) or add
  `price.rates` entries for those keys.

The key is the `price.rates` vocabulary, so it is copy-pasteable: `provider/model`,
`*` for a side the history does not name, and a model id containing a slash kept
whole (`openrouter/anthropic/claude-fable-5`). A genuinely free model — a local one
whose recorded cost is `0` — is listed too; adding its key costs nothing.

For example, DeepSeek flash at `¥2` in and `¥8` out per million, with the
published peak windows and `offPeakMultiplier: 0.5`, prices a 1M-in + 1M-out
turn at `¥10.00` at peak and `¥5.00` off-peak. That example is worked end to end
in [`footer/footer.test.ts`](../../extensions/bytefly/footer/footer.test.ts), which also prices the built-in
table with no config file at all.

## The user-message nameplate

Every user message opens with a two-row `You` nameplate — the label over a rule
that spans the width — above the message:

```
You
────────────────────────────────────

the message the user typed
```

It is always on in interactive sessions and has no config file. Pi renders a
user message as Markdown and owns its colors, so bytefly's only lever is a
`registerMarkdownTransformer`: the nameplate is a single level-2 heading whose
text is padded so the rule wraps onto the second row, and both rows carry the
accent because the themes point `mdHeading` at it. The block carries no fill —
the shipped themes set `userMessageBg` to the terminal default, so it reads like
the tool blocks. The nameplate is separated from the message by a blank line, so
the message's own Markdown (a fence, a list, a second paragraph) parses exactly
as it would without it, and a soft wrap of one long line stays at the margin
because the renderer wraps it, not bytefly. The label and the rule are tuned
in [`message/config.ts`](../../extensions/bytefly/message/config.ts).

## Turn separator

`agent_settled` fires once after an agent run fully settles — exactly one user
turn — which is why it is used instead of `turn_end` (that fires once per
assistant message, so tool-calling rounds would each get a line). On each
settled run the extension appends an inert custom entry and a renderer draws it
as a receipt: the turn number, then the run's duration, top-level tool count,
and outcome as the width allows.

```
╌╌╌╌╌╌╌╌╌╌╌╌ turn 3 · 1m12s · 7 tools ╌╌╌╌╌╌╌╌╌╌╌╌
```

- The turn number is `count(separators on the current branch) + 1`, so a
  resumed or forked session continues the parent's numbering and abandoned
  branches do not leak counts.
- The receipt opens on the run's first `agent_start` and closes on
  `agent_settled`, so a retry stays inside one duration. It counts only
  top-level tool calls; a nested call (one carrying `parentToolCallId`) is an
  implementation detail of its parent and does not inflate the number.
- The outcome is part of the receipt: a failed tool adds `✕N`, and an aborted
  run adds `aborted` instead of the failure count. A sub-second run prints no
  duration, so quick turns stay quiet. Entries written before the receipt
  existed have only a turn number and still render as `turn N`.
- The label sheds fields rather than overflowing: the tool count first, then
  the duration, then the outcome. When even the turn number does not fit, the
  line becomes a plain dashed rule instead of clipping.
- A clean turn paints the label `meta`, a turn with a failed tool paints it
  `bad`, and an aborted turn paints it `warn`.
- The entry is excluded from LLM context, so it costs no tokens, and it
  survives resume and fork. It is drawn under the `bytefly-separator` custom
  entry type.
- The rule is installed only in interactive (`tui`) sessions; RPC, JSON, and
  print sessions append nothing.
- Separators recorded by the retired `turn-separator` extension are not
  rendered, and `PI_DISABLED_EXTENSIONS=turn-separator` no longer affects the
  rule; disable the whole extension with `bytefly` instead.
- There is no runtime command; the glyph, label prefix, padding, colors, and
  minimum duration are tuned in
  [`separator/config.ts`](../../extensions/bytefly/separator/config.ts).

## Notices

Any extension in the package can post a transcript notice under the shared
`my-pi-agent/notice` type; bytefly draws it at the transcript's margin — a
`source · title` headline at the margin, then rail-led rows, each with its own
severity glyph:

```
job · 2 background jobs finished
╎ ✓ j1 build · exit 0
╎ ✕ j2 test · exit 1
```

The rail is painted by the notice's worst severity, so a failure reads red at the
edge like an errored tool result, and the headline's title takes the notice's own
severity — a warning reads yellow where its sentence is, while an `info` or `ok`
notice stays body text. A row's label stays body text too: its severity is the
glyph it hangs on, so one failing row never tints the rest of the list.

`job` and `watch` post one when a background job finishes or a watched line
matches, so the report the model reads is visible too. `doctor` posts one when a
hard requirement is missing at session start, with a row per finding and the
command that fixes it:

```
doctor · 1 missing prerequisite
╎ ✕ worktree (git) · install git and make sure it is on PATH
```

Only a missing *hard* requirement posts a notice at session start; everything
else waits in the report.

The type and the `NoticeDetails` shape are the shared contract in
[`lib/notice.ts`](../../lib/notice.ts), and the severity glyphs and item cap
are tuned in [`notice/config.ts`](../../extensions/bytefly/notice/config.ts). Every field is sanitized
and clipped at the boundary, and a message without `details` keeps Pi's default
custom-message box.

## Compaction

`/compact` is Pi's own surface: its summary block is a built-in message
component, so bytefly cannot replace, hide, or shorten it. The shipped themes
only remove its fill — `customMessageBg` is the terminal default — and paint the
`[compaction]` label in the accent, so the block sits on the canvas like the
rest of the transcript. Pi's branch summaries and skill invocations share the
same tokens.

<img src="../../assets/screens/compaction.png" alt="The /compact summary block: a [compaction] label, the compacted token count, and the summary Markdown on the terminal canvas, with no background band" width="100%">

## Tool blocks

Every tool block leads with the tool's own call line as the headline — the tool
name in the theme's tool-title colour — and its result body sits two columns in
directly beneath it, led by the transcript rail, instead of Pi's filled status
background:

```
read src/app.ts
╎ const answer = 42;
```

The two tools that mutate a file, `edit` and `write`, carry their result on the
call body — the edit diff, the written file content — so that body is railed
like any other result. There is no status band: the diff's own red/green line
colours, with the changed words in reverse video, and the `edit` / `write`
headline are what mark a file change.

A `registerToolRenderer` resolver switches the row to `renderShell: "self"`,
leaves the call's own first line as the headline, and indents the rest of the
call and the whole result under it. A shell call's `$` / `>` prompt becomes the
tool name and the command is repainted in the body colour, and a primary subject
(a path, URL, query, pattern) is demoted to the body colour too, so the name is
the call line's only accent (`bash bun run check`, `read src/app.ts`). The
tool's own
`renderCall`/`renderResult` are passed through, so syntax highlighting, diffs,
previews, and truncation notices are unchanged — only the frame is bytefly's.
The body carries the transcript rail, painted by status (a running result takes
the accent, a failure red, a finished one neutral) and drawn with the glyph from
the `chrome.rail` setting. A result frame is always railed; a call frame is railed
only for `edit` and `write`, whose call body carries the result — every other
call's headline and continuation lines stay plain-indented. Package renderers
clip a call to one physical line (middle clip for a path or URL), so it cannot
leak into the body column; Pi's own renderers still wrap, and the frame keeps a
wrapped continuation unrailed and loses the accent there too, with the rail
beginning at the result underneath. A rejected call renders as one sanitized
`error` line in the error role; a running tool shows a live elapsed label, and a
finished long call appends its duration. A tool with
no renderer of its own is framed around a generic call/result fallback, whose
call line reads like a built-in — the leading string argument bare, the rest as
trailing options (`open_path src/app.ts`) — rather than dumping raw `key=value`
pairs. A tool that draws its own shell (`edit`) is framed too:
`renderShell: "self"` only tells Pi not to draw its box around the renderer, so
its diff would otherwise sit at the wrong indent; the frame drops the blank
edges its own `Box` pads itself with, and hands it a theme whose `bg` is inert so
it never paints a band the rest of the transcript does not have.

The call line is one colour grammar, shared with Pi's built-ins: the tool name is
in the `toolTitle` role, bold, and is the line's only accent; a primary subject (a
query, a URL, a path, a status) reads in the body role (`label`), counts and
summaries are `meta`, trailing options are `faint`, and the result body is
`toolOutput`. The shipped themes point `toolTitle` at the accent and `label` at
the body colour, so the name is the call line's one accent and the subject follows
as body text; a theme that maps `toolTitle` elsewhere is respected rather than
overridden.

## The working line

Pi's working indicator shows a static `Working`, so a long run reads the same as
a short one. It is drawn on the composer's top border while a run is up, and
bytefly advances its message once a second and hands it back to Pi when the run
settles. Before the first tool starts it is a count:

```
── ◐ working · 12s ───────────────────
```

Once a top-level tool starts, the border adds how many top-level tools this run
has started:

```
── ◐ working · 3 tools · 12s ─────────
```

The spinner and the colour are Pi's: the indicator owns the `◐` frame and takes
the composer border's role, so it is `accent` in auto and `warning` while
planning. The line deliberately does not name the tool — the transcript already
draws each call as its own block, and one word reads faster than a name that
changes under you.

A nested tool call (one carrying `parentToolCallId`, such as a codemode script's
inner call) does not count, so the number matches the tool blocks in the
transcript. A tool event repaints the border immediately instead of waiting for
the next tick. The line covers the whole run, tool calls
included. It is tied to the indicator's visibility: it starts on `turn_start`, stops
on `agent_end`, and is reset on `session_shutdown`; turns inside one run do not
restart it, and a retry starts a new run. The words and the interval are tuned
in [`working/config.ts`](../../extensions/bytefly/working/config.ts).

## The control center

<img src="../../assets/screens/bytefly.png" alt="The /bytefly control center at 120 columns: a `Bytefly` rule with `1 missing` at its right edge, the `Extensions 9 · Skills 0 · Settings 15` tabs with `writes Global` at the right, one name-first row per extension with its checkbox and verdict, and the focused extension's block beside the list — its findings and their fix, Path, Source, State, and Health" width="100%">

`/bytefly [extension] [refresh]` opens the control center on **Extensions**: a
keyboard-driven dock of every resource Pi resolves for the session, so the list
matches what actually loads. `/bytefly skills` and `/bytefly settings` open the
other two sections directly, and `←`/`→` (or `h`/`l`, or `Tab`) change section,
wrapping at the ends because the tabs read as a ring. `/bytefly <extension>`
narrows the list to one extension, and `refresh` forces the first probe. One
frame draws all three sections.

The screen opens on the findings the session already has, and the Extensions
section probes once on its first view (the hint shows `refreshing…` while it
runs). `/bytefly settings` therefore never waits for a probe, and a failed probe
is a notice with the screen still open rather than a refused command. A refusal
or a failed write appears in the screen's own hint row — the key hints step
aside — and clears on the next key, so nothing is written behind the screen.

The screen reuses Pi's own settings and package resolution (`SettingsManager`
plus `DefaultPackageManager` with `onMissing: "skip"`), so opening it never
installs or fetches a package.

**One frame.** The `Bytefly ────` header rule carries the screen's attention at
its right edge — `1 missing` or `2 degraded` in the severity's own colour, else
`2 off`, else `all clear`, with `unsaved changes` after it while a write is
pending. The tab row below names every section with the rows it holds,
`Extensions 9 · Skills 0 · Settings 12`, the active tab in the accent and the
counts faint, then any filter chips (`/git`, `needs attention`, `changed only`),
with `writes Global` (or `writes Project`) at the right edge. The scope is a word
there because no count line has to carry it any more: the counts are on the tabs,
the problems are in the header, and the scope is at the right.

The body is padded to the tallest section's row count, group headings counted, so
all three sections draw the same height and the dock does not resize when the
tabs change. A shorter section pads its last rows with blanks; a longer one
scrolls inside the same height and puts `showing 3–14 of 19` on its last body
row. The height is measured from both resource lists and the visible scope's
settings rows, so changing tab does not resize the dock: only a resize of the
terminal moves the hint row, or the Project scope's one-line note on a terminal
too short to hold both.

**Two panes.** At 96 columns and wider the focused row's block sits in a side
column after a `╎` divider: the row's name and verdict; the doctor's findings,
under a `── findings ──` rule and each with its fix; `Path`, `Source`, and
`State` for a resolved resource; `Health` when the row has a report; and
`Saved · reload to apply` once something is pending. Below 96 columns the same
block is drawn under the list in three rows, clipped, ending with
`… N more lines` when it has more to say; it leaves out what the row above
already says — the name and verdict on a resource row, the label and value on a
settings row, and the path when there are findings to show instead.

The picture above is 120 columns wide; the two frames below are the same screen
at 100 and 80.

```
Bytefly ────────────────────────────────────────────────────────────────────────────────── 1 missing
  Extensions 9 · Skills 0 · Settings 12                                                writes Global

  npm:pkg (user) (9)                                    ╎   worktree 1 missing
  ◼   file-read                                         ╎   ── findings ────────────────────────────
  ◼   job                                               ╎   git: not found on PATH — worktree
  ◼   memory                                            ╎   isolation
  ◼   plan                                              ╎     → install git and make sure it is on
  ◼   subagent                                          ╎     PATH (https://git-scm.com/downloads).
  ◼   todo                                              ╎   symlink: the host cannot create symlinks
  ◻ ∅ web-access  off                                   ╎     → copy the included files by hand.
  ◻ ∅ wechat     off                                    ╎   Path       /pkg/extensions/worktree/ind…
❯ ◼ ✕ worktree   1 missing                              ╎   Source     npm:pkg (user)
  Not resolved (1)                                      ╎   State      enabled
      bytefly    ok                                     ╎   Health     1 missing
                                                        ╎
                                                        ╎
                                                        ╎
                                                        ╎

  Esc close · ←/→ section · Space toggle · Enter detail · / filter · ? keys · r refresh · s scope
────────────────────────────────────────────────────────────────────────────────────────────────────
```

```
Bytefly ────────────────────────────────────────────────────────────── 1 missing
  Extensions 9 · Skills 0 · Settings 12                            writes Global

  npm:pkg (user) (9)
  ◼   file-read
  ◼   job
  ◼   memory
  ◼   plan
  ◼   subagent
  ◼   todo
  ◻ ∅ web-access  off
  ◻ ∅ wechat     off
❯ ◼ ✕ worktree   1 missing
  Not resolved (1)
      bytefly    ok

  git: not found on PATH — worktree isolation
    → install git and make sure it is on PATH (https://git-scm.com/downloads).
… 2 more lines

  Esc close · ←/→ section · Space toggle · Enter detail · / filter · ? keys
────────────────────────────────────────────────────────────────────────────────
```

At 80 columns the block's three rows clip to the first finding and its fix and
say how many lines are left out, and the hint row has already shed `r refresh`
and `s scope` from its right edge.

**Rows.** A row is named for the resource, not for its file: `worktree`, not
`worktree/index.ts`. The picker's `folder/file.ts` label survives only where two
resources share a directory name, because the two rows would otherwise read
alike. What is left is one checkbox, one status glyph and one verdict word —
`off`, `1 missing`, `2 degraded`, `env disabled`, `not loaded` for a skill Pi
refused, `hidden` for one its frontmatter keeps from the model — and a clean row
carries no glyph and no word at all, so the column reads as one shape and the eye
finds the rows that need it.

- Lists every resolved extension, grouped by source (each package, user
  settings, project settings), sorted packages-first and then by display name.
- Omits `bytefly`'s own entrypoint from the picker groups, so the tool that
  manages the list is never a selectable row; its doctor report still appears in
  the trailing `Not resolved` group.
- Shows whether each one is enabled (`◼`) or disabled (`◻`) in settings.
- Gives each row one verdict from the doctor's report: the worst severity's
  glyph (`!` degraded, `✕` missing) and its summary. A row that is `◻` reads
  `off` instead, because it will not load; a row the session's environment
  excludes — disabled through `PI_DISABLED_EXTENSIONS`, or an opt-in extension
  that `PI_ENABLED_EXTENSIONS` does not name — reads `env disabled`, so the two
  axes cannot contradict each other. The finding beside it names the switch that
  would change the answer. A row with nothing to report leaves the glyph column
  blank and says `ok` in words when a report exists.
- Toggles the focused extension with `Space`, writing `+pattern` / `-pattern`
  into `extensions` (and package filter objects) in the write scope. A row in
  the trailing `Not resolved` group has no pattern to write, so `Space` says so
  instead of doing nothing.
- Clears the focused extension's project override with `x` in Project scope: the
  `+`/`-` entry the toggle wrote is removed (with the plain path entry beside it
  for an inherited personal resource, and a project package entry the toggle
  created), and the row returns to its inherited state. A row with no override
  says so instead of writing, and Global scope does not offer the key — the
  personal file is the base layer.
- Expands or collapses the focused extension's findings with `Enter` — per row,
  so another row stays as it was — and gives the block the screen's whole body
  height while it is open, so its findings are not clipped to three rows.
- Re-probes with `r`; while a probe is in flight the hint shows `refreshing…` and
  a second `r` is ignored, so probes cannot stack.
- Checks an `<extension>` name against the discovered set before probing, so a
  typo fails immediately instead of waiting for every prerequisite check.
- Reloads with `R`, so a new selection takes effect without leaving the session.

**Filters.** `/` opens an editor seeded with the current query. The query applies
as it is typed — a filter that only took effect on `Enter` would make the reader
wait to see it work — and matches a row's name, path, and source (Settings: its
label, description, and value). `Esc` clears it rather than leaving a hidden
narrowing behind. `!` keeps only the rows worth acting on: a resource row that
needs attention, or on Settings a value that differs from its default. The chips
on the tab row say which is on, and an emptied section says
`Nothing matches the filter.`

**Skills.** The second section is the same list over Pi's skills: one row per
skill, grouped by source and sorted by name, labelled with the name its
`SKILL.md` declares (or the folder name when it declares none). `Space` writes
`+pattern` / `-pattern` into `skills` — or a package's `skills` filter — in the
write scope, and `x` behaves as it does for extensions. A row's verdict comes
from the skill's own file: `off` when it is disabled, `hidden` when frontmatter
sets `disable-model-invocation` so only `/skill:<name>` loads it, and
`not loaded` with Pi's reason when the file was refused. The block carries
`Path`, `Call` (`/skill:<name>`), `Model` when the skill is hidden from the
model, `Problem` when Pi refused the file, and the declared description — one
line until `Enter` expands it. There is nothing to probe, so `r` is not offered
here; the metadata is read once when the section first appears, so an edited
`SKILL.md` shows on the next open.

Themes and prompts have no section of their own, by decision rather than by
omission: a theme is one active selection — a scalar, global setting — and a
prompt template is a file Pi discovers from a directory, so neither is a scoped
enable list this screen's checkbox rows can write. Themes stay with `pi config`;
[`architecture.md`](../architecture.md#documented-limits-with-no-planned-card) carries
the reason.

**Settings.** The third section is the same frame over the curated preferences,
grouped by what they do rather than by which file holds them: `Startup (2)`,
`Notifications (5)`, `Session (3)`, `Board (3)`, and `Price (2)`. It is the
shortlist a session changes: fifteen preferences, each with its value in one
aligned column instead of beside its label, so a column of values can be read
down. Twenty entries — fifteen rows and their five headings — want a 28-row
terminal to be seen whole when the block sits beside the list; on a shorter or
narrower one the list scrolls, says `showing 1–13 of 15`, and the block keeps its
three rows. The frame never grows past the tallest section, however
tall the terminal is. In Project scope the two app rows drop out and the note
`App settings are Global only.` stands above the list.

The block carries `Now` with the value, `About` with the preference's own
description, and `Stored in <origin> · <file>` — `Global`, `Project`,
`Inherited from Global`, or `Default`, with the file that supplied the value
(`~/.pi/agent/settings.json` for an app row, the active scope's `bytefly.json`
otherwise). `J` on a `bytefly.json` row appends that section as the active scope
stores it, under a `── notify ──` rule.

<img src="../../assets/screens/bytefly-settings.png" alt="The /bytefly Settings section at 120 columns: the `Startup (2)`, `Notifications (5)`, `Session (3)`, `Board (3)` and `showing 1–11 of 15` rows with each value in one aligned column, the `Extensions 9 · Skills 0 · Settings 15` tabs with `writes Global` at the right, and the focused row's block beside the list — its value, description, and the file the value is stored in" width="100%">

| Group | Row | Source | Values |
|---|---|---|---|
| Startup | Startup screen | Pi `settings.json` (`quietStartup`) | Off, On |
| Startup | Theme | Pi `settings.json` (`theme`) | `system`, `bytefly-dark`, `bytefly-light` |
| Notifications | Desktop notifications | `notify.enabled` | Off, On |
| Notifications | When a turn ends | `notify.turnFinished` | Off, On |
| Notifications | When the agent needs you | `notify.needsInput` | Off, On |
| Notifications | When a job ends | `notify.jobFinished` | Off, On |
| Notifications | When a watcher matches | `notify.matchFound` | Off, On |
| Session | Resume after a job | `job.wakeOnFinish` | Off, On |
| Session | Snapshot before a turn | `rewind.autoSnapshots` | Off, On |
| Session | Health check at startup | `doctor.proactive` | Off, On |
| Price | Currency | `price.currency.code` | `CNY (¥)`, `USD ($)` |
| Price | Session budget | `price.budget` | `Off`, or the amount as `¥5.00` |

Choosing **Currency** also writes that currency's default precision
(`price.currency.decimals`). Both stay editable in `bytefly.json` afterwards, so
the footer follows the explicit values.

The **Theme** row lists `system` first, then the palettes this package ships,
`bytefly-dark` and `bytefly-light`; it cycles no further, so a bytefly screen
never proposes a palette it cannot vouch for. It writes the personal `theme`
setting and takes effect after reload. A value chosen elsewhere — Pi's built-in
`dark`, another package's theme, or an automatic pair such as
`bytefly-light/bytefly-dark` — is shown as stored (the pair with `… (automatic)`)
and is replaced by the next choice here, so manage those in Pi's `/settings` →
**Theme**.

`Space` (or `Enter`) changes the focused row: a boolean toggles, an enum cycles
forward, and the one text row — **Session budget** — opens an inline editor on its
amount. `u` deletes the focused row's key so its default applies again (`<row>
is already at its default.` when nothing is stored in that scope; an inherited
Project value says so instead, and an app row answers that Pi has no unset), and
`J` appends the focused row's whole section as the active scope stores it — the
only view of the keys this screen leaves to JSON. A successful change marks the
block `Saved · reload to apply` and puts `unsaved changes` in the header, and
closing offers the same reload confirm as an extension or skill toggle.

The list is capped at fifteen rows so the screen keeps fitting a 28-row
terminal: adding a setting means removing one (`panel/settings.test.ts` holds the
ceiling, and a 24-row terminal scrolls the list rather than the frame). Everything
else stays in `bytefly.json` — the tuning numbers, the
cosmetic labels, and the Pi preferences Pi's own `/settings` owns — and
`test/settings-coverage.test.ts` keeps the split honest: every loader key is
either a row or a declared JSON-only edit with the reason it left. Most
`bytefly.json` sections therefore have no row at all — `chrome`, `goal`, `watch`,
`worktree`, and `memory` among them — just as `notify.title`, `doctor.timeoutMs`,
`price.currency.decimals`, `rewind.max`, `rewind.safetySnapshot`,
`job.detachedByDefault`, and `watch.wakeOnMatch` inside sections that do. Each is
documented in [`docs/configuration.md`](../configuration.md).

Two of the five sections belong to other extensions (`rewind` and `job`). The
screen cannot import their normalizers, so it reports the leaf as
the file states it and declares the loader's default; the same test holds the
catalogue to every loader's defaults and bounds in both directions.

**Startup screen** is the one row whose label differs from the Pi key it writes:
On writes `"quietStartup": true` (bytefly's header replaces Pi's startup detail),
and Off writes `false` (Pi's built-in header stays). A hand-set `"header"` reads
Off, because it keeps Pi's header; the next toggle replaces it with `true` or
`false`.

App rows are **Global only**: Pi's setters for them write the personal
`settings.json`, and only resource paths have public project setters. Project
scope therefore lists the thirteen `bytefly.json` rows and a
`App settings are Global only.` note rather than promising a write that cannot
happen. A `bytefly.json` row writes one leaf in the selected scope (a depth-1
key, or a nested one such as `price.currency.code`) through a per-key writer, so
every sibling key, section, `$schema`, and `version` is preserved. A malformed
document is refused with a notice instead of overwritten, and `u` removes that
one leaf through the same writer's `unsetConfigValueAt`.

The non-`tui` form prints the headline and one `Label: Value` row per line, in
screen order:

```
bytefly: Settings · Global · 15 settings
  Startup screen: Off
  Theme: bytefly-dark
  Desktop notifications: On
  When a turn ends: On
  When the agent needs you: On
  When a job ends: On
  When a watcher matches: On
  Resume after a job: On
  Snapshot before a turn: On
  Health check at startup: On
  Currency: CNY (¥)
  Session budget: ¥5.00
```

The doctor side probes every declared extension and reports each check as `ok`,
`missing`, `degraded`, or `info`; `run_doctor` returns the same report as text
plus a typed `structuredContent` report. Only `missing` and `degraded` are
problems: `missing` means an enabled extension cannot do its job, `degraded`
means reduced capability — an optional package that is absent, a config file
that fails to parse, a login that has not happened. Doctor never changes
anything and never installs anything.

It also reports what has **aged**: the built-in DeepSeek rate tables carry the day
they were last checked against the published tariff (`PRICE_VERIFIED_AT` in
`footer/price/config.ts`), and the report says how old that is — `ok` inside the
90-day window, `degraded` beyond it with the source URL to re-check. A tariff change
therefore becomes a visible warning instead of a quietly wrong cost total.

`web-access` publishes what it resolved at `session_start`, so the report names
the search provider and why it won (an explicit choice, the `auto` rule, or the
keyless default), and — when the provider takes a key and no literal `apiKey` is
set — its API-key variable and whether that variable is set. The key value is
never part of the report, only its variable name. Reachability is the one check
that touches the network, so it runs only on an explicit `/bytefly refresh`:
a session-start check stays offline.

`/bytefly <extension>` narrows the same screen to that extension; `Enter`
expands its findings, including the checks that passed, into the free height.
`/bytefly refresh` ignores the findings cached earlier in the session. Every
other mode prints the grouped listing with a health suffix on each row and the
headline; a named extension prints its full findings instead.

### Keys

One table in [`panel/tui/keys.ts`](../../extensions/bytefly/panel/tui/keys.ts)
drives the bindings, the hint row, and the `?` key list, so a key cannot drift
from its hint or its help line. The hint row is per section and drops whole hints
from the right as the width runs out, so `Esc` and the section keys survive on a
narrow terminal; the Settings section's row is the shorter one.

| Key | Effect |
|---|---|
| `Esc` (`Ctrl+C`) | Close the screen. |
| `←` / `→`, `h` / `l`, `Tab` / `Shift+Tab` | Previous or next section — Extensions, Skills, Settings — wrapping at the ends. |
| `↑` / `↓`, `j` / `k` | Move to the previous or next row. |
| `PgUp` / `PgDn` | Move a page. |
| `Home` / `End`, `g` / `G` | Jump to the first or last row. |
| `[` / `]` | Jump to the previous or next group; a group heading is never the focus. |
| `Space` | Toggle the focused extension or skill; change the focused value (Settings). |
| `Enter` | Expand or collapse the focused row's findings, or a skill's description; change the focused value, or open the editor on a text row (Settings). |
| `/` | Filter the rows by text; the query applies as it is typed and `Esc` clears it. |
| `!` | Show only the rows that need attention; on Settings, only values changed from their default. |
| `s` | Switch where a change is written: Global or Project. |
| `x` | Drop the focused resource's Project override, so Global applies again (Extensions and Skills, Project scope only). |
| `r` | Re-probe every extension's requirements (Extensions only); a second `r` while one is in flight is ignored. |
| `R` | Reload now, to apply what you changed; with nothing pending it says so instead. |
| `u` | Delete the focused setting's key so its default applies again (Settings, `bytefly.json` rows). |
| `J` | Show or hide the focused row's whole `bytefly.json` section as stored (Settings). |
| `?` | Show the key list in the focused row's block; `?` again hides it. |
| `←` / `→`, `Home` / `End` (`Ctrl+A` / `Ctrl+E`) | Move the editor's caret while a text row or the filter is being edited. |
| `Backspace` / `Delete`, `Ctrl+U` | Edit the buffer: delete a character, or clear it. |
| `Enter` / `Esc` (editing) | Save the buffer, or cancel and restore the stored value. |

`Esc` clears an open filter or editor before it closes the screen, so nothing
typed is left narrowing the list or half-written. Mouse wheel scrolling and
clicking a row to focus it work; every action also has a keyboard path.

### What is checked

| Extension | Hard requirement | Optional / degraded |
|---|---|---|
| worktree | `git` | `.worktreeinclude` symlinks need symlink support |
| rewind | `git` | — |
| document | — | — |
| subagent | a runnable nested `pi` | project-local agents need a trusted project |
| plan | — | an interactive UI |
| memory | — | `git` for the project-scope root |
| file-browse | — | `git` for the branch chip; the browser opener is best-effort |
| web-access | — | `unpdf` |
| wechat | — | `wechat/credentials.json` (not logged in) |
| job | — | Windows has no `EXIT` trap; `ps` is POSIX-only |
| todo, goal | — | their config files |
| bytefly | — | TUI only for the header, footer, and turn rule; the screen's project scope needs a trusted project; an explicit `notify.method` this host cannot deliver; `bytefly.json` |
| question | — | needs an interactive UI |

Every extension that reads a config file also gets the malformed-JSON check:
the file and the parse error are named instead of being silently ignored. The
install guidance a tool error shows and the hint this report prints come from
the same entry in `lib/requirements.ts`, so the two cannot drift.

## Notifications

The notify capability is off by default and exists for unattended runs: start a
long turn, leave the terminal, and get a desktop notification when Pi needs you
— or when it is done. It fires on four events, each independently switchable in
the `notify` section of `bytefly.json` (see [Configuration](#configuration)):

- **A run settled** (`agent_settled`). Pi finished the turn and waits for the
  next message. An aborted run is skipped: interrupting with Escape means the
  user is already at the keyboard.
- **The agent needs input.** Pi opened a prompt while a run was active — an
  `ask_user_question`, a plan review, a subagent approval. A prompt opened while
  idle is a command the user just typed, so it does not fire; the run boundary
  is what separates "the agent is asking" from "the user is asking".
- **A background job finished.** The [job](./job.md) extension announces each
  terminal transition on the shared `pi.events` bus
  (`my-pi-agent/job-finished`); bytefly listens and never imports it.
- **A watcher matched.** A [watch](./watch.md) whose `wake` is on matched, and
  announced it on `my-pi-agent/watch-match` with the cycle's
  count, the watcher, and its newest line. The body names that line, sanitized and
  clipped to 80 characters, because the line is the alert: a watch usually tails a
  build or an error log. A match the agent was busy for notifies once that run
  settles, when its wake is raised.

### Delivery method

`method: "auto"` (the default) chooses from the environment, terminal first so
it works over SSH:

| Detected | Method |
|---|---|
| `WT_SESSION` (Windows Terminal / WSL) | `toast` — a PowerShell Windows toast |
| `KITTY_WINDOW_ID` | `osc99` |
| `TERM_PROGRAM` is `WezTerm` / `iTerm.app`, or `GHOSTTY_RESOURCES_DIR` is set | `osc777` |
| a plain `win32` host | `toast` |
| a TTY on any other host | `osc777` |
| headless macOS | `osascript` |
| headless Linux | `notify-send` |

Set `method` to any of `osc777`, `osc99`, `toast`, `osascript`, or `notify-send`
to force one. OSC 777 reaches Ghostty, iTerm2, WezTerm, and rxvt-unicode;
OSC 99 reaches Kitty. Off a TTY the OSC methods are a no-op — writing an escape
sequence into captured output would corrupt it — so a headless run needs an
OS-level method.

### Text

A notification body names the session (the session name, else the working
directory's folder) so concurrent runs can be told apart, and a finished job
adds its id, status, exit code, and label. Every piece that can carry model- or
user-authored text — a prompt title, a job label — is sanitized to one
control-free line before it reaches an escape sequence or a shell argument.

## Update check

Pi's package manager already knows which configured packages are behind, so
bytefly does not keep a second detector. Once per interactive session, in the
background, it asks the captured `checkForAvailableUpdates` for the package list,
suppresses Pi's own `Package Updates Available` block, and draws one notice for
every row Pi returned.

```
 █▀█  Pi v1.3.0 ↑1.4.0
 █▀ █ enhanced by bytefly v0.11.4 ↑0.12.0
```

```
 bytefly · 2 package updates available
 ╎ ◌ @gavin-hu/my-pi-agent · v0.11.4 → v0.12.0
 ╎ ◌ some-other-package · project
 ╎ ◌ update · pi update --extensions
 ╎ ◌ release · https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.12.0
```

The marker is the shared `↑` glyph and this package's newest version — the arrow
is one cell wide, so the header's column math is unchanged — painted with the
header's `accent` role: an action rather than a warning, so the muted version
beside it stays quiet and the transcript is not turned yellow for a normal state.
Pi's own newer version marks the agent line the same way, after `Pi v1.3.0`.
Other packages never change the header. The marker is part of the identity cell,
so the two cells still line up, and it is the first thing the identity sheds when
the terminal narrows.

The notice is the shared transcript block: the `bytefly · title` headline at the
margin, one rail row per package with this package's version arrow or the other
package's scope, then the fixing command and this package's release URL, all at
`info` severity because nothing is broken. It stays in scrollback and the model
reads the same names, version, command, and URL in plain text.

Pi's own release takes the same route. Pi resolves its newer version from
`pi.dev` and would draw a bordered `Update Available` block from
`InteractiveMode.showNewVersionNotification`; bytefly replaces that method, so
the release Pi already fetched becomes one shared notice and the agent line's
marker:

```
 bytefly · pi v1.4.0 is available
 ╎ ◌ pi · v1.3.0 → v1.4.0
 ╎ ◌ update · pi update
 ╎ ◌ changelog · https://pi.dev/changelog
```

That notice is bytefly's rendering, not a second check: Pi makes the request and
resolves the release, and bytefly reads the same answer, including the release's
optional `note` as a `release notes` row sanitized to one line. `PI_OFFLINE` and
`PI_SKIP_VERSION_CHECK` keep their Pi meaning, and a host whose method is missing
or renamed keeps its own block. The patch is process-wide like the package one,
installed at `session_start` and restored at `session_shutdown`.

The list is Pi's decision: npm ranges, git refs, project scope, a missing
install, and `PI_OFFLINE` all follow its package manager. The only extra read is
`GET https://registry.npmjs.org/@gavin-hu%2Fmy-pi-agent/latest` when Pi reports
this package, used just to name the version arrow and release URL. A failed
version read drops those two pieces but keeps the package list and command.

The answer is cached in `<agent-dir>/bytefly/update.json` as the package list,
this package's optional version, the time it was read, and a key over the cwd and
the effective package sources. A session that starts inside the 24-hour window
reuses that snapshot — painting the marker and posting the notice from it —
without repeating Pi's npm/git checks, so a working day of sessions costs one
read. A project switch or a package install/removal changes the key and forces a
fresh read. Past the window the check runs again and rewrites the entry; a failed
read writes nothing, so the next session tries again. Offline, the cached marker
is used with no request and no notice, because a stale version is still the best
answer available and the list itself is advisory.

`/bytefly update` is the on-demand half: it ignores the window, asks Pi's package
manager now, records and paints the result, and prints one line — the package
list with this package's version and release URL when known, `up to date — no
configured package has an update`, `the update check was skipped (PI_OFFLINE is
set)`, or `could not check package updates`. It resolves no packages, probes no
extension, and posts no second notice, so a session open for days can see a
release without a restart. Opening the control center never checks: the screen has
no update surface, and the only request paths are `session_start` and this
command.

`/bytefly upgrade` is the half that writes. It asks for a confirmation and then
calls the package manager's own `update()`: the same manager that reads the
packages configured in `settings.json`, owns the install root, and honours a
project's `npmCommand`, so no shell and no `pi update` command is involved. Pi
skips a pinned npm version, and `PI_OFFLINE` skips the whole path. The manager
returns nothing, so the answer is a re-read of what is left: `every configured
package is updated — reload to use the new version`, or a warning when a package
is still behind after a successful run; a failed install prints the manager's own
message. The running session keeps the old code loaded until it reloads, which is
why the line says so, and each source the manager reports is shown while it runs.

## Limitations

- **The Startup screen row is the startup surface only.** It installs or removes
  bytefly's startup header and the proactive doctor notice; the footer, turn
  rule, and transcript renderers stay on. Use `PI_DISABLED_EXTENSIONS=bytefly`
  (or `pi config`) to turn off all of bytefly.
- **App settings are Global only.** Pi's setters for the two app preferences
  the screen carries — `quietStartup` (the **Startup screen** row) and
  `theme` — write the personal `settings.json`; the screen hides those rows in
  Project scope rather than writing a file Pi cannot manage.
- **The Theme row offers only this package's palettes.** `system`,
  `bytefly-dark`, and `bytefly-light` are the whole cycle; Pi's built-ins and any
  user, project, or other package's theme stay in Pi's `/settings` → **Theme**,
  and a value set there shows as stored here. An automatic pair such as
  `bytefly-light/bytefly-dark` shows as stored but is replaced by the next single
  choice, and the change applies after a reload like the other app rows.
- **Project overrides of app settings are not shown.** App rows read the
  personal file; a `.pi/settings.json` override still wins at runtime, and
  `pi config` is the place to manage it.
- **The list is a shortlist, not the whole document.** A row is one boolean,
  enum, string, or number; the tuning numbers, the labels, and the Pi
  preferences `/settings` owns stay in their files, and the catalogue is capped
  at fifteen rows so the screen fits a 28-row terminal. `doctor.skip` (an
  array), the `rates` table, and `price.peak` (a nested object) could never be a
  row; the rest are declared JSON-only with their reason in
  `test/settings-coverage.test.ts`.
- **The rail glyph is typed in `bytefly.json`.** It must be exactly one column,
  because a two-column glyph would push every railed body one cell right; the
  loader drops anything else, and the former four-glyph menu is the
  configuration reference's example list.
- **`doctor`, `settings`, `skills`, `update`, and `upgrade` are reserved first
  arguments.** `/bytefly doctor` always selects the report, so an extension
  literally named `doctor` cannot be narrowed to by name; `settings`, `skills`,
  `update`, and `upgrade` are reserved the same way.
- **The picker manages the `extensions` and `skills` resource types.** Prompts
  and themes stay with Pi's own `pi config`.
- **Built-in extensions are not listed** (`builtin:mcp`, `builtin:codemode`, …):
  their authoritative names are not exposed to extensions. Use `pi config`.
- **Nothing is installed or removed here.** `/bytefly upgrade` runs Pi's own
  update for the packages configured in `settings.json`; adding a package is
  still `pi install`, removing one is `pi remove`, and Pi itself is still
  `pi update`.
- **The update list is Pi's.** Only packages configured in `settings.json` are
  checked; `pi -e .`, a temporary checkout, and other unmanaged loads get no
  update prompt. The version arrow and release URL still come from npm's
  `latest`, so a private registry or a version published under another tag can
  lose those two pieces while the list stays correct.
- **The cache window is fixed at 24 hours.** It runs at `session_start` in `tui`
  mode and reuses a snapshot younger than that whose key matches the cwd and
  package sources; there is no setting for it, and `/bytefly` and `doctor` do not
  report the version. A failed or slow background request is retried by the next
  session, or immediately by `/bytefly update`.
- **The markers need the bytefly startup TUI.** They live on the custom header,
  so with `quietStartup` off the notice is the whole signal.
- **Pi's blocks are suppressed by host shims.** bytefly wraps
  `DefaultPackageManager.prototype.checkForAvailableUpdates` and
  `InteractiveMode.prototype.showNewVersionNotification` at `session_start` and
  restores both on shutdown. A future Pi that changes either method shape makes
  that shim inert, and Pi's own block can come back.
- **No auto-update, and the release URL is text only.** The notice names a
  command instead of running one; the only path that writes is `/bytefly
  upgrade`, and it waits for a confirmation. The notice renderer cannot open a
  link, so
  the release row prints the URL and nothing more — no changelog body, no way to
  click through from the transcript. Pi's optional release note arrives as one
  sanitized `release notes` row, so a multi-paragraph note is flattened and
  clipped at the width.
- **Project toggles are two-state per press** (`enable`/`disable`). `x` clears
  the override, which is the third state; a resource with no project entry in
  `pi config` is still managed there.
- **One built-in provider.** DeepSeek is the only provider with a built-in
  table; another provider's currency and tariff have to be stated in
  `bytefly.json`.
- **Holidays.** A tariff that excludes public holidays — DeepSeek's peak window
  does — cannot be expressed. A weekend can, by leaving `days` 6 and 7 out.
- **One schedule.** A single `peak` section applies to every rate. Only a rate
  with an `offPeakMultiplier` below 1 is affected by it, so two providers with
  different time-of-day tariffs cannot both be described.
- **No tiers, no special cache writes.** Per-request input tiers and
  Anthropic's 2× one-hour cache write are not modelled; switch to `USD` mode
  to use Pi's recorded cost for those models.
- **No FX conversion.** The two modes are separate methods; neither converts
  one currency into the other. A model is priced only by the selected method, and
  a model neither method can price is named — by key, in the footer, in
  `/bytefly prices`, and in one notice — instead of being quietly left out. What
  is *not* built is a table for another provider: rates are sourced data, and
  `price.rates` is where they go.
- **Two built-in footer indicators cannot be reproduced.** Pi's `(auto)` marks
  that auto-compaction is on, and its `(sub)` marks a subscription-backed
  provider. Auto-compaction is session state on Pi's own session object, and
  `ReadonlyFooterDataProvider` exposes only the branch, the extension statuses,
  and the provider count; `isUsingSubscription` lives on the internal model
  runtime, not on the `ModelRegistry` an extension receives. A subscription
  session therefore shows no cost segment at all, where Pi's footer said `(sub)`.
- **The displayed number is the total, rounded once** — not the sum of rounded
  records.
- **`doctor` can only check what is declared.** A new extension with no
  `REQUIREMENTS` entry is invisible to it — `test/prerequisites.test.ts` fails on
  exactly that, which is why the table cannot rot quietly.
- **The disabled check reads the environment** through `lib/env.ts`: the disable
  list, and the opt-in list that a default-off extension needs. It does not read
  Pi's own `settings.json` disable list, so an extension disabled only there may
  still be probed. The row labels that state `env disabled`, separately from the
  picker's `off` — the picker's `Space` writes settings patterns and cannot set
  an environment variable, so an opt-in extension is switched on in the shell,
  not on that screen.
- **A probe proves a binary runs, not that it works:** a `git` that crashes on a
  specific repository is still `ok`.
- **Config scope is checked for `<agent-dir>/bytefly.json` and
  `<cwd>/.pi/bytefly.json` only**; a `job.registryDir` override is not
  followed.
- **Notifications are not focus-aware.** They fire whether or not the terminal
  has focus, and once per trigger rather than once per unseen event. There is
  no focus API to consult.
- **`/compact` is Pi's block.** The summary component is built in, so bytefly
  cannot render, hide, or shorten it; the themes only choose its fill and label
  color. Branch summaries and skill invocations share the same theme tokens.
- **A background job cannot ask for input.** The `needsInput` trigger is a
  prompt raised during a run, not a process waiting on stdin: jobs are
  fire-and-observe, so that state does not exist.
- **An explicit `method` is honored blindly.** Point `method` at a notifier the
  host lacks (or an OSC method off a TTY) and the notification is dropped; only
  `auto` inspects the environment. `doctor` now reports the mismatch as a
  `degraded` finding, which says what to change but does not fix it for you.
- **The working line is one global message.** `setWorkingMessage` drives the
  single working indicator, so bytefly and any other extension setting it race — last
  writer wins — and the message is reset to Pi's default at `agent_end`. It is drawn
  on the composer's top border because the mode editor opts into Pi's embedded
  indicator; an editor that does not (or a host without `embedWorkingStatus`) puts the
  same line in a row above the composer instead. If the indicator is hidden
  (`ctx.ui.setWorkingVisible(false)`) the line has no surface, and a reload mid-run
  does not resume the count until the next turn.

## Non-goals

- No per-segment CLI: the bar's look lives in `footer/config.ts`, the price in
  `bytefly.json`.
- No per-model cost breakdown and no on-screen marker for which tariff or
  which source produced a number.
- No todo-count segment; the [todo](./todo.md) widget already shows progress.
- No shelling out for git ahead/behind; the footer data provider exposes only
  the branch.
- No session or model data in the header: it shows the nameplate and the grouped
  help block only. The footer owns the session, model, and working-directory
  data.
- No auto-fix: `doctor` reports the install command; it never runs it.
- No aggregation of runtime failures: a tool that errored earlier in the session
  is not a prerequisite problem, and `doctor` does not pretend to know about it.
- No status chip for the doctor report: it is on demand plus one notice, not a
  permanent footer segment.
- No notification for individual tool calls, message turns, or subagent steps:
  the four triggers — a settled run, a prompt mid-run, a finished job, a watcher
  match — are the whole surface.
- No sound, action buttons, notification history, or de-duplication; a
  notification is a fire-and-forget message, not an inbox.
- No frozen per-run working duration: the line is live and is handed back to
  Pi when the working indicator comes down, because the extension API exposes no hook
  to keep a finished run's total.

The built-in footer's `(auto)` auto-compact indicator and `(sub)`
subscription-cost marker are not reachable from `ExtensionContext` (there is no
`autoCompactEnabled` or provider subscription check), so the bar omits them
rather than showing a wrong value.

## Pi integration

| Integration point | Details |
|---|---|
| Header | `ctx.ui.setHeader` with a custom component, replacing Pi's built-in header; installed only when `ctx.mode === "tui"` and `pi.getSettings().quietStartup === true` (the **Startup screen** row). `false`, `"header"`, and unset call `setHeader(undefined)`, leaving Pi's built-in header in place. The nameplate insets by Pi's `outputPad` (read through `pi.getSettings()`), so it sits on the transcript margin, and the help hangs one body indent inside it. The mark and text are drawn from the active theme's tokens, the help keys resolve live through `keyText`, and the mark falls back to a wordmark on Apple Terminal (`isAppleTerminalSession`), mirroring Pi's built-in. The factory reads `tui.terminal.rows` on every render, so the height ladder in `header/config.ts` sheds help groups and then the leading blank row as the terminal shortens (unknown height keeps the full header). The chrome version gains `↑<latest>` from the `UpdateSource`, the agent line gains Pi's own `↑<latest>` from the second store, and `registerHeader` returns a `refresh()` handle that re-installs the last context's header when either value arrives. |
| Footer | `ctx.ui.setFooter` with a custom component, replacing Pi's built-in footer; installed only when `ctx.mode === "tui"`. |
| User message | `pi.registerMarkdownTransformer` puts a two-row `You` nameplate (the label over a full-width rule) above each user message; one padded level-2 heading carries the accent through `mdHeading` for both rows, and the shipped themes set `userMessageBg` to the terminal default, so the block has no fill. Pi renders the result as Markdown, so the surface adds no component or color of its own. |
| Notice | `registerMessageRenderer(NOTICE_TYPE)` draws every shared transcript notice at the margin from its `details`; the headline stays at the margin with its title painted by the notice's own severity, and its rows hang from the transcript rail, painted by the notice's worst severity, whose glyph comes from the shared `RailSource`. `job` and `watch` post one when their work settles, and `doctor` posts one at `session_start` for a missing hard requirement. The type and shape come from `lib/notice.ts`. A message without `details` falls back to Pi's default custom-message box. |
| Tool blocks | `registerToolRenderer` returns, for every tool, `renderShell: "self"`; `renderCall` leaves the tool's own first line as the block's headline (a shell prompt shown as the tool name, its command repainted in the body colour, and a primary subject demoted to the body colour) and indents the rest of the call two columns under it, `renderResult` indents its body the same and leads it with the status-coloured rail, and each wraps the tool's own renderer (or a generic fallback). `edit` and `write` carry their result on the call body, so that body is railed too. |
| Screen command | `pi.registerCommand("bytefly")` takes `[doctor] [settings] [extension] [refresh]`: `tui` mounts a dock screen via `ctx.ui.custom()` with the rails suppressed; other modes print through `ctx.ui.notify()` — the grouped listing, `run_doctor`'s report for `doctor`, or the flat settings listing with values for `settings`. A named extension is checked against the discovered set before any probe. Tab completes the subcommands, extension names after `doctor`, and `refresh`; `/bytefly settings` rejects a name. |
| Turn separator | `registerEntryRenderer("bytefly-separator")` draws each stored receipt; `agent_start` opens it, top-level `tool_execution_start`/`tool_execution_end` count tools and failures, and `agent_settled` appends `pi.appendEntry("bytefly-separator", { turn, durationMs, tools, failures, aborted })` in `tui` mode only. The receipt fields are omitted when no `agent_start` was seen, so an older or partially observed entry stays `{ turn }`. |
| Working line | `turn_start` starts a 1s tick that drives `ctx.ui.setWorkingMessage` in `tui` mode; before a tool runs the message is `working · Ns`, and each top-level `tool_execution_start` repaints it as `working · N tools · Ns` (nested calls carrying `parentToolCallId` are skipped). It renders on the composer's top border, which the mode editor enables with `embedWorkingStatus`. `agent_end` restores Pi's default and cancels the tick (also on `session_shutdown`). No config file and no persisted state; the count lives in the register's closure. |
| Notifications | `agent_settled` (skipped when aborted), `ui_prompt_start` only while `agent_start`…`agent_settled` marks a run active, and `my-pi-agent/job-finished` on `pi.events`; the `notify` section of `bytefly.json` gates each. Delivery writes an OSC 777/99 sequence to stdout or spawns `osascript`, `notify-send`, or `powershell.exe`. The bus subscription is created in `session_start` and released in `session_shutdown`, and the `job` extension never imports bytefly. |
| Picker discovery | `SettingsManager.create(...)` plus `DefaultPackageManager.resolve({ onMissing: "skip" })`, both public exports; both views drop `bytefly`'s own entrypoint. |
| Picker writes | `SettingsManager` setters (`setExtensionPaths`, `setPackages`, `setProjectExtensionPaths`, `setProjectPackages`) then `flush()`; `ctx.reload()` after the screen closes when changes are pending. |
| Settings writes | App rows call `SettingsManager` setters (`setQuietStartup`, `setTheme`) on the global store and `flush()`, then surface `drainErrors()`; `bytefly.json` rows call `writeConfigValuesAt` on the selected scope's document with the row's leaf path, so a nested key (`price.currency.decimals`) and a flat one (`notify.method`) share one writer, and a row that also writes a companion leaf (the currency and its default precision) applies both in one document pass; and `u` calls `unsetConfigValueAt` with the same path. A failed or refused write shows a notice in the screen's hint row and leaves the displayed value unchanged; a successful one marks the screen dirty. |
| Doctor tool | `pi.registerTool("run_doctor")`, read-only (`readOnlyHint: true`, `openWorldHint: false`), direct exposure and active on registration (the defaults, so not declared), with a typed `outputSchema` mirroring `structuredContent`. Its `readOnlyHint` is what the shared default-deny policy in `lib/policy.ts` reads to allow it in plan mode. |
| Doctor probes | `run_doctor` and the screen share the session cache created by `registerDoctor`; the screen mounts on that cache and probes on the first Extensions view (the command's `refresh` forces it), while the text modes probe before printing, and `/bytefly refresh` and `refresh: true` re-probe. Probes spawn `<binary> --version`, lazily import optional packages, and read config files through `lib/requirements.ts`; nothing is ever written. |
| Status routing | Reads `footerData.getExtensionStatuses()` (a custom footer replaces the built-in one entirely); `worktree` routes to line 1, plan/alert statuses to line 2's trailing slot. |
| Release notice | `session_start` in `tui` mode patches `InteractiveMode.prototype.showNewVersionNotification` through the shared `patchPrototypeMethod`, so the release Pi resolved becomes `pi.sendMessage(piReleaseNotice(...))` under the shared notice type and `paintLatest` records its version for the agent line's marker (`onUpdate` re-installs the header). The callback posts once per load and only while the session is live; a throw calls the captured original, so Pi's own box is the fallback. `session_shutdown` restores the method and clears the marker. |
| Update check | `session_start` in `tui` mode installs a suppression on `DefaultPackageManager.prototype.checkForAvailableUpdates`, then reads `<agent-dir>/bytefly/update.json`. A fresh entry whose key matches the cwd and effective package sources is recorded without a package-manager call; otherwise bytefly fires `fetchAvailableUpdates()` without awaiting, resolves this package's version through `fetchLatestVersion()` when Pi reports it, writes the snapshot, and records it. `onUpdate` re-installs the header, and `pi.sendMessage(updateNotice(...))` posts the one notice with its version arrow and release URL. `PI_OFFLINE` paints the cached marker only. `/bytefly update` calls the returned `UpdateHandle.recheck()`, which bypasses the window and returns an `UpdateOutcome`; `/bytefly upgrade` calls `UpdateHandle.apply()`, which runs `applyUpdates()` — Pi's `DefaultPackageManager.update()`, with its progress passed to `ctx.ui.notify` — and then re-reads the snapshot so the marker cannot outlive the version it named. A generation counter drops a background reply that lands after `session_shutdown`, a per-load flag keeps it to one announcement, and shutdown restores Pi's method. |
| Config | `bytefly.json` from the agent directory and `<cwd>/.pi`; the `price` section is read once per footer install (a new session or a session-tree change), the `notify` and `doctor` sections at `session_start`, and the `chrome` section's rail glyph at `session_start`/`session_tree`. Nothing watches the document. The update check has no section: it is on whenever `PI_OFFLINE` is off, and its 24 h window is not configurable. |
| Data sources | `footerData.getGitBranch()`, `footerData.getAvailableProviderCount()`, `ctx.getContextUsage()`, `ctx.sessionManager.getEntries()`, `ctx.sessionManager.getSessionName()`, `ctx.model`; subscribes to `footerData.onBranchChange` to repaint. |
| State storage | None besides the inert separator entries. The footer reads session entries and the price config (a memoized scan) and writes no tool-result `details`; it appends `bytefly-separator` entries excluded from LLM context. The screen derives its view from the picker runtime, the current reports, and the skill index, and persists extension and skill toggles through `settings.json`. The Settings section derives from a snapshot of the personal `settings.json` and both `bytefly.json` documents, and persists through the same `SettingsManager` setters or the per-leaf `bytefly.json` writer. Doctor's findings are session-scoped in memory only — cached for the session, never written to the session or a file. Notify holds only the config and the run-active flag in its closure. The update check holds this package's version in the per-load `UpdateSource` and one project-scoped snapshot in `<agent-dir>/bytefly/update.json`. |
| Lifecycle | `session_start` installs the header when Pi's `quietStartup` is `true` and the footer, loads the chrome rail glyph, points the doctor runtime at the session cwd, probes the extensions with hard requirements when `bytefly.json`'s `doctor.proactive` is on and `quietStartup` is `true`, loads the notify config and subscribes to the job bus, and starts the package-update check; `session_tree` reinstalls the header and footer and reloads the rail; `session_shutdown` restores Pi's built-in header, footer, package-update method, and release-notice method, disposes the branch subscription, drops doctor's cached findings, drops the notify bus subscription, and clears the recorded versions. |

## Design notes

- **One kit, one look.** Every bytefly surface is drawn from the package's
  `lib/tui/` design system: a role is resolved by the active theme, a rule comes
  from `rules.ts`, a list row from `rows.ts`, a meter from `gauge.ts`, and a
  width from `columns.ts`. Nothing in bytefly names a literal color, and a
  theme swap re-skins the whole chrome.
- **The user message is shaped, not painted.** Pi renders a user message as
  Markdown and owns its colors, so bytefly's only lever is a Markdown
  transformer: the two-row nameplate is one level-2 heading whose text is padded
  to the width so the rule wraps below the label, and both rows take the accent
  from the theme's `mdHeading`, because no extension API can color it directly.
  Markdown has no multi-line heading and Pi inserts a blank line after a
  heading block, so a single wrapped heading is the only way to keep the two
  rows adjacent and in the accent. The block has no fill: the shipped themes set
  `userMessageBg` to the terminal default, so it matches the tool blocks. The
  nameplate is separated from the message by a blank line, so the message's own
  Markdown parses unchanged and a soft wrap stays at the margin; hard-wrapping
  Markdown here would corrupt a break inside an inline construct.
- **A notice is one shared contract, not a foreign type.** Pi resolves a
  custom-message renderer by exact type with no wildcard, so `lib/notice.ts`
  owns the type and the `NoticeDetails` shape: a producer states model text and
  renderer details once, and bytefly owns only the look. One type for every
  producer also lets `job` and `watch` share one prune
  (`pruneStaleNotices`) keyed on `details.source`, so neither drops the other's
  note from context.
- **Every block is framed once, then reused.** Pi renders the whole component
  tree on every frame — a keystroke, a streamed token, the footer's own repaint —
  and bytefly's frame is a pure transform of the lines its inner renderer just
  produced. Re-running that transform per frame meant a `truncateToWidth` per
  body line per frame (about 8 µs a line, so a few hundred tool blocks cost tens
  of milliseconds a frame), and because it returned fresh strings it also
  defeated Pi's own identity caches. `ToolBlock` and `NoticeComponent` now render
  through `lib/tui/render-cache.ts`: the placed lines are memoized on the width
  and the body array the inner returned, so a repeat frame is one comparison and
  the unchanged strings let Pi's `Box` and diff fast paths do their work. The
  memo is dropped in `invalidate()`, which Pi calls on a theme change and on an
  expand toggle, so no themed string outlives its theme. `indentBlockLines` only
  measures a line it cannot prove fits, and the header memoizes on the width,
  theme, shape, and the help chords it prints, so a live rebind still repaints.
  `SeparatorComponent` uses the same memo for its full-width rule, so a long
  session does not repaint every turn's rule each frame. The footer's context
  estimate and session name join its pricing scan in the leaf-keyed memo: all
  three are O(session) work the host recomputes from scratch, and
  `createRateLookup` compiles the rate table once per config instead of once per
  record.
- **The frame delegates; it does not re-render.** Pi resolves tool renderers
  through the extension chain, and the resolved object is the definition the row
  reads, so a resolver can override `renderShell` and wrap `next()`'s
  `renderCall`/`renderResult`. bytefly replaces only the frame — Pi's filled
  status box for an indent — and keeps every built-in's diff, syntax
  highlighting, and truncation. The call and result are sibling components with
  no spacer between them, so the call's headline and the result read as one
  block; the result body hangs from the rail, and `edit`/`write` rail their call
  body because it carries the result, except for the lines of a call line that
  wrapped onto the body — a 121-column path under a bare `edit` is still the
  call, not diff content, and the rail starts at the diff. A tool that renders
  its own shell (`edit`)
  is framed too: its blank edge lines are trimmed so the body starts under the
  call, and it is handed a theme whose `bg` is inert so it paints no band. Each base renderer is handed its own
  previous component (tracked in the row's `state`), never the frame: Pi gives a
  renderer the component it returned last time, and a built-in calls `setText` on
  it, so handing back the frame would break it. A base renderer that throws is
  caught here too, and the frame falls back to its own call/result line at the
  frame's pad; letting the throw reach Pi would swap in Pi's generic call line,
  which sits a column to the left of the framed one.
- **One frame, one left edge.** Every transcript block that is not prose shares
  the same frame (`lib/tui/indent.ts`): a tool block, a notice, and a subagent's
  quoted output take one indent, so they hang from one left edge instead of four,
  and a tool result's body sits `BODY_INDENT` columns in under its headline. A
  body and a notice row lead that body with the transcript rail, whose
  glyph is the one configurable part (`chrome.rail`, default `╎`); a result frame
  is always railed, and a call frame only for `edit`/`write`, whose call body
  carries the result. Pi pads its own messages and hands the value to tool renderers
  (`context.outputPad`) and message renderers (`options.outputPad`), but gives an
  entry renderer none and adds its component raw, so bytefly's blocks inset
  themselves by that pad: the tool frame and the notice take it from Pi, and the
  turn separator reads the last value a sibling observed (`pad.ts`). Pi's setting
  is the only knob — bytefly adds no padding of its own. The footer draws no
  rule of its own: it joins its chips with the shared ` · `, and the rail (`╎`)
  stays a transcript-only glyph.
- **The header is a nameplate, not a dashboard.** Pi's built-in brand colors are
  fixed, so the mark ignores the active theme; bytefly's header draws a two-tone
  mark from the `accent`/`warn` roles, a signature rule whose accent lead sits
  under the mark, and pairs them with the agent identity, the chrome identity,
  and a grouped help block. It takes its margin from Pi's `outputPad`, like the
  tool frame and the notice, and hangs the help one body indent inside it, so the
  header follows a non-default pad instead of assuming a column. It adds no
  session or model data — that is the footer's job — and its shape follows the
  terminal: the height ladder drops whole help groups, then the leading blank
  row, before the nameplate gives up anything, so a short pane spends its rows
  on the transcript instead of chrome.
- **Two lines, one job each: state and meters.** Line 1 is state (`pwd` and the
  session name left; the alert, the modes, then `⎇` branch, `⑂` worktree and the
  ports right); line 2 is meters (the gauge and usage left; model and level
  right). The state chips change while a session runs, so they ride the line that
  has slack: the meters are the dense row, and a fact that moves to the top row is
  one the bottom row stops dropping to fit. It keeps "where am I / what state"
  separate from "how much am I burning".
- **Child spend is a second figure.** The footer never adds a subagent's tokens to
  the session's; it prices the `my-pi-agent/subagent-finished` events with the
  same pricer and renders them as `↳`, so "this session" keeps meaning the
  dispatching process and the delegated work stays visible beside it.
- **The mode leads the resource line, and the gauge follows it.** A tight bar used
  to push the context percentage around as plan mode came and went; putting the
  mode first gives the gauge a fixed offset after a segment of fixed width, so the
  percentage no longer moves as statuses are published. The mode is never
  dropped: a reader knows which mode the next request lands in before reading how
  much room is left.
- **Statuses are routed, not repeated.** The built-in footer renders every
  `setStatus` value on its own line, so the bar sorts them by meaning instead:
  `worktree` is location, so the `◉ <port>` chip sits behind `⎇`
  branch and `⑂` worktree, and it is the session's one page port, so it keeps a
  weight and a floor of its own; a plan is a mode, so its chip leads the resource
  line and bytefly fills in `▶ auto` when it is absent; a failed job is an alert,
  so it is its own segment ahead of the state chips. The
  [wechat](./wechat.md) extension publishes `✆ wechat` while its bridge runs,
  which is why the bar has to render `getExtensionStatuses()` at all.
- **A state chip leads its zone, so the zone does not move under it.** The right
  zone is right-aligned: a chip appended to it would push the branch and the
  worktree label left every time a mode came and went, while a chip prepended to
  it grows into the empty columns. That is the same stability argument the gauge
  gets from sitting at column 0, applied to the row that changes.
- **A failure is never the thing that drops.** The alert segment is the one
  non-droppable chip: every other fact can be read again — the branch from git,
  the mode from the session, the spend from `/bytefly prices` — while a failed
  job that scrolled off the bar is a failure nobody is looking at. It keeps its
  count (`✗1`) when it compacts.
- **Segments degrade; they do not clip.** Each `Segment` carries progressively
  shorter `forms` and a `weight`; the layout advances the lowest-priority form
  or drops the lowest-priority segment, and only truncates once everything is
  minimal. The gauge steps `10 → 5 → 3 → 0` blocks, tokens drop before cost,
  and a branch that no longer fits its name drops rather than collapsing to a
  glyph. The gauge floors its fill and shows at least one block for any
  non-zero usage, so it reads full only at 100% and a small percentage never
  disappears; unknown usage draws no gauge at all. Only at extreme widths does
  `truncateToWidth` clip the remaining text.
- **Separators shrink to a single space.** Every segment is joined by the same
  padded ` · `, which collapses to one space before `truncateToWidth` applies, so
  adjacent segments never collide and the ellipsis never replaces a separator
  with nothing after it.
- **Statuses compact with their colour.** A themed status's compact icon form
  reattaches its opening and closing SGR sequences around the visible text, so a
  red `✗1` stays red instead of losing its colour exactly when the bar tightens.
  A two-token `icon count` badge (for `rewind`: `↺ 2`) compacts to `↺2`, keeping
  the count. A mode is droppable, so it goes before the branch and long before
  the model is clipped; only an alert is not.
- **A budget is a position, not a second figure.** With `price.budget` set, the
  cost segment reads `$0.31/$5` and turns `warn` once the spend reaches the
  ceiling, which is the same `budgetState` condition the notice fires on, so the
  bar cannot call a session over budget that the notice has not. The ceiling is
  formatted by its own `formatLimit` — the number the user typed, with trailing
  zeros dropped — while the spend keeps the currency's precision; both the bar
  and the notice use it, so the two cannot disagree about one figure.
- **Neutral by default; color means something.** A tool block carries no status
  colour except the accent tool name and the status-coloured result rail; an
  informational notice leads with `muted`; a failure is red only where the
  tool's own output says so, so the transcript is not a wall of green.
  The context gauge is the other coloured surface: it stays `muted` below 70%,
  cost is `muted`, the session and branch are `muted`, and tokens/cache/window are
  `dim`, so yellow and red are reserved for a threshold or a failure rather than
  always on.
- **Data is read fresh, except the usage scan.** The component resolves the
  theme through a getter and reads a fresh snapshot each render. The expensive
  part — summing token/cost totals across the session — is memoized by
  `sessionId:leafId` (every append moves the leaf), avoiding
  `getEntryCount()`, which is not exposed on the read-only session manager.
- **TTY-only, fail-safe.** The bytefly is installed only in `tui` mode;
  non-interactive runs load the extension and change nothing.
- **Notify splits when, what, and how.** The trigger policy lives in
  `notify/register.ts`, the wording in `notify/format.ts`, and the delivery in
  `notify/dispatch.ts`, so each is testable without a terminal or a child
  process and the sanitize-at-the-boundary rule has one home. The `job`
  extension publishes completions on `pi.events` rather than being imported,
  because extensions load with isolated caches and may not import each other;
  the channel and its payload live in `lib/events.ts`.
- **The price is a stage, not a branch in the renderer.** Entries are reduced to
  usage records (`collect/`), records are priced into totals (`price/`), and the
  snapshot is drawn (`render/`). Pricing is a pure function of records and rates
  — no session, terminal, or theme to stub — which is what lets the published
  DeepSeek example be a unit test. In `CNY` mode a record with no matching rate
  simply contributes nothing; `USD` mode is the opt-in path to Pi's own number.
  The built-in DeepSeek table is only the default value of `rates`, so nothing
  in the pricer is provider-specific.
- **DeepSeek is built in, not bundled as a catalog.** Its published price is in
  yuan at two tariffs, while Pi's catalog holds one USD number per model, so an
  unconfigured DeepSeek session showed a bill that was neither the right
  currency nor the right amount outside peak. The table sits beside `CONFIG` as
  the default `rates` and `peak`, which keeps config in charge and leaves the
  pricer a pure function of records and rates.
- **A record is dated, not the frame.** The peak schedule is evaluated against
  each entry's own timestamp, so a total is stable as the clock crosses a
  boundary — and memoizing the scan by `sessionId:leafId` stays valid.
- **The screen reuses Pi's resolution; only the toggle is ported.** Reading
  `SettingsManager` and `DefaultPackageManager` (public exports) makes the list
  match what Pi loads; the `+`/`-` pattern arithmetic is a trimmed port of Pi's
  config selector, kept pure and separately tested so a future drift is easy to
  diff.
- **Two picker views, one write scope.** Personal (`global`) and effective
  (`project`) resources are resolved separately, mirroring `pi config`; the
  screen shows the view for the active scope and writes through the matching
  store. A project package override is written with `autoload: false`, so it
  filters the personal entry instead of replacing it.
- **The merge keys on a directory name only when it is unambiguous.** A
  subfolder resource displays as `web-access/index.ts` while its doctor report
  is named `web-access`, so the join starts from `basename(dirname(path))`. A
  name shared by more than one resource — a user `plan` beside the package's
  `plan`, or the `extensions` directory every flat file shares — claims no
  report, so no row is lent another resource's health; the unclaimed report
  appends in the trailing `Not resolved` group with its findings intact. Rows are keyed
  by the unique resource identity (`source:path`, or `report:<name>` for a
  report with no item) so the cursor survives a rebuild even when two rows
  share a directory name, and a row without a report shows no glyph and no
  summary rather than a false `ok`.
- **Doctor declarations live in `lib/`, probes in the extension, presentation in
  a third layer.** An extension cannot import another extension's modules, so
  the only legal home for a shared prerequisite table is `lib/requirements.ts`;
  the report itself is a pure function of the probe results.
- **The install hint has one home.** `file-read` and `web-access` format their
  tool errors from the same `REQUIREMENTS` entries `doctor` prints, so a user
  reads the same command whether a tool failed or the report named it.
- **Settings are a curated table, not a schema walker.** The rows cover every
  scalar preference across four kinds — a boolean, an enum, a string with
  its own rule, and a number — both scopes, both write paths, and one nested leaf
  (`price.currency.decimals`). A row states its section and the path to its leaf,
  and one reader per section resolves it project-over-global-over-defaults through
  the same normalizer the extension loads with, so the screen and the runtime
  cannot disagree about a value; a text row's rule calls the same predicate the
  loader uses, so an accepted value is never replaced on the next read. A generic
  walker would expose keys the screen cannot edit safely — arrays, nested
  tariffs, credentials — so the catalogue grows one proven family at a time. App
  rows are Global-only because Pi's setters write the personal file; Project
  scope lists only the `bytefly.json` rows it can actually write.
- **The doctor is quiet unless the bytefly startup TUI is on.** Only `missing`
  findings post a notice, only for enabled extensions, only with a UI, only once
  per session, and only when Pi's `quietStartup` is `true` — the same state that
  installs bytefly's header. `false`, `"header"`, and unset leave Pi's startup
  surface in charge and the notice silent. `degraded` findings — including a
  malformed config — wait in `/bytefly doctor`, because a session that nags
  about an optional package is worse than one that never mentions it.
- **A startup warning belongs in the message flow, not a toast.** The notice is
  the same custom message `job` and `watch` use, so it survives in scrollback
  and the model reads the same sentence the user sees; a transient notification
  would leave both without it. Its rows carry the install hint, so it is
  actionable where it lands.
- **Probe the real thing.** `subagent`'s requirement resolves through the same
  `getPiInvocation` the extension uses rather than re-guessing whether a `pi`
  binary exists.
- **The prerequisite table is data.** No I/O, no host access, no module state:
  every probe dependency arrives as a seam, so `probeExtension` is testable with
  no process and `lib/` stays value-only.
- **Pi owns the update list; bytefly owns the look.** There is one detector, not
  two: `DefaultPackageManager` already resolves npm ranges, git refs, project
  scope, and offline mode, and bytefly only carries its result to a themed
  surface. The extra registry read only names this package's version for the
  marker, arrow, and release URL; it never decides whether an update exists.
- **The suppression is a host shim, not a second checker.** Pi has no setting or
  extension event for its startup block, so bytefly replaces the public method
  that feeds it while keeping the captured original for its own read. It is
  installed only in `tui`, restored on shutdown, and made inert if the host
  changes shape.
- **The marker is an action, the notice is information.** This package's new
  version is drawn in the accent on the header, where it sits beside a control
  the user can act on, and every package is listed at `info` severity in the
  transcript, where a `warn` rail would say something is broken. Neither surface
  needs per-frame polling: the value arrives once, the memo key includes it, and
  one `setHeader` re-install repaints.
- **The transport stays local.** `web-access`'s runner does redirects, SSRF
  checks, HTML extraction, and caching — none of it applies to one fixed JSON
  endpoint, and an extension may not import another's modules, so the ~20-line
  read lives beside the check with the `fetch` and timeout as seams. The package
  list itself is Pi's own command execution, not a second transport.

## Files

The surfaces are folders: `header/`, `footer/` (the status bar and its price
calculation), `message/` (the user-message marker), `notice/` (the shared notice),
`block/` (the tool-block frame), `separator/`, `working/` (the live
run line on the composer's top border), `panel/` (the
unified screen and its merged model),
`picker/` (discovery and the settings store), `doctor/` (the `run_doctor` tool
and its probe runtime), `notify/`, and `update/` (Pi's package list, Pi's own
release notice, the host patches, the cache, and the header markers). The chrome and the screen are drawn from
the package's [`lib/tui/`](../../lib/tui/) design system (tokens, rules, rows,
columns, gauge), so the look follows the active theme.

| File | Responsibility |
|---|---|
| `index.ts` | Composition root: the disable guard, the `register*` calls, the two per-load update stores, the one shared output-pad store, and the rail source. |
| `pad.ts` | `PadSource` and `createPadStore`: one record of Pi's output pad, so the tool frame, the notice, and the turn separator inset by the same margin. |
| `chrome.ts` | The transcript rail (`RAIL_ROLES`, `railGlyph`), the `chrome` section's normalizer and loader, and the `RailSource` that `registerChrome` keeps current on `session_start`/`session_tree`. |
| `header/config.ts` | Header tuning (`HEADER_CONFIG`): mark and identity roles, tagline, and the grouped help entries. |
| `header/component.ts` | `ByteflyHeader`: the mark, the two identity rows mounted from `identityCells`, signature rule, and grouped help, plus its factory. |
| `header/identity.ts` | `IdentityInput` and `identityCells`: the agent and chrome cells, each with its `↑` marker, in the ladder that sheds the chrome marker, the chrome version, the chrome line, and finally the agent's marker with the row. |
| `header/register.ts` | Installs/restores the header and owns its session lifecycle. |
| `footer/register.ts` | Installs/restores the footer and owns its session lifecycle. |
| `footer/config.ts` | Bar tuning (`CONFIG`): thresholds, gauge, separators, icons, alert and mode status keys, labels. |
| `footer/types.ts` | `StatusSnapshot`, `Segment`, `LineSpec`, `UsageRecord`, and footer/TUI shapes. |
| `footer/budget.ts` | The session spend guardrail: whether the configured ceiling has been crossed and the one notice that says so — an alert, never a limit. |
| `footer/delegation.ts` | The child-run ledger: the pricing inputs of the last delegated runs, versioned so the footer re-prices when a subagent finishes. |
| `footer/collect/entries.ts` | Session entries → usage records, each resolved to the model in effect. |
| `footer/collect/snapshot.ts` | Snapshot assembly; memoized pricing scan, context estimate, and session name per branch leaf. |
| `footer/price/types.ts` | `Currency`, `ModelRates`, `PeakWindow`/`PeakSchedule`, `ByteflyConfig`. |
| `footer/price/config.ts` | The `price` section of `bytefly.json`: schema, defaults, built-in DeepSeek rates/tariff, currency defaults, normalizer, loader. |
| `footer/price/rates.ts` | Model-key matching: `createRateLookup` splits every key once, splits a key at its first slash (so an OpenRouter model id may contain one), matches exact and wildcard most-specific-first, and remembers the last record's model. |
| `footer/price/schedule.ts` | Peak-window parsing and evaluation in a configured zone. |
| `footer/price/price.ts` | Records → totals: rated cost in both modes, Pi's recorded cost as USD's fallback, the peak multiplier, and the count of records CNY could not rate. |
| `footer/unpriced.ts` | The one notice a session posts for records nothing could price: the models by key, the count that the two agree on (`recordsText`), and its OS-notification body. |
| `footer/render/format.ts` | Generic formatters (tokens, cost in the configured currency, cwd, the context role, truncation). |
| `footer/render/status.ts` | Status-chip transforms: `compactStatus` and `dropStatusDetail`. |
| `footer/render/segments.ts` | The segment builders: forms, weights, separators, roles. |
| `footer/render/lines.ts` | Snapshot → two `LineSpec`s; status routing. |
| `footer/render/layout.ts` | Width reduction and right-zone folding. |
| `footer/render/footer.ts` | `StatusBar` component and footer factory. |
| `footer/render/key.ts` | `snapshotKey`: the bar's repaint key, derived from the snapshot's own shape — sorted object keys, a map as sorted entries, a primitive by value — so a field added to `StatusSnapshot` is in the key the day it is added. |
| `message/config.ts` | Nameplate tuning (`MESSAGE_CONFIG`): the label and the rule. |
| `message/format.ts` | Pure `nameplate` and `styleUserMessage`: the two-row nameplate (label over a full-width rule) and its placement above the message. |
| `message/register.ts` | Registers the Markdown transformer (the nameplate). |
| `mode/editor.ts` | The main editor with `Shift+Tab` bound to plan mode: `isShiftTab` consumption, the mode-aware border (`success`/`warning`) applied in `render`, the `app.thinking.cycle` unbind/restore, and `attachModeKey(pi, ctx)` with its idempotent cleanup. Loads on the first TUI session through a dynamic import. |
| `notice/config.ts` | Notice tuning (`NOTICE_CONFIG`): source/title/detail roles, the severity glyphs and roles, the shared rail roles, and the item cap. |
| `notice/component.ts` | Pure `noticeLines` and `NoticeComponent`: the headline at the margin, the rail-led severity rows, sanitized and width-clipped. |
| `notice/register.ts` | Registers the message renderer for the shared notice type and hands it the rail source. |
| `block/config.ts` | `BlockStatus` and `BLOCK_CONFIG.roles`: the design role a result's rail takes for each state. |
| `block/component.ts` | Pure `toolBlockLines`, `headlineWithToolName`, `recolorShellCall`, `recolorCallHeadline`, and `ToolBlock`: the headline, the body's two-column indent (optionally rail-led), the reduced-width inner render, the leading-blank trim, the shell-prompt rewrite (the name keeps the accent, the command reopens in `label`), the subject demotion (a path, URL, query, or pattern reads in `label` so the name is the line's only accent, including the tail a bare `edit <path>` headline wraps onto the body), and the image-line passthrough. |
| `block/fallback.ts` | Generic `callFallback` / `resultFallback` for a tool with no renderer: the subject in the body colour, its options faint, and a capped result preview. |
| `block/register.ts` | The `registerToolRenderer` resolver that frames every tool; it recolours a shell call's string before the frame wraps it, rails the result body by status, and rails the call body for `edit`/`write` (the two whose call body carries the result). |
| `separator/config.ts` | Turn-rule tuning: `customType`, glyph, label prefix, padding, receipt minimum duration and outcome wording, and roles. |
| `separator/register.ts` | Registers the entry renderer, tracks the run's tools and failures, and appends the receipt on `agent_settled`. |
| `separator/component.ts` | `SeparatorComponent`: the entry renderer, memoized on the width so a repeat frame does not rebuild the rule. |
| `separator/format.ts` | Pure `receiptLabel` (the width ladder), `receiptRole`, and `separatorLine`, drawn by the kit's `centeredRule`. |
| `separator/types.ts` | `TurnSeparatorData`: the turn plus the optional receipt fields. |
| `working/config.ts` | Counter tuning (`WORKING_CONFIG`): the words, the tool singular/plural, and the tick interval. |
| `working/format.ts` | Pure `formatElapsed` (whole seconds) and the working-message shape: the plain count and the `tool · N tools · elapsed` run line. |
| `working/register.ts` | Starts the tick on `turn_start`, tracks top-level tools on `tool_execution_start`, and cancels on `agent_end`/`session_shutdown`. |
| `panel/types.ts` | `PanelSection` (`extensions` \| `skills` \| `settings`), `PanelRow` with its optional skill info, `SkillInfo`, and `PanelModel`, the merged row model. |
| `panel/join.ts` | The item/report union with the unambiguous-name naming rule — a row is `worktree`, and a directory claims a report only when one resource uses that name — plus unique row keys, groups, ordering, and the skills model that labels rows from `SKILL.md`. |
| `panel/filter.ts` | The two filters as predicates and chips: a text query over a row's name, path, and source, the attention switch, and what the tab row says is on. |
| `panel/format.ts` | Non-TUI text: the resource headline and grouped listing with a per-row verdict, the header's attention segments, the one `rowBadge` the screen and the listing share, the section segments and their order, the Settings counts/headline, and the flat Settings listing. |
| `panel/settings.ts` | The curated Settings catalogue: the fifteen descriptors in screen order, their five groups, the value labels (`Off`, `¥5.00`) and display origins, value cycling, stored-value mapping, validation, plus the per-section readers that resolve a row's leaf over the global and project documents. |
| `panel/settings-runtime.ts` | The Settings runtime: snapshot cache, scope guards, app setters, per-leaf `bytefly.json` writes, dirty state, and change listeners. |
| `panel/themes.ts` | Which themes the Theme row offers: the host's resolved list narrowed to the palettes under this package's `themes/`, identified by directory rather than name. |
| `panel/prices.ts` | The `/bytefly prices` report: the unpriced models by key, the records behind each, and the one line saying where the keys go. It quotes no price — a rate is the user's to state. |
| `panel/skills.ts` | Skill metadata through Pi's own `loadSkills`, keyed by resolved path, plus the deduplicated paths both discovery views read. |
| `panel/tui.ts` | `PanelComponent`: the section switch, the three cursors and focus keys, the filter and help state, the toggle chain, and the one render that hands the frame its header, tabs, rows, and block. |
| `panel/tui/keys.ts` | The one key table: each binding with the sections that offer it, the hint row they produce, and the `?` help block, so a key cannot drift from its hint or its help line. |
| `panel/tui/panes.ts` | The two-pane arithmetic: the 96-column breakpoint, the side-pane width, one composed row with its `╎` divider, and the clip that ends a block with `… N more lines`. |
| `panel/tui/side-pane.ts` | The focused row's block in both layouts: name and verdict, findings, `Path`, `Source`, `State`, `Health`, a setting's `Now`/`About`/`Stored in`, the JSON pane, and the saved marker. |
| `panel/tui/section-view.ts` | What the screen derives from the session: the tab counts, the one body height, the header's attention, the filter chips, the empty label, and the merged model for a list section. |
| `panel/tui/list-view.ts` | The resource row grammar only: the checkbox, the status glyph, the name, and the verdict column. |
| `panel/tui/settings-view.ts` | The settings row — checkbox, label, value in its measured column, the editing cell — and the editor's hint row. |
| `panel/tui/entries.ts` | The flat display entries per section and the stable focus keys. |
| `panel/tui/editing.ts` | The text-row editor's key map: caret moves, delete, clear, commit, cancel. |
| `panel/tui/frame.ts` | The chrome — the header rule, the tab row with its counts, chips and scope, the group heading, the hint or notice row, and the saved marker — and the height law: one body target for all three sections, the range row, and the rows a short terminal sheds. |
| `panel/tui/settings-section.ts` | The Settings section's state only: the text editor, the JSON pane, the write chain, and the reset. |
| `panel/tui/nav.ts` | The panel's cursor arithmetic and one read of a navigation key. |
| `panel/commands.ts` | `/bytefly`: one command for the screen sections, the `doctor` report, the settings and skills listings, and their text modes. |
| `picker/types.ts` | Picker host seams (`SettingsStore`, `ResourceResolver`, `Discovery`, `ResourceKind`), the app-settings setters, and row types. |
| `picker/resources.ts` | Pure grouping, labels, display names per resource kind, and pattern helpers. |
| `picker/toggle.ts` | Pure next-settings transforms for global and project toggles. |
| `picker/discovery.ts` | Host wiring: builds both kinds' global and effective views from Pi's managers, and the two settings stores for the settings-only command path. |
| `picker/runtime.ts` | Picker scope, live view copies, dirty tracking, and persistence, for both resource kinds through one ops table. |
| `doctor/register.ts` | Registers `run_doctor` and the proactive session-start check; returns the runtime. |
| `doctor/runtime.ts` | Host seams, the session cache, and the two probe modes. |
| `doctor/tools.ts` | The `run_doctor` tool and its renderers. |
| `doctor/schema.ts` | Tool parameters and the structured output schema. |
| `doctor/config.ts` | `DEFAULT_CONFIG`, `normalizeConfig`, `loadConfig` for the `doctor` section of `bytefly.json`. |
| `doctor/format.ts` | Pure report text, summary, severity roles and glyphs, detail lines, the proactive warning sentence, and the transcript notice it posts. |
| `notify/types.ts` | `NotifyConfig`, `NotifyMethod`, and the method list. |
| `notify/config.ts` | The `notify` section of `bytefly.json`: defaults, validation, loader. |
| `notify/dispatch.ts` | Method selection and delivery: OSC 777/99, Windows toast, `osascript`, `notify-send`, over injected seams. |
| `notify/format.ts` | Pure notification text: session label and the turn / input / job / watch bodies. |
| `notify/register.ts` | Registers the four triggers, loads the config at `session_start`, and owns the job- and watch-bus subscriptions. |
| `update/types.ts` | `PackageUpdate` and `PackageUpdateCheck`, derived from Pi's public manager method; `PiRelease` and `ReleaseNoticePrototype`, derived from Pi's notification method. |
| `update/patch.ts` | `patchPrototypeMethod`: the one host-method replacement both update surfaces use — a per-method `Symbol.for` marker, idempotent reuse, a restore that only puts back its own replacement, and an inert result when the host has no such method. |
| `update/suppress.ts` | The two host shims over `patchPrototypeMethod`: capture Pi's `checkForAvailableUpdates` and replace it with an empty result, and hand `showNewVersionNotification`'s release to bytefly (falling back to the captured original if that throws). |
| `update/check.ts` | Pi's package list through `DefaultPackageManager`, plus the registry `GET` that names this package's version for the marker, arrow, and release URL. |
| `update/version.ts` | Pure semver parsing and `isNewerVersion`, including prerelease precedence. |
| `update/state.ts` | `UpdateSource` and `createUpdateState` (one known version per subject per load), `paintLatest` (record and repaint the header only on a change), plus `UpdateOutcome`, the four answers an explicit re-check can give. |
| `update/cache.ts` | The project-scoped snapshot: `<agent-dir>/bytefly/update.json`, the cwd/package key, the 24 h window in `isFresh`, a validated read that degrades to a miss, and the atomic write. |
| `update/format.ts` | `updateMarker`, `updateNotice`, `releaseUrl`, `updateOutcomeText`, and `piReleaseNotice`, plus the shared command/link rows: the header's `↑0.12.0`, the multi-package notice, the line `/bytefly update` prints, and the notice that replaces Pi's `Update Available` box. |
| `update/register.ts` | The package-update lifecycle: suppression, the cache-first session-start read, the async package-manager call, this package's version lookup, the `PI_OFFLINE` and `tui` gates, the once-per-load announcement, the shutdown generation guard, and the `recheck()` handle `/bytefly update` calls. |
| `update/release.ts` | Pi's own release lifecycle: install the notification patch in `tui` mode, record the release's version for the agent-line marker, post the notice once per load while the session is live, and restore the method on shutdown. |

## Testing

Every suite sits beside the code it covers, so a slash-prefixed stem below
resolves to `extensions/bytefly/<stem>.test.ts`.

`extension` covers the registration, the interactive surfaces, and the command
wiring through the factory.

`chrome` covers the chrome that frames a session: the config and its pad store;
the header's frames, width shedding, identity ladder, update marker, live theme,
quiet-startup lifecycle, and terminal-height shapes; the transcript notice's rows
and registration; the turn separator's formatting (including the receipt's width
ladder), component, and register/append/render/disable lifecycle with the run
stats it records; and the user-message nameplate's transform — through pi-tui's
real `Markdown` — and its registration.

`footer/footer` covers the bar end to end: the price config, its schema, clamping,
and defaults; rate matching, window parsing and peak evaluation in two zones, the
pricing formula with its off-peak multiplier, the built-in DeepSeek table and the
fallback, the usage records, and the delegation ledger; the snapshot reader and its
memo, the unpriced notice, and the budget; the formatters, the status-chip
transforms, the segment builders, line composition, and the repaint key that
spares an unchanged frame a rebuild; the reduction, separator collapse, and
right-zone folding across a width sweep from 6 to 120 plus wide characters; and the
component with its install/skip/restore/toggle lifecycle and a config-driven price.

`block/block` covers the tool-block frame: `toolBlockLines`, the call-headline
rewrites, `ToolBlock`'s memo, the generic and call fallbacks, and the resolver's
shell override and self-shell carve-out.

`picker/picker` covers discovery with an injected factory, the resolver and its
entries, the pattern helpers, and the runtime's toggling, scope, and project
override across the four list operations.

`panel/…` covers the control centre, one suite per capability: `panel/model` (the
two panes' merged model and the text formatter), `panel/filter` and its chips, the settings
catalogue and its cycling (`panel/settings`), the scope-aware runtime
(`panel/settings-runtime`, including a nested leaf write that keeps its siblings),
the skill metadata join and loader (`panel/skills`, on real `SKILL.md` files), the
key table whose hints and help it holds to one source (`panel/keys`), the frame and
the one height all three sections agree on (`panel/layout`), the row grammar and the
focused-row block beside and under the list (`panel/views`), the two-pane split and
its `… N more lines` clip (`panel/panes`), the editing key map (`panel/editing`),
the update section's view (`panel/update`), the discovery probe (`panel/probe`), the
component's frames, keys, sections, settings, and probe lifecycle
(`panel/component`, `panel/component-input`, `panel/component-sections`,
`panel/component-settings`, `panel/component-probing`), and the command through the
bytefly factory (`panel/commands`) — eighteen suites in all.

`doctor/doctor` covers the report counts and text, the config loader, the notify
seam, the published search provider, the proactive probe, the session state,
`run_doctor`, and the tool wiring.

`notify/notify` covers its config loader, method selection, delivery over recording
seams, the text builders, and its four triggers plus the handle.

`update/update` covers the cache path and key, the cache read and write with its
window, the check and the injected registry read, the version ordering, the
formatters and the release notice, the prototype suppression with its idempotent
restore, the per-load state, the lifecycle — a fresh matching entry reused without
a package-manager call, a stale one re-read and rewritten, silent on failure or an
empty list, cache-only offline, skipped outside `tui`, a `recheck()` that ignores
the window, and a reply that lands after shutdown — and the `update` action.

`working/working` covers the elapsed format, the counter, and the timer registration.
