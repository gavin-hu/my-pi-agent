# bytefly — the TUI header, footer, turn rule, extension screen, and notifications

`bytefly` owns the terminal chrome, configuration, and diagnostics surfaces
this package adds: one themed startup header whose two-tone nameplate carries
the agent and chrome identities, one compact, colorful, width-adaptive two-line
footer, a labeled rule that marks each completed turn in the transcript, one
keyboard-driven screen that lists every resolved Pi extension with its enable
checkbox and its health, and an opt-in notify capability that raises an OS
notification when a run finishes, a job finishes, or the agent asks for input.
DeepSeek is priced from the provider's published yuan rates and peak tariff by
default, and any other model can be priced from your own rates when Pi's catalog
does not match what a provider actually charges.

```
pi --extension ./extensions/bytefly   # load just this extension
pi -e .                               # load the whole @gavin-hu/my-pi-agent package
pi install ./                         # install the package
```

## What it does

The extension owns five surfaces: the startup header, the footer, the rule
between completed turns, the extension screen, and notifications.

**Header.** A nameplate: a two-tone half-block mark from the active theme's
`accent` / `warning` tokens, the agent identity (`Pi` and its version), the
chrome identity (`enhanced by bytefly` and the package version), a `─` rule, and
a grouped help block. The help keys resolve live from Pi's keybindings, so a
rebound key shows the user's chord; the identity and help text are `muted`/`dim`
so the mark keeps the eye. It is installed only in interactive (`tui`) sessions,
and on terminals that cannot render half blocks the mark falls back to a
two-tone `Pi` wordmark.

```
 █▀█  Pi v1.2.0
 █▀ █ enhanced by bytefly v0.7.0
 ─────────────────────────────────────────────────
  escape to interrupt · ctrl+c to clear · ctrl+d to exit
  ctrl+o more · ctrl+t to think · ctrl+l models · ctrl+g editor
  / commands · ! bash · /bytefly extensions · /doctor checks
```

As the terminal narrows, the identity sheds the chrome version, then the chrome
line, then the agent name, and the help rows drop whole keys, so nothing wraps or
clips mid-word. The mark, tokens, identity, and grouped help are tuned in
[`header/config.ts`](./header/config.ts).

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

**Extension screen.** `/bytefly [extension] [refresh]` opens a keyboard-driven
dock list of every Pi extension the session resolves — across personal settings
and, when trusted, the project — one row per extension with its enable checkbox
and its worst-severity health, and writes a `+pattern` / `-pattern` toggle into
the matching `settings.json`. The focused extension's findings sit underneath,
and `run_doctor` returns the same report as text and typed data. Only a missing
*hard* requirement warns at session start; everything else waits in the report.
See [The bytefly screen](#the-bytefly-screen).

**Notify.** Off by default, one `notify` section in `bytefly.json` turns on OS
notifications for unattended runs: when a full agent run settles, when a
background job finishes, and when the agent opens a prompt asking for input. The
method follows the terminal (OSC 777, OSC 99, a Windows toast) or falls back to
the platform notifier (`osascript`, `notify-send`); see
[Notifications](#notifications).

## Commands

| Command | What it does |
|---|---|
| `/bytefly [extension] [refresh]` | Open the extension screen. In `tui` it mounts a docked list; every other mode prints the grouped listing, or one extension's full findings when named. |
| `/extensions` | Alias for `/bytefly`: the same screen and the same handler. |
| `/doctor [extension] [refresh]` | Alias for `/bytefly`: the same screen and the same handler. |

Tab completes extension names and `refresh` for all three commands.

## Behaviour by mode

The header, footer, and turn rule are installed only in interactive (`tui`)
sessions and are always on; every mode loads the extension, and non-TUI modes
change nothing. The screen is available in every mode: in `tui`, `/bytefly` and
its `/extensions` and `/doctor` aliases mount the docked screen, while RPC,
JSON, and print modes print the grouped listing with a per-row health suffix and
the headline, or that extension's full findings when one is named. The
proactive session-start warning is skipped when there is no UI. Notify runs in
every mode and picks its method from the environment; the OSC methods need a
TTY, so a print/JSON/RPC run gets an OS-level notification or none.

## Configuration

The header is tuned in [`header/config.ts`](./header/config.ts) — the mark and
identity theme tokens, the padding and tagline, and the grouped help entries
(each naming a Pi keybinding resolved live or a raw command prefix). The footer's
content and layout are tuned in [`footer/config.ts`](./footer/config.ts) —
thresholds, gauge
glyphs and widths, separators, icons, and status keys. The turn separator has no
JSON either: its glyph, label prefix, padding, and colors are tuned in
[`separator/config.ts`](./separator/config.ts).

Everything JSON-configurable lives in `bytefly.json`, one shared document with a
top-level section per extension (see [Configuration](../../docs/configuration.md)).
It is read from the global document, then `<cwd>/.pi/bytefly.json`. The old
per-extension files
(`document.json`, `jobs.json`, …) are no longer read; run
`bun run config:migrate` to move them into the shared document.

The price
calculation is configured by the `price` section of the shared `bytefly.json`
(see [Configuration](../../docs/configuration.md)), read from
`~/.pi/agent/bytefly.json`, then `<cwd>/.pi/bytefly.json` (project wins).

Both documents are optional, and neither is needed for DeepSeek. The built-in
table is the base layer for every session: DeepSeek is priced in yuan at the
published peak and off-peak rates, and every other model keeps Pi's recorded
cost, whose number comes from Pi's catalog. A document can change the currency,
replace a built-in rate, or add rates of your own. A malformed document is
ignored, a wrong-typed value falls back to its default, and an unknown timezone
drops the schedule rather than the session.

```json
{
  "price": {
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

Rates merge key by key across the two documents, so a project document can
override one model without restating the rest; a key present in both is replaced,
not merged field by field. No windows means every moment is peak, so a rate with
`offPeakMultiplier: 0.5` and no schedule stays flat. The `price` section is read
once per install — at `session_start`, and again on a `session_tree` change — so
a new session or tree change picks up an edit; there is no toggle, and nothing
watches the file.

**Mixing currencies is the sharp edge of the built-in default.** A record priced
from `rates` or the built-in table is in `currency.symbol` units — yuan for
DeepSeek — while a record that fell back carries Pi's USD number under that same
symbol. A session mixing DeepSeek with another provider therefore sums two
currencies into one number. Either cover every model you use (a `"*"` catch-all
helps) and set `fallbackToRecordedCost: false`, or set the symbol to `"$"` and
treat the rates purely as an off-peak correction.

### The `notify` section

The notify capability reads the same shared `bytefly.json`, under its own
top-level `notify` key.
It is **off by default**; `enabled: true` is the whole setup needed for an
unattended run, and the three trigger flags then narrow what is announced. The
price section and the notify section are parsed independently, so a wrong-typed
value in one never reaches the other.

```json
{
  "notify": {
    "enabled": true,
    "turnFinished": true,
    "needsInput": true,
    "jobFinished": true,
    "method": "auto",
    "title": "Pi"
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Master switch. A notification on every turn is intrusive, so it is opt-in. |
| `turnFinished` | `true` | Notify when a full agent run settles and Pi waits for the next message. An aborted run is never announced. |
| `needsInput` | `true` | Notify when the agent opens a prompt mid-run (`select`, `confirm`, `input`, `editor`, `custom`). A prompt the user typed while idle does not fire. |
| `jobFinished` | `true` | Notify when a background `job` reaches a terminal state. |
| `method` | `auto` | `auto`, `osascript`, `notify-send`, `toast`, `osc777`, or `osc99`. An explicit method that the environment cannot deliver is a no-op. |
| `title` | `Pi` | Notification title, clamped to 40 characters. |

A `notify` section is read at `session_start`, so a new session or `/reload`
picks up an edit.

### The `doctor` section

The doctor surface reads the same shared `bytefly.json`, under its own top-level
`doctor` key:

```json
{
  "doctor": {
    "proactive": true,
    "timeoutMs": 2000,
    "skip": []
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `proactive` | `true` | Probe the extensions with hard requirements at session start and warn once when something is missing. |
| `timeoutMs` | `2000` | Per-probe timeout for one spawned command, clamped to 100–30000. |
| `skip` | `[]` | Extension names to leave out of every report. |

A malformed `bytefly.json` is ignored like every other config file — and named
by the report `doctor` produces. The section is read at `session_start`, so a
new session or `/reload` picks up an edit.

## Security

- Project settings are only read or written when the project is trusted
  (`ctx.isProjectTrusted()`); an untrusted session offers Global scope only.
- Discovery never installs or fetches a package: missing sources are skipped.
- The extension screen registers no model-facing tool; toggling writes only
  through Pi's `settings.json`, and `run_doctor` is read-only.

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

## The bytefly screen

`/bytefly [extension] [refresh]` is a keyboard-driven dock list of every
extension Pi resolves for the session, so the list matches what actually loads.
It merges the former extensions picker and doctor report into one row per
extension: the picker's enable checkbox and label, the doctor's worst-severity
glyph and summary. `/extensions` and `/doctor [extension] [refresh]` are
registered against the same handler, so all three names open the same screen;
`[extension]` narrows it to one extension and `refresh` re-probes the doctor
before it opens. Tab completes extension names and `refresh`.

The screen reuses Pi's own settings and package resolution (`SettingsManager`
plus `DefaultPackageManager` with `onMissing: "skip"`), so opening it never
installs or fetches a package.

- Lists every resolved extension, grouped by source (each package, user
  settings, project settings), sorted packages-first and then by display name.
- Omits `bytefly`'s own entrypoint from the picker groups, so the tool that
  manages the list is never a selectable row; its doctor report still appears in
  the trailing `Not resolved` group.
- Shows whether each one is enabled (`[x]`) or disabled (`[ ]`).
- Shows the worst severity for a reported extension (`✓` ok, `!` degraded, `✕`
  missing, `∅` disabled) and its summary; an extension with no doctor report
  leaves the glyph column and the summary blank rather than claiming `ok`.
- Toggles the focused extension with `Space`, writing `+pattern` / `-pattern`
  into `extensions` (and package filter objects) in the active scope.
- Switches the write scope with `Tab`: **Global** (personal `settings.json`) or
  **Project** (`.pi/settings.json`, only when the project is trusted; an
  untrusted project refuses with a notice).
- Expands or collapses the focused extension's findings with `Enter`, and
  re-probes with `r`. While a re-probe is in flight the hint shows `refreshing…`
  and a second `r` is ignored, so probes cannot stack.
- Offers a reload after pending changes, so the new selection takes effect
  without leaving the session.

The doctor side probes every declared extension and reports each check as `ok`,
`missing`, `degraded`, or `info`; `run_doctor` returns the same report as text
plus a typed `structuredContent` report. Only `missing` and `degraded` are
problems: `missing` means an enabled extension cannot do its job, `degraded`
means reduced capability — an optional package that is absent, a config file
that fails to parse, a login that has not happened. Doctor never changes
anything and never installs anything.

`/bytefly <extension>` narrows the same screen to that extension, including the
checks that passed, and `/bytefly refresh` ignores the findings cached earlier
in the session. Every other mode prints the grouped listing with a health suffix
on each row and the headline; a named extension prints its full findings
instead.

### Keys

| Key | Effect |
|---|---|
| `Space` | Toggle the focused extension. |
| `Enter` | Expand or collapse the focused extension's findings. |
| `Tab` | Switch between Global and Project scope. |
| `r` | Re-probe the doctor. |
| `↑`/`↓`, `j`/`k` | Move the selection. |
| `PgUp`/`PgDn` | Move a page. |
| `g` / `G`, `Home` / `End` | Jump to the first or last extension. |
| `Esc` / `Ctrl+C` | Close the screen. |

Mouse wheel scrolling works; every action also has a keyboard path.

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
| bytefly | — | TUI only for the header, footer, and turn rule; the screen's project scope needs a trusted project; `bytefly.json` |
| question | — | needs an interactive UI |

Every extension that reads a config file also gets the malformed-JSON check:
the file and the parse error are named instead of being silently ignored. The
install guidance a tool error shows and the hint this report prints come from
the same entry in `lib/requirements.ts`, so the two cannot drift.

## Notifications

The notify capability exists for unattended runs: start a long turn, leave the
terminal, and get a desktop notification when Pi needs you — or when it is done.
It fires on three events, each independently switchable in the `notify` section
of `bytefly.json` (see [Configuration](#configuration)):

- **A run settled** (`agent_settled`). Pi finished the turn and waits for the
  next message. An aborted run is skipped: interrupting with Escape means the
  user is already at the keyboard.
- **The agent needs input.** Pi opened a prompt while a run was active — an
  `ask_user_question`, a plan review, a subagent approval. A prompt opened while
  idle is a command the user just typed, so it does not fire; the run boundary
  is what separates "the agent is asking" from "the user is asking".
- **A background job finished.** The [job](../job/) extension announces each
  terminal transition on the shared `pi.events` bus
  (`my-pi-agent/job-finished`); bytefly listens and never imports it.

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
- **Config scope is checked for `<agent-dir>/bytefly.json` and
  `<cwd>/.pi/bytefly.json` only**; a `job.registryDir` override is not
  followed.
- **Notifications are not focus-aware.** They fire whether or not the terminal
  has focus, and once per trigger rather than once per unseen event. There is
  no focus API to consult.
- **A background job cannot ask for input.** The `needsInput` trigger is a
  prompt raised during a run, not a process waiting on stdin: jobs are
  fire-and-observe, so that state does not exist.
- **An explicit `method` is honored blindly.** Point `method` at a notifier the
  host lacks (or an OSC method off a TTY) and the notification is silently
  dropped; only `auto` inspects the environment.

## Non-goals

- No per-segment CLI: the bar's look lives in `footer/config.ts`, the price in
  `bytefly.json`.
- No per-model cost breakdown and no on-screen marker for which tariff or
  which source produced a number.
- No todo-count segment; the [todo](../todo/) widget already shows progress.
- No shelling out for git ahead/behind; the footer data provider exposes only
  the branch.
- No session or model data in the header: it shows the nameplate and the grouped
  help block only. The footer owns the session, model, and working-directory
  data.
- No auto-fix: `doctor` reports the install command; it never runs it.
- No aggregation of runtime failures: a tool that errored earlier in the session
  is not a prerequisite problem, and `doctor` does not pretend to know about it.
- No status chip for the doctor report: it is on demand plus one warning, not a
  permanent footer segment.
- No notification for individual tool calls, message turns, or subagent steps:
  the three triggers — a settled run, a prompt mid-run, a finished job — are the
  whole surface.
- No sound, action buttons, notification history, or de-duplication; a
  notification is a fire-and-forget message, not an inbox.

The built-in footer's `(auto)` auto-compact indicator and `(sub)`
subscription-cost marker are not reachable from `ExtensionContext` (there is no
`autoCompactEnabled` or provider subscription check), so the bar omits them
rather than showing a wrong value.

## Pi integration

| Integration point | Details |
|---|---|
| Header | `ctx.ui.setHeader` with a custom component, replacing Pi's built-in header; installed only when `ctx.mode === "tui"`. The mark and text are drawn from the active theme's tokens, the help keys resolve live through `keyText`, and the mark falls back to a wordmark on Apple Terminal (`isAppleTerminalSession`), mirroring Pi's built-in. |
| Footer | `ctx.ui.setFooter` with a custom component, replacing Pi's built-in footer; installed only when `ctx.mode === "tui"`. |
| Screen command | `pi.registerCommand("bytefly"`, `"extensions"`, and `"doctor"`) share one handler: `tui` mounts a dock screen via `ctx.ui.custom()` with the rails suppressed, other modes print through `ctx.ui.notify()`. Tab completes extension names and `refresh`. |
| Turn separator | `registerEntryRenderer("bytefly-separator")` draws each rule; `agent_settled` appends `pi.appendEntry("bytefly-separator", { turn })` in `tui` mode only. |
| Notifications | `agent_settled` (skipped when aborted), `ui_prompt_start` only while `agent_start`…`agent_settled` marks a run active, and `my-pi-agent/job-finished` on `pi.events`; the `notify` section of `bytefly.json` gates each. Delivery writes an OSC 777/99 sequence to stdout or spawns `osascript`, `notify-send`, or `powershell.exe`. The bus subscription is created in `session_start` and released in `session_shutdown`, and the `job` extension never imports bytefly. |
| Picker discovery | `SettingsManager.create(...)` plus `DefaultPackageManager.resolve({ onMissing: "skip" })`, both public exports; both views drop `bytefly`'s own entrypoint. |
| Picker writes | `SettingsManager` setters (`setExtensionPaths`, `setPackages`, `setProjectExtensionPaths`, `setProjectPackages`) then `flush()`; `ctx.reload()` after the screen closes when changes are pending. |
| Doctor tool | `pi.registerTool("run_doctor")`, read-only (`readOnlyHint: true`), `exposure: "direct"`, active by default, with a typed `outputSchema` mirroring `structuredContent`. Its `readOnlyHint` is what the shared default-deny policy in `lib/policy.ts` reads to allow it in plan mode. |
| Doctor probes | `run_doctor` and the screen share the session cache created by `registerDoctor`; `/bytefly refresh` and `refresh: true` re-probe. Probes spawn `<binary> --version`, lazily import optional packages, and read config files through `lib/requirements.ts`; nothing is ever written. |
| Status routing | Reads `footerData.getExtensionStatuses()` (a custom footer replaces the built-in one entirely); `worktree` routes to line 1, plan/alert statuses to line 2's trailing slot. |
| Config | `bytefly.json` from the agent directory and `<cwd>/.pi`; the `price` section is read once per footer install (a new session or a session-tree change), and the `notify` and `doctor` sections at `session_start`. Nothing watches the document. |
| Data sources | `footerData.getGitBranch()`, `footerData.getAvailableProviderCount()`, `ctx.getContextUsage()`, `ctx.sessionManager.getEntries()`, `ctx.sessionManager.getSessionName()`, `ctx.model`; subscribes to `footerData.onBranchChange` to repaint. |
| State storage | None besides the inert separator entries. The footer reads session entries and the price config (a memoized scan) and writes no tool-result `details`; it appends `bytefly-separator` entries excluded from LLM context. The screen derives its view from the picker runtime and the current reports and persists only through `settings.json`. Doctor's findings are session-scoped in memory only — cached for the session, never written to the session or a file. Notify holds only the config and the run-active flag in its closure. |
| Lifecycle | `session_start` installs the header and footer, points the doctor runtime at the session cwd, probes the extensions with hard requirements when `bytefly.json`'s `doctor.proactive` is on, and loads the notify config and subscribes to the job bus; `session_tree` reinstalls the header and footer; `session_shutdown` restores Pi's built-in header and footer, disposes the branch subscription, drops doctor's cached findings, and drops the notify bus subscription. |

## Design notes

- **The header is a nameplate, not a dashboard.** Pi's built-in brand colors are
  fixed, so the mark ignores the active theme; bytefly's header draws a two-tone
  mark from `accent`/`warning` and pairs it with the agent identity, the chrome
  identity, and a grouped help block. It adds no session or model data — that is
  the footer's job — and it stays a fixed four-plus rows so the startup
  transcript never reflows.
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

The surfaces are folders: `header/`, `footer/` (the status bar and its price
calculation), `separator/`, `panel/` (the unified screen and its merged model),
`picker/` (discovery and the settings store), `doctor/` (the `run_doctor` tool
and its probe runtime), and `notify/`.

| File | Responsibility |
|---|---|
| `index.ts` | Composition root: the disable guard and the six `register*` calls. |
| `header/config.ts` | Header tuning (`HEADER_CONFIG`): mark and identity tokens, padding, tagline, and the grouped help entries. |
| `header/component.ts` | `ByteflyHeader`: the mark, identity rows, rule, and grouped help, plus its factory. |
| `header/register.ts` | Installs/restores the header and owns its session lifecycle. |
| `footer/register.ts` | Installs/restores the footer and owns its session lifecycle. |
| `footer/config.ts` | Bar tuning (`CONFIG`): thresholds, gauge, separators, icons, status keys, labels. |
| `footer/types.ts` | `StatusSnapshot`, `Segment`, `LineSpec`, `UsageRecord`, and footer/TUI shapes. |
| `footer/collect/entries.ts` | Session entries → usage records, each resolved to the model in effect. |
| `footer/collect/snapshot.ts` | Snapshot assembly; memoized pricing scan per branch leaf. |
| `footer/price/types.ts` | `Currency`, `ModelRates`, `PeakWindow`/`PeakSchedule`, `ByteflyConfig`. |
| `footer/price/config.ts` | The `price` section of `bytefly.json`: schema, defaults, built-in DeepSeek rates/tariff, normalizer, loader. |
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
| `panel/types.ts` | `PanelRow` and `PanelModel`, the merged row model. |
| `panel/join.ts` | The item/report union with the unambiguous-name health rule and unique row keys, groups, and ordering. |
| `panel/format.ts` | Non-TUI text: the headline and the grouped listing with a per-row health suffix. |
| `panel/tui.ts` | `PanelComponent`, the unified dock screen. |
| `panel/commands.ts` | `/bytefly`, `/extensions`, and `/doctor`: one runner for the screen and its text modes. |
| `picker/types.ts` | Picker host seams (`SettingsStore`, `ExtensionResolver`, `Discovery`) and row types. |
| `picker/resources.ts` | Pure grouping, labels, display names, and pattern helpers. |
| `picker/toggle.ts` | Pure next-settings transforms for global and project toggles. |
| `picker/discovery.ts` | Host wiring: builds the global and effective views from Pi's managers. |
| `picker/runtime.ts` | Picker scope, live view copies, dirty tracking, and persistence. |
| `doctor/register.ts` | Registers `run_doctor` and the proactive session-start check; returns the runtime. |
| `doctor/runtime.ts` | Host seams, the session cache, and the two probe modes. |
| `doctor/tools.ts` | The `run_doctor` tool and its renderers. |
| `doctor/schema.ts` | Tool parameters and the structured output schema. |
| `doctor/config.ts` | `DEFAULT_CONFIG`, `normalizeConfig`, `loadConfig` for the `doctor` section of `bytefly.json`. |
| `doctor/format.ts` | Pure report text, summary, glyphs, detail lines, and the proactive warning sentence. |
| `notify/types.ts` | `NotifyConfig`, `NotifyMethod`, and the method list. |
| `notify/config.ts` | The `notify` section of `bytefly.json`: defaults, validation, loader. |
| `notify/dispatch.ts` | Method selection and delivery: OSC 777/99, Windows toast, `osascript`, `notify-send`, over injected seams. |
| `notify/format.ts` | Pure notification text: session label and the turn / input / job bodies. |
| `notify/register.ts` | Registers the three triggers, loads the config at `session_start`, and owns the job-bus subscription. |

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
register/append/render/disable lifecycle (`separator/register`). The picker
helpers are covered by the pure helpers (`picker/resources`), the toggle
transforms (`picker/toggle`), discovery with an injected factory
(`picker/discovery`), and the runtime state machine (`picker/runtime`). The
unified screen is covered by its pure model merge (`panel/join`), its text
formatter (`panel/format`), the screen's rendering and key handling
(`panel/tui`), and the command through the bytefly factory (`panel/commands`).
The doctor surface is covered by its pure report
formatting (`doctor/format`), its config loader (`doctor/config`), and
registration, the proactive warning, the session cache, and `run_doctor`
through the factory (`doctor/register`). The notify capability is covered by its section loader
(`notify/config`), the pure text builders (`notify/format`), method selection and
delivery over recording seams (`notify/dispatch`), and its three triggers,
reload, and shutdown through `registerNotify` (`notify/register`).
