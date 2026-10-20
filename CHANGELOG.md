# Changelog

All notable changes to this package are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `file-browse`: the sidebar tree gains a `fold all` / `expand all` control and
  a `-` shortcut, so a deep tree folds down to its top level in one keystroke.
  A path filter still shows every folder, so a folded branch cannot hide a
  match, and clearing the filter restores the tree exactly as it was.

- `file-browse`: rendered Markdown accepts a sanitized subset of raw HTML, so a
  README's `<details>`/`<summary>`, `<img>`, `<kbd>`, and hand-written tables
  display instead of showing as source. Only allowlisted elements and
  attributes are re-emitted (no `script`, `style`, `svg`, event handlers,
  `style=`, or `class=`), open elements are balanced so a stray tag cannot
  swallow the page, and `markdownHtml: false` restores escape-only rendering.

- docs: [`docs/user-guide.md`](./docs/user-guide.md) is a single end-user guide —
  every extension, plus settings, WeChat, and the terminal chrome, each with a
  plain-language overview and a numbered walkthrough of keys and commands.

### Changed

- docs: the configuration page absorbs the key reference. It opens with the two
  scopes and the merge order, the settings screen, and a "what people usually
  change" table, then carries every section and key the loaders accept with their
  defaults. `docs/references/bytefly-config.md` is gone, and
  `test/config-docs.test.ts` reads the one page.

- docs: the user guide teaches the keys that interrupt, clear, expand, and leave
  (`Esc`, `Ctrl+C`, `Ctrl+O`, `Ctrl+D`), names the `/bytefly settings` rows instead
  of raw config keys, states that only DeepSeek's rates are built in, and covers an
  expired WeChat login and a busy browser port in troubleshooting.

- docs: the root `SECURITY.md` is removed. Its supported-version rule, private
  reporting route, and what a report includes now live in `docs/security.md`, which
  already owned the trust boundaries.

- docs: the user guide opens with a five-minute tour and a per-feature index, and
  its contents are grouped into five lines. It gains a glossary (including prompt,
  turn, and model), a section on cost and what leaves the machine, and screenshots
  through the guide — the transcript frame included. Two surprises are named
  where they bite: a deleted memory note has no undo, and a busy browser port is
  reported rather than re-picked.

- dev: `bun run screenshots` gains a `transcript` screen and `assets/transcript.png`,
  drawn from `renderTranscript()` so the frame carries no version string.

- docs: [`docs/architecture.md`](./docs/architecture.md) is redesigned for a
  contributor: five diagrams (the load path, an extension's anatomy, a turn, the
  process shapes, and where new code belongs), the state stores, the three ways
  extensions cooperate, and a reading tour. It explains the reasons and links the
  normative docs instead of restating them.

- docs: `docs/extensions.md` is removed. The grouped catalog in `README.md` is the
  one surface list, and each `extensions/<name>/README.md` still carries the full
  tool, command, and design detail. The two tests that read the catalog go with
  it, so commands and flags are no longer checked against the docs; the tool
  names stay pinned in `test/naming.test.ts`.

- docs: `docs/getting-started.md` is folded into the user guide and removed. The
  install routes (including the `@vX.Y.Z` pin), the fit decision, the
  prerequisites, what an install changes, and removal now live in
  [`docs/user-guide.md`](./docs/user-guide.md), which the entry READMEs and the
  docs index link to; the footprint guard and the install-pin guard read the
  guide instead.

- `plan`: the injected plan-mode context states each rule once — the shell rule no
  longer repeats the read-only summary, and the delegation bullet leaves "forced
  read-only" to the line that already carries it — so a planning turn's always-on
  context is about 110 characters smaller and its budget ceiling drops from 1100
  to 960.

- `bytefly`: the footer prices a growing session in bounded time. The rate table
  is compiled once per config instead of being re-split for every record on every
  appended entry, the lookup remembers the model it just matched, the context
  estimate and session name join the pricing scan in the leaf-keyed memo, and a
  turn separator reuses its line instead of rebuilding the full-width rule each
  frame. A 3,000-record branch with a 100-key `rates` table cost about 200 ms per
  new message before; it now costs fractions of a millisecond.

- `bytefly`: the Settings JSON pane no longer reopens when the focus returns to
  a row after moving to a Global-only row (Theme, startup TUI, output pad,
  hardware cursor); closing it takes a `J`, as the key's own hint says.

- `bytefly`: the proactive doctor check no longer holds the first prompt. Its
  hard-requirement probes are fired after `session_start` returns, and
  `run_doctor` and the panel's refresh probe a few extensions at a time instead
  of one after another, so both answer in the slowest probe's time rather than
  their sum.

- dev: `bun run bench:render` also measures one re-price of a branch's usage
  records — 500, 3,000, and 10,000 records, plus 3,000 against a 100-key rate
  table — with a determinism gate in the suite.

### Fixed

- `plan`: ticking a step with `set_plan_steps` also ticks the todo item approval
  seeded from it. Before, only the plan file changed, so the todo widget and the
  goal's open-item check kept reporting work the plan said was done. The match is
  on the step's text, so a renamed item is left alone and reported, and the file
  stays authoritative when the nested write fails.

- `plan`: `set_plan_steps` requires each update's `expected` step text. The
  stale-step guard was opt-in, so an update that omitted it could tick the step
  that moved into that number after an edit; a missing `expected` is now refused
  by the tool's schema instead of silently skipping the check.

- `goal`: `/goal done` names the todo items the list still has open, in the same
  words the tool's result uses, so completing the *what* from the command cannot
  silently leave the *how* unfinished.

- `goal`: `/goal` argument completions match any case, as the parser already
  did, so `/goal S` offers `set` instead of nothing.

- `goal`: the `/goal <prompt>` confirm step no longer records its answer notes
  into the objective. The `Also: <question> → <answer>` lines sit below a
  `--- notes (not saved) ---` sentinel that is cut on save, so the default Enter
  records the restatement alone; folding an answer into the sentence above the
  line keeps it.

- `bytefly`: a value pasted into a Settings text row is stored as typed. The
  terminal's bracketed-paste markers are stripped first, so a pasted
  notification title no longer lands in `bytefly.json` as `[200~…[201~`.

- `bytefly`: a rate key may name a model id that contains a slash, so an
  OpenRouter model can be priced exactly by
  `openrouter/anthropic/claude-fable-5` instead of only through `openrouter/*`.
  A key splits at its first slash; the model segment keeps the rest.

- `bytefly`: changing the footer currency writes the code and its default
  precision in one document pass, so a write that cannot finish leaves neither
  value behind instead of half-applying the row.

- `bytefly`: a background update check that cannot run is no longer cached as
  "everything is current" for 24 hours. It leaves the previous snapshot and the
  header marker alone, and `/bytefly update` reports `could not check package
  updates` instead of `up to date`.

## [0.15.0] - 2026-10-20

### Added

- `bytefly`: the Settings screen now has a **Theme** row that lists `system`
  first, then the two palettes this package ships, `bytefly-dark` and
  `bytefly-light`. It writes Pi's personal `theme` setting and applies after
  reload; Pi's built-ins, other packages' themes, and automatic light/dark pairs
  stay in Pi's `/settings`.

### Changed

- `bytefly`: the update surface now uses Pi's package manager as its only
  detector. bytefly suppresses Pi's `Package Updates Available` block and posts
  one themed notice listing every updateable configured package plus
  `pi update --extensions`; the header marker still shows only this package's new
  version, and the version arrow and release URL remain. The 24-hour cache now
  stores a project-scoped snapshot keyed by cwd and package sources, and
  `/bytefly update` re-runs the check on demand. Unmanaged installs such as
  `pi -e .` no longer get an update prompt.

- `bytefly`: the footer's group divider is a hardcoded `│` instead of the shared
  `╎`, so the status line reads as a divider while the transcript rail and
  `chrome.rail`'s default keep the dashed glyph.

### Fixed

- `bytefly`, `plan`: the plan-mode chip uses `≡` instead of the vertical
  ellipsis `⋮`, which read as a menu affordance rather than the open planning
  artifact; the footer, the plan README, and the glyph vocabulary agree.

- `bytefly`: Windows toast notifications select the text node through
  `$nodes.Item(0)` instead of indexing the live WinRT node list with `[0]`,
  which PowerShell 5.1 rejects with `BadEnumeration`. Delivery remains
  best-effort and silent on failure.
- `bytefly`: the Settings screen keeps the focused setting when `Tab` switches
  scope, names a Project default as `Default` instead of `Inherited from Global`,
  and points an inherited value at the personal file rather than the project one.
- `bytefly`: `u` on an inherited Project value says it is inherited instead of
  claiming it is already at its default.
- `bytefly`: the panel's scroll range counts selectable rows, so a clipped
  Settings list reads its row count, not the entry count including group
  headings.
- `bytefly`: the JSON pane keeps the `Saved · reload to apply` marker, reports the
  correct hidden-line count, and no longer advertises `J hide` on a Pi setting.
- `bytefly`: clicking below the last body row no longer selects an off-screen row,
  and a short terminal drops the range, project note, or detail pane instead of
  overflowing the viewport.
- `bytefly`: editing a long value scrolls the value to keep the caret visible and
  leaves the row label in place on a narrow terminal.

## [0.14.0] - 2026-10-19

### Added

- `bytefly`: `/bytefly settings` now covers the package's other extensions —
  `worktree`, `rewind`, `job`, `watch`, `memory`, and `goal` — so twelve more
  preferences (base ref, branch prefix, prune age, snapshot retention, wake on
  finish, note injection, and so on) are editable without hand-editing
  `bytefly.json`. The list is now twenty-eight rows in ten groups: `u` deletes a
  row's key so its default applies again, `J` shows the focused row's whole
  section as stored — the only view of `rates`, `peak`, and the list-valued keys
  — and `[` / `]` jump between groups.

- `bytefly`: the working row now becomes a live run line — the latest top-level
  tool, how many tools the run has started, and the elapsed time
  (`edit · 3 tools · 12s`) — instead of only a clock. It falls back to
  `Working… 12s` until the first tool starts, nested calls neither count nor
  take over the line (so the number matches the transcript's tool blocks), and a
  retry starts a fresh count.

- `bytefly`: the turn separator is now a receipt for the settled run — duration,
  top-level tool count, and `✕N`/`aborted` when a tool failed or the user
  stopped — with a width ladder that sheds the tool count, then the duration,
  then the outcome as the line narrows. A clean turn stays `meta`, a failed one
  paints `bad`, and an aborted one `warn`; a run under a second prints no
  duration, and separators written before the receipt existed keep rendering as
  `turn N`.

- `subagent`: a child run now has a wall-clock deadline
  (`subagent.timeoutMs`, ten minutes by default, `0` disables it). A run past it
  is stopped the way an abort stops one, but reported as a failed run —
  `Timed out after …` — so a chain stops at that step instead of waiting
  forever.

- `subagent`: opt-in per-run transcripts (`subagent.transcripts`: `off`,
  `failed`, or `all`; off by default) under `.pi/subagents/`, written by the
  dispatching process and pruned at session start by age (`retentionDays`, 14)
  and count (`maxRuns`, 100). The child never learns one exists, so the read-only
  tool set is unchanged.

- `dev`: two new guards hold the documented numbers to the code — a settings
  catalogue test checks every row's default and bounds against its loader in both
  directions, and a getting-started test derives the pack's extension and tool
  counts from what registers.

- `plan`: the terminal review screen has its own screenshot, `assets/plan.png`,
  drawn by `PlanViewComponent` and regenerated with `bun run screenshots plan`.
  The capture script can now give a screen its own window bounds and frame size,
  so a document-sized surface is not shot through a 20-row viewport and the
  render no longer races the window resize.

- `docs,test`: four more extension screens now have captures — `/watch`,
  `/memory`, `/bytefly`, and `/wechat` — each drawn by its shipped component,
  embedded in its extension README and the catalog, and regenerated with
  `bun run screenshots <name>`. A new `scripts/screenshots.test.ts` renders every
  frame at three widths and fails when a fixture drifts out of the terminal or a
  fixed-size frame grows taller than its window.

- `docs,test`: `assets/file-browse.png` is regenerable at last — `bun run
  screenshot:file-browse` serves a generated fixture project through the shipped
  server, so the capture names no real checkout, and `--root` points it at a
  directory of your own. Both browser shots now set their theme through the
  page's toggle, and the shared Chrome capture waits for the requested document
  and fails on a page-expression error instead of silently shooting a page its
  steps never touched.

### Changed

- `docs`: the README's "Why this pack" promises now match what ships. "Never
  wreck the checkout" says isolation is one command rather than describing the
  worktree as the default, "Delegate and parallelize" covers background `job`s
  and `watch`ers, and "Reach the web and your files" names the WeChat bridge.
  The Chinese README mirrors each bullet.

- `bytefly`: the startup header now sheds by terminal height as well as width.
  Below 28 rows the middle help group is dropped, below 22 only the `/` commands
  row remains, and below 16 the help block and its leading blank row go, leaving
  the nameplate and rule. A short pane therefore spends its rows on the
  transcript instead of chrome, and an unknown height keeps the full header.

- `themes`: `customMessageBg` now resolves to the terminal default and
  `customMessageLabel` to the accent, so Pi's `/compact` summary, branch
  summaries, and skill blocks sit on the canvas instead of inside a filled
  purple band.

- `docs`: getting started is now a page that ends in a
  decision. It opens with what the pack is for and the conditions on each side of
  the fit question, then a trial with `pi -e .` that writes nothing, install,
  verification, the first three workflows, how to turn parts off, and how to
  remove it. It also states what install changes in the terminal — the chrome is
  always on, the startup header is opt-in, twenty-one tools join the model's
  surface, and at most one npm request per interactive session checks for a newer
  release. The catalog is unchanged.

- `docs`: the entry READMEs no longer repeat the install matrix. Each keeps the npm
  command and points at getting started for git, a
  pinned release, a project-local install, and a trial that writes nothing, so
  the copy-paste options have one home; the `@vX.Y.Z` pin now lives on that page
  alone, and the release steps in [`docs/development.md`](./docs/development.md)
  say so.

## [0.13.1] - 2026-10-18

### Added

- `bytefly`: the built-in DeepSeek rate tables now carry the day they were last
  checked against the published tariff, and `run_doctor` reports how old that is —
  `ok` inside a 90-day window, `degraded` beyond it with the source URL to re-check.
  A re-pricing therefore becomes a visible warning instead of a quietly wrong cost
  total. The date records 2026-10-18, when the tables were checked against
  DeepSeek's published USD figures and peak schedule; the figures themselves are
  unchanged.

- docs: `ROADMAP.md` is re-derived from the tree: the three ranked items are now
  the `Now` bucket instead of being split across `Now` and `Later`, `C1` is scoped
  to a tariff a table can express so it cannot undercut Pi's recorded cost, the
  `Now` exit condition no longer asks for router coverage that already landed, the
  ledger column is *Open items* rather than a second meaning of `Next`, and every
  limitation the "thin" sections name now has a row in *Deliberately left thin*
  (plan display cap, plan index, subagent cost, `watch` notifications,
  `skipOverrides`, rewind's TUI-only checklist, `memory` truncation, keyless search,
  JSON-only settings, the update cache window) with the OCR row dropped because
  `W6` covers it. The 1.0 gate no longer claims a truth test enforces that triage.

- dev: the browse and plan-review pages are covered through their pure routers and
  rendered HTML, with no browser: a failing `git` diff provider now proves it
  degrades to a page without change markers (and 404 for a single file) instead of
  a 500, a malformed request target answers 400 on both routers, the too-large and
  binary file pages are rendered, and a diff's context lines are asserted to take
  part in the syntax-highlight pairing. `file-browse/html.ts` and
  `plan/web-router.ts` are at 100% lines with those paths reached; the socket
  handlers and the review session's abort cleanup stay out, since they need a real
  connection rather than a router.

- `bytefly`: `price.budget` puts a session budget under the footer's cost total, in
  the selected currency. The first turn that pushes the session's spend to it posts
  one `bytefly · Session budget reached` notice naming the figures and, when notify
  is enabled, one OS notification — through the same capability the run, job, and
  watcher triggers use. It is an alert, not a limit: nothing is blocked or aborted,
  it fires once per session, and `0` (the default) leaves it off. The check reads
  the total the footer already priced, and **Session budget** joins the control
  center's Pricing rows (sixteen preferences now).

### Fixed

- worktree: the `enter_worktree` offer to ignore the managed directory asks git
  (`git check-ignore`) instead of string-matching `.gitignore`, so a repository
  whose wider rule already covers it (`.pi/`) no longer gets a prompt claiming the
  directory "is not ignored". The offer is also re-armed on `session_start`, so it
  is once per session rather than once per process.

- `watch`: `enabled: false` in the `watch` config section now refuses `add` with
  "watch is disabled."; the key was documented but never read.

- `watch`: `add` refuses a path that is not a regular file, and a file that
  vanishes or changes type between a stat and a read is skipped for that tick
  instead of throwing out of the poll timer and taking the session down.

- `watch`: stopping a command watcher, or ending the session with one running,
  now escalates SIGTERM to SIGKILL after a 2 s grace, so a command that ignores
  SIGTERM no longer outlives the session.

- `watch`: the `/watch` screen refreshes from live state without calling the
  runtime's poll tick, so opening it no longer changes the configured `pollMs`
  cadence.

## [0.13.0] - 2026-10-18

### Added

- `worktree`: `exit_worktree` ends with a `Handoff:` block naming the branch, its
  commits beyond the merge target, whether that target contains them, and the
  command that finishes the task. It still never commits, merges, or pushes.

- `watch` / `bytefly`: a `wake` watcher that matches while the agent is idle now
  also raises a desktop notification through bytefly's notify capability, gated by
  `notify.matchFound` (on by default). A busy match still waits for the next turn.

- `rewind`: a code rewind can restore **some** paths instead of the whole tree —
  `Everything (N files)` or a `Choose paths…` checklist marked `M`/`D`/`A`, all
  selected, written through the same temporary index and safety snapshot.

- `bytefly`: Settings covers every scalar in `bytefly.json`, including the three
  announce toggles, **Probe timeout** (`doctor.timeoutMs`), and **Rail glyph**,
  which now refuses a two-column or control-character glyph with a reason.

- ci: `test/structure.test.ts`, `test/naming.test.ts`, `test/docs-truth.test.ts`,
  and `test/docs-parity.test.ts` now hold every doc link and anchor, the catalog,
  and both entry READMEs to the registered surface. The drift they found is fixed.

- docs: `getting-started.md` explains how to start a custom theme from the shipped
  JSON, and the entry READMEs and catalog no longer state counts that drift.

- ci: npm publishing moved into the repository. A `publish.yml` dispatch names the
  version twice, waits for the `npm` environment review, then publishes the tag
  with `--provenance` — no stored token, and a signed attestation per tarball.

- `worktree`: the Windows `powershell` tool is refused while isolated, because it
  was never re-rooted and its grammar is not what the bash guard reads.
  `worktree.guard.blockPowershell` turns the refusal off and reports the trade.

- `bytefly`: the published-version check caches its answer for 24 hours, and the
  new `/bytefly update` re-runs it on demand — reporting the newest version, an
  available release, an offline skip, or an unreadable registry.

- `web-access` / `bytefly`: `run_doctor` now reports what `web_search` resolved
  to — the provider, why it won, and the key's variable name when one is needed,
  never the key. A SearXNG endpoint is probed only on an explicit refresh.

- `plan`: approval carries the plan's `## Verification` section into the todo list
  as a final `Verify: …` item, so the definition of done travels with the work. It
  never counts against the 50-step cap, and `set_plan_steps` numbering is unchanged.

- `subagent` / `bytefly`: the footer shows delegated runs as their own
  `↳ 3 · ¥0.12` roll-up, priced from the same rate table and covering the last 500
  runs. The session total is never restated or folded in.

- `plan`: an active session goal is restated in the injected planning context, and
  approving a plan with no goal offers to record its title as one — never replacing
  an existing goal, and with no extra model call.

- `memory`: `p` in the `/memory` picker moves a note to the other scope, writing
  the destination before removing the source, so a failed second write leaves a
  duplicate (which `m` merges) rather than losing the note.

- `plan`: `/plan list` walks `.pi/plans` and shows each plan's title, modified
  time, and step progress, newest first — a docked list whose `Enter` opens the
  review, and a notice with every path in other modes.

- `document`: the legacy `.doc` path is covered end to end by a committed Word 97
  fixture, so its OLE branch is tested for success and not only for its error.

- dev: `bun run bench:render` measures 500 and 2000 tool blocks at 80 and 120
  columns — lines, median and p95 frame time, heap per frame, and render-memo hits.
  Its determinism half runs in the suite.

- ci: a `compat` job installs the newest published Pi peers, runs typecheck and the
  serial suite, and records the resolved versions; `test/extension-load.test.ts`
  loads every manifest entry, so a host change that breaks loading fails on any OS.

- `memory`: `/memory doctor` reports store health — note counts, bytes, how much of
  `maxInjectBytes` the injection uses and which scope it omits, and the
  near-duplicate pairs the comparison key treats as one fact. `m` merges a pair.

- `worktree`: `/worktree status` and `list_worktrees` name what isolation does not
  cover — your own `!` shell, Windows `powershell`, and shell commands the guard
  cannot verify, counting how many passed through this session.

### Changed

- docs: the changelog holds one subsection set per release window; the duplicated
  `0.11.1` and misordered `0.5.1` windows are merged and reordered, and
  `test/release.test.ts` fails a repeated or empty subsection.

- `themes`: `test/theme.test.ts` measures WCAG AA per semantic role at the layer
  the package paints with, which found dark `dim` at 4.12; it moves from `#6e7681`
  to `#7d8590`, and the galleries and the `chrome.png` hero are regenerated.

- `job`: `detached: true` is refused on Windows instead of starting a job that
  silently did not detach. `job.detachedByDefault` is inert there rather than
  failing every start with a config set elsewhere; `doctor` names both.

- docs: the configuration reference is `docs/references/bytefly-config.md`, since
  the old path repeated "configuration...reference" and read as a sibling of
  `docs/configuration.md`; it now opens with a contents list held to every section.

- docs: the entry READMEs read as a front door again — a two-sentence bytefly
  cell, themes in their own section, Requirements folded into Quick start, and the
  once-per-session version request disclosed next to the install steps.

- docs: the `@vX.Y.Z` install pins in the two entry READMEs and
  `docs/getting-started.md` name the released version again, and
  `test/release.test.ts` now checks every pin against `package.json`.

- packaging: `files` no longer ships `assets/**`, so an install drops from 7.4 MB
  to 2.3 MB unpacked. Nothing reads the screenshots at runtime, and the README's
  image links still resolve on GitHub.

- `document`: extraction has a per-call deadline, `document.extractTimeoutMs`
  (30 s, clamped 1 s – 5 min). A parser that outlasts it is abandoned and the read
  fails with the limit named; one that never yields still cannot be preempted.

- `plan`: `write_plan` and `exit_plan_mode` refuse more than the 50 steps approval
  tracks, naming the count, the cap, and the fix, instead of writing a plan and
  silently dropping every step past 50 at approval.

- `plan`: the review baseline is a `plan-baseline` session entry of per-section
  digests rather than text in runtime memory, so a resumed session or a `/tree`
  restore keeps its changed-section markers.

- `web-access`: independent `web_fetch` calls run in parallel again — its page
  cache only does synchronous map work, so serialising them only delayed the URLs
  the model asked for in one turn. `web_search` keeps its sequential mode.

- `web-access`: paging and `find` no longer expand a page into an array of
  one-character strings; `charLength` walks in place and `sliceChars` cuts by
  offset.

- `web-access`: `web_fetch`'s `find` passages now count against the `maxChars`
  budget, and the result says whether `maxMatches` or the budget hid the rest.

### Fixed

- `worktree`: the `Handoff:` block an exit prints counted the branch's commits
  against the base commit recorded when the worktree was entered, so a branch cut
  from `origin/main` and then rebased onto a newer local `main` reported every
  commit the base had gained as its own ("18 commits ahead"). It now counts against
  the resolved base branch (local first, then `origin/<branch>`), and every lookup
  runs in the main checkout so the count still works after the worktree is removed.

- `worktree`: a redirect to `/dev/null` is no longer refused as an escape. A target
  that discards its stream escapes nothing; every other device path is still
  refused, and `2>/dev/null` inside `bash` works again.

- `plan`: a restored review baseline is looked up by a canonical plan path, so its
  changed-section markers survive on Windows and on a branch that recorded the same
  plan under another spelling.

- `rewind`: `before_agent_start` narrows the host's event union instead of reading
  `prompt` off it, so the package typechecks against Pi 1.3, where a wake is its
  own event, while a user run still records its prompt summary.

- `web-access`: `web_fetch` decodes by byte-order mark, declared charset, or the
  page's own `<meta charset>`, falling back to UTF-8 — a GBK page used to arrive as
  replacement characters.

- `web-access`: `maxBytes` is enforced while the body streams in, so a chunked or
  gzip-compressed response is no longer fully materialised before its size is
  checked.

- `plan`: the review sidebar scrolls again when its outline is taller than the
  window; a details' content wrapper had no definite height, so the panel kept its
  content height and the sidebar only clipped it.

- `file-browse`: a long file tree scrolls in its own pane under the pinned
  quick-open trigger and filter, sharing one breakpoint with the narrow-screen
  disclosure so no width falls between them.

- `file-browse`: a page render resolves its path once and takes the change totals
  from the `--stat` pass, so navigating no longer repeats the `stat` or spawns an
  extra git process.

## [0.12.0] - 2026-10-18

### Added

- docs: [`ROADMAP.md`](./ROADMAP.md) records the next work, grouped by the
  README's promises, with the evidence behind each item; the README and docs
  index link to it.
- `bytefly`: the footer prices in CNY or USD, chosen by `price.currency.code` and
  by the **Currency** row in `/bytefly settings`. The code picks the rate table
  too: CNY prices matched models from the yuan `rates`, USD from a built-in table
  of DeepSeek's published dollars (cache-hit `$0.006`/`$0.044`, cache-miss
  `$0.30`/`$1.32`, output `$1.20`/`$3.96` per million at peak, half off-peak),
  and the peak schedule applies in both. A model with no matching rate shows no
  cost in CNY mode and falls back to Pi's recorded dollars in USD mode, so the
  footer always prints one figure in one currency. `currency.decimals` sets the
  precision.
- `bytefly`: the `/bytefly settings` catalogue grows from five rows to ten across
  six groups, adding the notification delivery method and title, the proactive
  health check, the currency switch, and cost precision; a `bytefly.json` row can
  now edit a nested leaf such as `price.currency.decimals` without disturbing its
  siblings.
- `bytefly`: text settings are editable on the `/bytefly settings` screen. A text
  row opens an inline editor with a caret (`←`/`→`, `Home`/`End`, `Backspace`,
  `Ctrl+U`), `Enter` saves, and `Esc` cancels without touching the file; a value
  that breaks the row's rule keeps the editor open and says why. The
  `notify.title` row uses it, so it stops being JSON-only.
- `bytefly`: `doctor` reports an explicit `notify.method` this host cannot
  deliver — a platform notifier on another platform, or an OSC method with no
  terminal — as a `degraded` finding on `bytefly`, with the fix in its hint. A
  method that suits the host, `auto`, and a disabled capability all stay `ok`.
- `bytefly`: once per interactive session, the loaded version is compared in the
  background with the published `@gavin-hu/my-pi-agent` on npm. A newer one adds
  `↑0.12.0` to the header's chrome version and posts one transcript notice
  naming `pi update --extensions`; `PI_OFFLINE` skips the check and a failed
  request is silent.
- `bytefly`: `x` clears the focused extension's project override in the control
  center's Project scope, dropping the `+`/`-` entry a toggle wrote (and the
  path or package entry beside it) so the row returns to its inherited state
  without a `pi config` round-trip.
- `bytefly`: `bytefly.json` is documented in
  `docs/references/bytefly-config.md`, one table per section with each key's type, default, and bounds. It replaces
  `assets/bytefly.schema.json`, so editor completion for the file goes with it —
  delete a `$schema` line that points at that URL — and `config:migrate` no
  longer stamps `$schema`.

### Changed

- docs: [`ROADMAP.md`](./ROADMAP.md) is re-derived from the tree rather than the
  last tag. Items that had already shipped are gone, the step-budget gap is
  named, `Now` and `Next` hold at most ten items each, and a new *Deliberately
  left thin* table says why the remaining documented limitations have no item.
- docs: the configuration reference moved into `docs/references/`, so the
  exhaustive listings sit in their own directory; every guide and README link
  points at the new path.
- `bytefly`: the `Currency symbol` setting and its `currency.symbol` key are gone,
  and so is the `fallbackToRecordedCost` toggle. The symbol follows
  `currency.code` (`CNY` → `¥`, `USD` → `$`), so the two cannot disagree, and the
  fallback is now implied by the mode instead of configured. `currency.decimals`
  still controls precision.
- `goal`: `/goal <prompt>` no longer makes a second model call to rewrite the
  goal from the answers to its questions. The answers arrive in the confirm/edit
  dialog as `Also: <question> → <answer>` notes under the restatement, so the
  user folds them in, deletes them, or corrects the sentence, and the recorded
  goal holds their own words one model round-trip cheaper. `/goal set`, `/goal
  edit`, and `/goal raw` are unchanged.
- `goal`: `/goal help` names the `achieved` and `-h` / `--help` aliases. The
  parser, the completions, and the help text now come from one `GOAL_VERBS`
  table, so a reserved word cannot be added without being completed and
  documented.
- `goal`: marking a goal achieved while the todo list still has open items now
  says so in the tool result (`3 todo items are still open; close or clear the
  list if that work is done.`), so the model closes the how before it calls the
  what done. The list is replayed from the branch through a shared
  `lib/todo-state.ts` that plan's approval-time merge now uses too; the goal's
  `details`, `structuredContent`, and transcript rendering are unchanged.
- `bytefly`: the footer no longer sums a fallback record's dollars into the
  configured currency. A model with no matching rate shows Pi's recorded amount
  as its own `$` figure beside the rated total (`¥2.50 + $0.31`), so a session
  that mixes a priced provider with an unpriced one cannot print a total in the
  wrong unit.
- `todo`: the lag reminder also covers work that never got a list. A run that
  settles after three successful mutating calls with an empty list is asked to
  record one, provided at least one of them can change files, so three read-only
  shell commands no longer count as work that needed a plan. A list the model
  wrote or cleared in the same turn is left alone, and a single call still never
  triggers a reminder.
- `plan`: the documented plan outline now asks for file-anchored, verifiable
  steps and states the goal's non-goals; the outline test pins the section
  order.
- `file-open`: a launcher that refuses a target is now reported on macOS and
  Linux — a non-zero exit from `open` / `xdg-open` becomes a `Could not open`
  notice instead of silence — and `/open` says `Opening <path>` first so the two
  notices do not contradict each other. Windows opens through `explorer` instead
  of `cmd /c start`, so `cmd` no longer expands `%NAME%` in a path; `explorer`'s
  exit status stays untrusted, and that gap is documented.

### Fixed

- `bytefly`: the README no longer states the rail-glyph limitation twice, its
  Settings table is one table again, and the Currency row and price section both
  say what `USD` mode prices — the published dollar table, with Pi's recorded
  dollars only for a model that table does not list — instead of the recorded
  total it replaced.
- docs: the `wechat` README no longer says there is no pause, and the Chinese
  README's `bytefly` row names ten settings across six groups like the English
  one.
- `goal`: the README now says that `/goal set <prompt>` and
  `/goal edit <prompt>` replace an active goal without the confirmation
  `/goal <prompt>` asks for.
- `plan`: an aborted turn now closes the browser review. `exit_plan_mode`
  forwards the call's abort signal to the review server, so aborting returns
  "not approved" instead of leaving the tool waiting on a page nobody can
  answer, which is what the README already promised.
- `plan`: an approval that came from the browser carries its comments in the
  tool result's `details.annotations`, not only in the result text, so the
  review an approval was conditioned on survives with the result.
- `plan`: `/plan review` no longer consumes the changed-section baseline when
  the review server fails to start, and a resumed or tree-restored session
  starts without one, so the markers match what the docs promise.
- `plan`: a wrapped task step keeps its continuation indent. The review screen
  draws `◻` in place of `[ ]`, and pi-tui indents a wrapped line from the marker
  it was given, so the two freed columns are padded back instead of shifting the
  rest of the item to the body margin.
- `plan`: reloading the browser review no longer cancels it. The page sent a
  cancel on unload, so F5 and the **Reload** a save conflict offers both closed
  the server under the reloaded page; a closed tab is still detected, by the
  event stream dropping.
- `plan`: a plan link is rendered only for an http(s) or mailto target, resolved
  against the review page. A target that is cross-origin only after the URL
  parser strips a tab or newline (`/\t/evil.com`) stays text instead of becoming
  a link.
- `plan`: a plan containing a tab is no longer reported as changed on every
  review. The review diffs its baseline against the sanitized body, so it now
  normalizes both sides the same way.
- `plan`: two sections with the same title are marked and counted separately, so
  editing the second `## Notes` no longer lights up both in the review screen
  and the browser outline.
- `plan`: a heading keeps a trailing hash that is part of its text (`## C#`),
  and only a closing run separated by a space (`## Notes ##`) is stripped. The
  heading rule is now shared by the review screen and the browser outline.
- `plan`: a tab-indented code fence is prose for both parsers, so the review
  screen and the browser no longer disagree about where a section or a step
  starts, which had shifted every browser comment anchor after such a fence.
- `plan`: the browser review page can no longer be framed. Its CSP adds
  `frame-ancestors 'none'`, `base-uri 'self'`, and `form-action 'none'`, and it
  sends `X-Frame-Options: DENY`, so a local page cannot clickjack
  **Approve & run** — the one control with a side effect.
- `plan`: an oversized feedback body now gets a JSON `413` through the same
  header envelope as every other reply instead of having its socket destroyed
  under it, and a reply the client walks away from can no longer leave the
  review waiting.
- `plan`: the review page takes its comment and quote caps from the server via
  the data island (so the comment length is enforced while typing), submits a
  comment only after an IME composition ends, keeps its active block highlighted
  after a re-render, and shows the server's own reason when a save is rejected.
- `bytefly`: the startup header opens with a blank row again. Pi mounts its
  built-in header inside spacers but keeps none for the `quietStartup: true`
  header a custom component replaces, so the nameplate now draws its own
  leading blank instead of sitting flush against the top edge.
- `web-access`: the README's sample document shows the real default for
  `search.endpoint` (`""`, not a localhost URL).
- `wechat`: the README's sample document no longer shows `pollHoldMs: 0` as a
  default; the setting is unset by default and anything below `1000` clears it.

## [0.11.4] - 2026-10-18

### Added

- `wechat`: `/wechat pause` stops polling while keeping the account and peer
  sessions: a running turn may finish and reply, a waiting prompt is withdrawn,
  and the poller lock is released. `/wechat resume` reacquires the lock and
  polls again, reporting when another runtime already holds it. `p` toggles the
  same action on the control screen, the chip shows `wechat paused`, and
  `/wechat doctor` names the paused state. Pause is per runtime, so a reload or
  restart resumes polling.

## [0.11.3] - 2026-10-18

### Added

- `wechat`: `/wechat doctor` prints a read-only health report: connection and
  token age, last poll and how long it held, the lock holder, per-peer session
  and queue state, and recent poll/send failures.
- `wechat`: the control screen is operable in place: `j`/`k` focus a peer, `s`
  stops its turn, `d` starts a fresh conversation, and `h` opens
  `/wechat history <peer> [n]` for that peer's recent messages.
- `wechat`: the control screen can allow a refused sender with `a`, and
  `/wechat allow [peer]` does the same from the command. It confirms against the
  sender and the exact file, appends one entry to `wechat.allowedPeers` in the
  project `.pi/bytefly.json` without touching sibling keys, and says that a
  `/reload` or restart applies it. A malformed config is reported, never
  overwritten.
- `wechat`: the waiting prompt now shows its peer, question, and age, and `c` on
  the control screen withdraws it: the peer is told once and the model receives
  `cancelled`.

### Fixed

- `wechat`: the `/wechat` control screen no longer crashes the host with
  `this.focused is not a function`. The host duck-types a focusable component
  with `"focused" in component` and writes a boolean there, which shadowed the
  screen's private `focused` method; it is now `focusedPeer`.

## [0.11.2] - 2026-10-18

### Fixed

- `wechat`: the refused-sender and dropped-media counters reset when the bridge
  reopens, matching the "since the bridge opened" wording in `/wechat status`.
- `wechat`: `send_wechat` now goes through the same delivery path as a reply, so
  assistant Markdown is flattened and a split message is numbered. A rejection
  that carries `ret: 0` plus a real `errcode` reports that code instead of
  `ret 0`, and a partial failure names how many parts went out.

## [0.11.1] - 2026-10-18

### Added

- `wechat`: the `/wechat` control screen now focuses peer rows with `j`/`k`
  (or the arrows) and stops (`s`), resets (`d`), or opens the focused peer's
  recent messages (`h`) without leaving the console; `/wechat history <peer> [n]`
  prints the same read-only history from the command line.
- `wechat`: `/wechat doctor` prints a read-only health report — connection and
  token age, the last poll and hold, the poller lock, per-peer session/queue
  age, and the last send/poll failure — from the same status facts the control
  screen reads.
- `wechat`: `/wechat stop <peer>` and `/wechat reset <peer>` act on one peer
  from the terminal, by id or label; a refused sender is also named once in a
  terminal notice, so a new sender can be allowlisted without opening the
  control screen.
- `wechat`: an admitted peer can be narrowed to a tool allowlist with
  `peers[<id>].tools` (an empty list leaves none), and `maxTurnsPerHour` caps a
  peer's turns in a rolling hour with one notice when it is reached. Both are
  opt-in; with no config the owner keeps the full toolset, and the hourly cap is
  in memory, so a reload starts a fresh window.
- `wechat`: a remote plan review now offers **Send the full plan** alongside the
  choices; it posts the plan's text and asks again, so the whole plan is
  readable even when the file bubble is never opened.
- `wechat`: `/history [n]` answers with the last messages of the sender's own
  conversation (default 8, at most 20), read from its newest session without
  resuming or writing it. A turn that compacts its context now says so once
  after the answer (`上下文较长，已压缩…` / “The conversation was compacted…”), so
  a peer knows why earlier detail became fuzzy.
- `wechat`: a server replay of an already-handled message is ignored, keyed by
  the WeChat message id and remembered in `state.json` for an hour (500 ids
  across peers), so a reconnect or a reload cannot answer twice. Inbound text is
  capped by `maxInboundChars` (8000 by default, clamped 1000–100000) with a
  truncation marker for the model, instead of an unbounded paste reaching it.
- `plan`: both review surfaces mark what changed since the previous review of
  the same plan. The review screen adds a `N sections changed since your last
  review` line and appends `· changed` to the current section in the scroll row,
  and the browser outline dots each changed section. The baseline is the content
  the previous review in the same session showed, with stored review comments
  stripped, so a resumed session shows no markers instead of marking everything.
- Tool transcript: every tool renders a rejected call as one sanitized `Error:`
  line in the error role, long-running `web_fetch`, `web_search`, `read_doc`,
  `run_doctor`, and `job wait` show a live elapsed label, and a finished long
  call appends its duration (the shared `12.0s` format `subagent` now uses).
- `job`: a log segment rotates to `<id>.log.1` once it reaches `maxLogBytes`
  (8 MiB by default; `0` keeps logs unbounded), and `logs` fills a request from
  the previous segment, so a chatty job cannot fill the disk while its recent
  output stays readable. A POSIX `detached` job writes its own log and is
  exempt, as the limitation now states.
- `job`: `start` accepts `stdin: true`, which gives the child a stdin pipe
  instead of an immediate EOF, and the new `send` action writes to it — a line
  by default, a bare keystroke with `newline: false`, and `eof: true` to close
  it — so a REPL, a debugger prompt, or a `read` can be driven without a TTY.
  The pipe is live-only (a reattached or peer job cannot be written to, and
  `detached` cannot be combined with `stdin`), and stdin stays closed by
  default so an existing job still gets EOF and exits.
- `bytefly`: `/bytefly` is a two-section control center — `←`/`→` switch
  between Extensions (the unchanged list and toggles) and Settings. Settings
  lists five curated preferences: bytefly startup TUI, desktop notifications, the
  transcript rail glyph, output padding, and the hardware cursor. `Space`/`Enter`
  change the focused value, `Tab` switches Global/Project scope, app rows are
  Global-only and Project lists only the `bytefly.json` rows, and a change marks
  the screen `Saved · reload to apply`. `bytefly.json` rows write one key
  through a per-key writer, so sibling keys, other sections, and document
  metadata survive, and a malformed document is refused instead of overwritten.
- `bytefly`: a click on a row in the control center focuses it; the wheel still
  scrolls, and every action keeps its keyboard path.
- `wechat`: every admitted WeChat peer now gets their own Pi session instead of
  sharing the terminal's: own history under `<agent-dir>/wechat/sessions/<peer>/`,
  own model context, the package's tools, and this bridge excluded from its
  resources so it cannot start a second poller. A message therefore starts a turn
  immediately rather than waiting for the terminal to be idle, and the answer is
  that session's own text, so the two conversations cannot contaminate each
  other. Sessions resume on the next message and are disposed after 30 minutes
  idle; turns run one at a time across peers so a forwarded dialog has one owner.
- `wechat`: a reply streams to the chat instead of arriving as one lump. Parts go
  out at a paragraph boundary, after two silent seconds, or at 400 characters,
  and the remainder is sent when the turn ends — so a minute-long answer is
  readable while it is being produced. A part longer than `maxReplyChars` is
  still numbered, and the attachment line rides on the first part only.
- `wechat`: reopening the bridge after a token expiry now stops the old worker
  and aborts its parked poll loop first, so the previous peer sessions are
  disposed and two pollers can never share one cursor. A media burst is admitted
  in arrival order and reserves its queue slot before the download, so a batch of
  photos can no longer slip past the queue cap or be answered out of order. Free
  text from an "Other" answer is keyed to the peer who typed it, and a session
  that finishes opening after a close is disposed instead of leaked.
- `wechat`: a turn waiting on an unanswered dialog no longer also gets the
  30-second `还在处理这条…` line; the prompt's own reminder covers that wait.
- `wechat`: a rejected reply now reports the server's own `errmsg` (for example
  `ret -2: context token invalid`) and does so **once per outage** instead of once
  per streamed part; the rest of a streamed answer is not sent after the first
  failure, the rejected peer's stored reply token is forgotten so the next inbound
  message replaces it, and `send_wechat` reports a body-level rejection instead of
  claiming delivery.
- `wechat`: a peer session now gets the package's whole tool surface. Two SDK
  details made it silently thinner: a freshly built resource loader has discovered
  nothing until `reload()` is called, and an SDK session only declares the
  settings' default tools, so the tools extensions register were present but never
  shown to the model. Both are handled in `openPeerSession`, so a peer session
  matches the terminal's tools instead of `read`/`bash`/`edit`/`write`.
- `wechat`: an opt-in `pollHoldMs` asks the server for a shorter `getupdates`
  long-poll hold, which is the floor on how fast a message can be seen (~18 s on
  the server's default). The request field is only sent when configured, since
  the protocol does not document whether the server honours it;
  `scripts/wechat-poll-probe.ts` measures the effect on a real account and
  refuses to run while a bridge is polling.
- `wechat`: the `/wechat` control screen lists each peer conversation with what it
  is doing (`running 42s, 1 queued` / `queued 2` / `idle`), capped at five rows,
  and the one-line summary names the peer whose turn is running.
- `wechat`: peers can send `/stop` (abort their running turn), `/status` (what
  their conversation is doing, and how long), alongside `/new` and `/help`.
- `wechat`: peer sessions are bound to that peer's dialogs (`bindExtensions` with
  the peer's UI context), so `ask_user_question` and plan approval reach the
  sender instead of a terminal nobody is watching.

### Changed

- `wechat`: a peer session now carries a channel contract in its system prompt,
  so the model knows the reader is on a phone rather than at this terminal. It
  puts the conclusion first, prefers a short list over a wide table, keeps code
  to the key lines, skips absolute paths and internal ids, gives options plus a
  recommendation when a decision is needed, and does not ask the reader to run
  a command. A plan or attachment must be summarized in the message itself,
  since a file bubble may never be opened. The text is a static append
  (cacheable, out of the conversation history) and says nothing about
  individual tools or answer length, which have their own budgets.
- `wechat`: a terminal turn keeps its own dialogs while a WeChat peer turn runs.
  The bridge no longer adapts the terminal's shared `ctx.ui`, which used to route
  a local prompt (and its answer) to whichever peer happened to be running; the
  peer session's own UI context carries the channel instead, which also restores
  the plan-file preface before a peer review. `/wechat` still declines
  `login`/`new`/`logout` and prints the summary for `status` while a peer turn
  runs, now read from the bridge's own state, and `remotePrompts: false` now
  actually stops forwarding: a dialog is answered as cancelled.
- `wechat`: the README gains a “What the peer experiences” section — what the
  sender sees for a queued message, a burst, an unreadable attachment, an
  unanswered prompt, a split answer, and an expired bridge — alongside the
  `allowedPeers` id form and the `wechat` state directory in
  `docs/configuration.md`.
- `wechat`: a queued message no longer reads as silence. The typing indicator
  starts when the message is queued and is refreshed while the turn runs, a
  burst of messages becomes one turn instead of one turn each, and a peer who
  waits more than a few seconds gets a single acknowledgement. More than eight
  queued messages are refused with one line instead of growing the queue.
- `wechat`: a turn that ends without an answer says so (`已停止。` / `Stopped.`),
  a turn that cannot be started reports the failure to the peer, and `/new` is
  declined while a run is in flight instead of replacing the session under it.
- `wechat`: peer-facing notices and `/help` follow the peer's language — Chinese
  when the message contains Chinese — instead of speaking English to everyone.
- `wechat`: a reply is sent as plain chat text. Assistant Markdown is flattened
  for WeChat (fence lines, heading markers, `**`/`__`/`~~` emphasis, inline
  backticks), so a peer no longer reads raw formatting, and an answer longer than
  `maxReplyChars` arrives in numbered parts (`[1/3] …`) instead of as
  indistinguishable consecutive messages. A failed part now names how much was
  delivered in the terminal notice, and a reply that was only formatting reads as
  `已停止。` / `Stopped.` rather than as an empty bubble.

- `bytefly`: a transcript now renders in a fraction of a frame once drawn. The
  tool block and the notice memoize the lines they place on the width and the
  body their inner renderer returned, the tool call line memoizes on its text,
  the header on its shape and help chords, and the footer's context estimate
  joins its pricing scan in the leaf-keyed memo. A repeat frame is one
  comparison instead of a clip and a repaint per line, so a long session stays
  responsive, and a theme change or expand toggle still rebuilds every themed
  string.
- Tool transcript: call lines now clip to the terminal width instead of wrapping
  into the railed body (middle clip for a path or URL, so its head and tail
  survive). `read_doc` reads a not-yet-streamed path as pending instead of
  `[invalid arg]`, `run_doctor` collapses to a one-line summary with an expand
  hint, and `web_fetch` shows its HTTP status and redirect target.
- `bytefly`: bytefly's header is installed only when Pi's `quietStartup` is
  `true`, which hides Pi's own startup header; `false`, `"header"`, and an
  unset value leave Pi's built-in header in place. The Settings row **Bytefly
  startup TUI** exposes this state.
- `bytefly`: doctor's proactive session-start warning is now a transcript notice
  (the shared `my-pi-agent/notice` renderer, one row per missing prerequisite
  with the command that fixes it) instead of a transient UI notification, so it
  stays in the message flow and the model reads it. It is part of the bytefly
  startup TUI, so it shows only when `quietStartup` is `true`; `false`,
  `"header"`, and unset leave Pi's startup surface in charge and the notice
  silent.
- `bytefly`: an extension row now carries one verdict. A row switched off in
  settings reads `off` instead of a doctor health word that contradicted its
  empty checkbox, a row excluded by `PI_DISABLED_EXTENSIONS` reads
  `env disabled`, and an off row's findings no longer count toward the
  headline's problem total. The counts say `off` in both the full and compact
  forms.
- `bytefly`: `Enter` in the Extensions section expands only the focused row's
  findings (the expansion follows the row, not the cursor), the pane grows to
  the free terminal height while expanded instead of stopping at four lines, and
  the hint flips to `Enter collapse`.
- `bytefly`: the control center opens on the session's cached findings and
  probes the doctor on the first Extensions view, so `/bytefly` and
  `/bytefly settings` no longer wait for a probe before mounting, and a failed
  probe is a notice with the screen still open instead of a refused Settings
  screen.
- `bytefly`: `/bytefly <name>` checks the name against the discovered set before
  probing, so a typo fails immediately instead of after every prerequisite
  check.
- `bytefly`: a refusal or a failed write inside the control center now appears
  in the screen's own hint row instead of being appended to the transcript
  behind the screen; the key hints return on the next key. Extension toggles,
  settings writes, and probe failures all use that row.
- `bytefly`: `Space` on a row in the trailing `Not resolved` group now explains
  that there is no settings pattern to write instead of doing nothing.
- `bytefly`: `Saved · reload to apply` stays visible on a terminal too short for
  the Settings detail body, so a change is not shown as applied.
- `bytefly`: Tab after `/bytefly doctor` completes extension names, and after an
  extension name it completes `refresh`; each completion carries the whole
  argument, so the subcommand survives. `/bytefly settings <name>` is refused
  instead of silently ignored.
- `bytefly`: a scope switch that drops the focused row (the app rows in
  Settings' Project scope) leaves the cursor on the nearest row instead of
  jumping back to the top.
- `job`: `list` and `/jobs` now show a live peer session's jobs, tagged `peer`,
  instead of hiding them. The screen opens such a row's log but its `d` and `x`
  leave it alone (`x` counts only this session's finished jobs), the model can
  still reach one by explicit id, and the chips, notices, and pruning stay this
  session's own.

- Tooling: `assets/chrome.png` is recaptured from a real `pi -e .` run, so the
  README hero carries the 0.10.0 header and the current footer fields.
- `wechat`: the README gains a Troubleshooting section — the
  one-runtime-per-account lock, a chip that disagrees with `/wechat status` or
  `send_wechat`, and a code upgrade that needs `/reload` or a restart before
  this runtime owns the poller.

### Fixed

- `wechat`: a fenced code block's body is no longer rewritten when a reply is
  flattened for chat. Heading markers, emphasis, and backticks inside a fence
  survive (the fence lines still go), and blank runs inside code are kept; text
  outside a fence is flattened as before.
- `wechat`: a plan review now sends a short digest — the plan's title, step
  count, and first steps — before the approve/refine choices, so the review can
  be answered from the chat even when the file bubble is never opened. A plan
  file or message preface the bridge cannot deliver is reported on the terminal
  instead of failing silently and leaving the peer with only the choices.
- `plan`: plan files are written atomically — a hidden sibling temp file, then a
  rename — for a new plan, a refinement, a `set_plan_steps` edit, and a browser
  feedback save. An interrupted or failed write now leaves the previous file
  intact instead of a truncated plan, and the temp name never reads as a plan.
- `plan`: the read-only git guard also refuses `git cat-file --filters` (which
  runs a configured smudge filter) and the attached `git grep -O…` forms (which
  open a pager or run a command), closing two ways around the read-only shell.
- `wechat`: a second `/wechat login` now switches the bridge to the account that
  was just scanned. The credentials file keeps every stored account but records
  the last confirmed one as active, so logging in as B no longer leaves the
  poller on A while announcing B; a file written before that pointer existed
  still runs its first account.
- `wechat`: the owner's reply token and every per-peer token are found under
  either id form (`alice` / `alice@im.wechat`), and inbound messages for the two
  forms share one entry. A proactive `send_wechat`, or a reply after an inbound
  message without a fresh token, therefore keeps its `context_token` when the
  login response and `from_user_id` disagree on the suffix.
- `plan`: the browser review's Steps counter uses the same `Steps` section list
  as approval and `set_plan_steps`, instead of counting every checkbox in the
  document. A checklist outside `Steps` (for example in `Verification`) no longer
  makes the page report a different progress than the todo list it seeds.
- `plan`: `write_plan` reports the step caps when a plan exceeds them — more than
  50 steps, or a step longer than 200 characters — instead of leaving the model
  to discover later that the tail cannot be seeded or ticked. The plan file keeps
  the full text; the note names what approval will shorten.
- `plan`: `set_plan_steps` accepts an optional `expected` text with each update.
  When the plan was reordered or rewritten between approval and ticking, the
  call is refused with the text now at that step number instead of silently
  marking the wrong step; the whole batch still validates before anything is
  written. The approval message asks the model to pass it.
- `plan`: approval merges the plan's steps into the todo list instead of
  replacing it. Existing items keep their place and status, a step whose text is
  already there is skipped, and the item cap defers the rest, so approving a plan
  no longer discards the work the user was already tracking. The approval
  message says how many steps were added, skipped, kept, and deferred.
- `plan`: a bare `/plan review` works in a session that did not write the plan.
  When no plan path is remembered it opens the newest file in the plans
  directory (newest modification time) instead of reporting that there is
  nothing to review, so a plan written before `/resume` is still reviewable.
- `plan`: approval seeds the plan's `## Steps` section instead of every top-level
  bullet in the file. Prose lists under Context, Approach, or Risks no longer
  become todos, and the 50-step cap now applies to the checklist that actually
  holds the steps, so a long plan's steps stay addressable by `set_plan_steps`.
  A plan without a `Steps` heading keeps the previous behavior (the shallowest
  list in the document).
- `wechat`: an `allowedPeers` entry matches a sender whether or not it carries
  the `@im.wechat` suffix, and case/whitespace no longer matter, so the id shown
  by `/wechat status` (the label without the suffix) can be pasted straight into
  the config. A refused sender is now named in `/wechat status` and the one-line
  summary instead of only counted, which is what makes the allowlist usable.
- `wechat`: `send_wechat` refuses to send while a turn with the owner is in
  flight, since the bridge replies to that turn itself and the answer otherwise
  arrived twice.
- `wechat`: a remote prompt is bounded. A question forwarded to WeChat sends one
  reminder at 90 seconds and cancels itself at three minutes with a one-line
  notice, so a peer who never answers can no longer freeze the session (the
  terminal cannot answer it either while the WeChat turn owns the dialogs). The
  `confirm` parser also accepts the everyday Chinese answers 确定/行 and 不是/不行.
- `wechat`: an inbound attachment the bridge could not read — over
  `maxMediaBytes`, a failed CDN download, or an image that arrived without its
  AES key — is no longer silent. The peer gets one line folded into the answer,
  the model gets a `[WeChat media skipped: N]` block instead of assuming it saw
  the photo, and an attachment-only message is answered instead of dropped. A
  voice note the server gave no transcript for and a video are also answered
  with a one-line notice.
- `wechat`: a stored account now connects on `session_start` through the same
  bridge handle the commands and tools read, and the already-open guard holds,
  so the RPC double `session_start` on a session switch cannot start a second
  poller; `session_shutdown` stops polling instead of leaving it running.
- `wechat`: `/wechat` typed at the terminal no longer opens its dialogs over a
  WeChat turn. `status` prints the one-line summary, and `login`/`logout` report
  that they are unavailable until the turn finishes, instead of crashing on a
  refused full-screen component or sending the logout confirmation to the
  phone.
- `wechat`: `/wechat new` declines while a WeChat turn is in flight, like
  `login` and `logout`, instead of replacing the session under the run and
  leaving the peer unanswered.
- `wechat`: a confirmed `/wechat login` stops a poller that is already running
  before the new credentials are used, so a rotated token takes effect instead
  of being stored while the old client keeps polling. Stored state belongs to
  one account, so logging in as a different one starts from an empty cursor and
  owner rather than carrying the previous owner over and refusing the new
  account's own sender.
- `wechat`: `/wechat logout` drops the bridge with the account, so `/wechat` no
  longer reports the previous owner and activity counters as if the account were
  still connected, and `send_wechat` reports a stopped bridge.
- `wechat`: `/wechat help` lists each verb with a one-line description and the
  subcommand completions carry the same line; the control screen's keys accept
  their uppercase form, and `logout` in a mode without a dialog reports that it
  needs one instead of doing nothing.
- `wechat`: a finished turn with no text now says `这条处理完了，但没有文字输出。`
  instead of `已停止。`, which is reserved for a turn that was actually aborted.
- `wechat`: a reply is never silently dropped. A non-zero `ret`/`errcode` from
  `sendmessage` (other than the expiry code) is reported in the terminal with how
  many parts went out, and a reply that formats down to nothing is reported
  instead of counting as delivered.
- `wechat`: the poll loop is guarded. `getupdates` gets a watchdog derived from
  the server's own `longpolling_timeout_ms` (fallback 90 s, floor 30 s, +15 s)
  and retries a wedged request with the same cursor, and a body-level
  `ret`/`errcode` rejection is reported once and backed off instead of being
  treated as an empty poll (which spun the loop). The watchdog timer is cleared
  after each request, so a settled poll no longer leaves a pending timer behind.

## [0.10.0] - 2026-10-17

### Added

- `bytefly`: the `chrome` section of `bytefly.json` adds `rail`, the
  single-column glyph the transcript rail draws (default `╎`). A wide, emoji,
  multi-character, empty, or control value falls back to `╎`, so the rail can
  never push the body right.
- `bytefly`: while Pi's working row is up, a live elapsed counter
  (`Working… 12s`) is written to its working message and handed back when the
  row comes down. The value is live only — the extension API has no hook to
  keep a finished run's total — and the row is visible in every interactive
  session.
- Tooling: `bun run screenshot:tools` renders every tool's call and result —
  each tool this package registers plus Pi's built-ins, each resolved through
  the shipped block frame — into one full-page reference
  (`assets/tool-renderings.png`) with headless Chrome, and
  `bun run screenshot:tool-pngs` writes one image per tool under `assets/tools/`.
  Both are embedded in the extension READMEs and the catalog, and
  `bun run scripts/tool-renderings.ts render <name> --width <n>` prints one block
  as ANSI on any OS. A built-in is drawn mid-run, so the gallery shows a partial
  call beside the finished and failed ones.
- `bytefly`: every tool block leads with the tool's own call line as the headline
  — the tool name in the theme's tool-title colour — and its body sits two columns
  in directly beneath it, in place of Pi's filled background box. The frame wraps
  the tool's own renderer, so diffs, syntax highlighting, and previews are
  unchanged. A shell call's `$` / `>` prompt is shown as the tool name, and its
  command is repainted in the body colour so the name is the block's only accent
  (`bash bun run check`); `toolTitle` resolves to the accent.
- `bytefly`: renders the shared transcript notice — a `source · title` headline
  with severity-led rows at the transcript's margin — that any extension posts
  under the shared `my-pi-agent/notice` type.
- `job`, `watch`: a finished job or a matched watched line is now posted as that
  visible notice instead of a hidden context message. The model-facing text is
  unchanged, and each extension still prunes only its own stale notices.
- `bytefly`: each user message opens with a two-row `You` nameplate — the label
  over a full-width rule — above the message.
- Docs: terminal screenshots for the `todo`, `question`, `job`, and `rewind`
  screens plus a refreshed `chrome.png` hero, embedded in each extension
  README, the catalog, and the root and Chinese READMEs; `bun run screenshots`
  re-renders the screens and runs a real `pi -e .` for the hero, capturing the
  real window and its title bar, so no image needs a manual session.
- Tooling: `bun run screenshots render chrome --width <n>` prints one frame of
  the whole chrome — header, nameplate, tool block, notice, turn rule, and
  footer — at the live or requested width, so the chrome can be previewed on any
  OS and at any width without a Terminal capture.
- Tooling: `bun run screenshot:plan <plan.md>` renders one plan through the
  browser review page and captures a full-page PNG with headless Chrome, so a
  plan's Markdown layout can be checked without a browser session.
- `plan`: the browser review can approve the plan. A review opened by
  `exit_plan_mode` shows **Approve & run**, which saves the current comments,
  leaves plan mode, restores write access, and seeds `todo`, so the user no
  longer has to return to the terminal to press `a`.

### Changed

- `bytefly`: the transcript rail leads a result body and a notice row, painted by
  status — a running result takes the accent, a failure red, a finished one
  neutral, a notice its worst severity. A tool call stays plain-indented (a
  multi-line call keeps its two-space continuation).
- `bytefly`: `edit` and `write` carry their result on the call body, so that body
  now hangs from the rail too, and their status band is gone; the diff's own
  red/green line colours and the headline are what mark a file change. A call
  line that wraps — a path too long to sit beside the tool name — keeps its
  continuation lines unrailed and without the accent, so the rail begins with
  the result underneath instead of painting the path as diff content, and the
  name stays the block's only accent.
- `bytefly`: the tool name is a call line's only accent. A primary subject — a
  path, URL, query, or pattern — now reads in the body colour (`read
  src/app.ts`, `read_doc docs/a.pdf`, `web_fetch https://…`, `grep /pattern/`),
  as a shell call's command already did, so the name stands out instead of
  sharing the accent with its subject. The rewrite happens before the line wraps,
  so a long path or URL stays in one role, and only the first line is touched —
  `subagent`'s per-step agent names keep the accent and still match its result
  header. The one exception is a call that degenerates to a bare `edit <path>`
  headline with the path broken onto the body: those continuation lines are the
  call, so they are demoted too. `run_doctor`'s extension subject is promoted from the faintest role to
  the body colour (its `(refresh)` option stays faint), and the model-supplied
  extension name is now sanitized.
- `job`, `watch`: the call line draws through the shared `meta` role instead of
  naming Pi's `muted` token inline. Rendered output is unchanged.
- Tooling: the hero capture (`bun run screenshots chrome`) runs `pi` offline in a
  throwaway demo repo, so an outdated local `pi` can no longer add an "Update
  Available" box to the hero and the bar shows a short path and a branch instead
  of this checkout's worktree path; `assets/chrome.png` is refreshed.
- Tooling: the hero capture asks "how are you today?" and `assets/chrome.png` is
  refreshed, so the hero shows the two-row user nameplate instead of the removed
  `❯` marker.
- Tooling: `bun run screenshot:plan` now crops to the page's own content height,
  so a short plan no longer pads the PNG with the browser viewport.
- Tooling: a per-tool rendering image now leads with its one `name · label`
  caption line instead of repeating the name and label as a page heading above
  it.
- `bytefly`: every transcript block that is not prose shares one frame
  (`lib/tui/indent.ts`), so a notice, a tool block, and a subagent quote hang
  from one left edge, and a tool block is compact — its body follows the call
  headline with no separating blank line.
- `bytefly`: the footer's group divider stays `╎` (DOUBLE DASH), and the
  shared-glyph rule no longer forbids East-Asian *ambiguous* glyphs — only wide,
  fullwidth, and emoji, which are two columns in every profile.
- `subagent`: the quoted output is indented two columns inside the result, so it
  reads as a quote rather than as the result's own text.
- `bytefly`: the shipped themes point `mdHeading` at the accent, so Markdown
  headings — including the user-message nameplate — render in the accent color
  instead of yellow.
- `bytefly`: the user message no longer sits on a filled background. The shipped
  themes set `userMessageBg` to the terminal default, so it renders on the same
  background as the tool blocks, with only the two-row `You` nameplate above it.
- `plan`: the browser review's `Close` is now **Back to Pi**, and every outcome
  settles the page on a terminal chip — `Approved`, `Saved`, or `Closed` —
  instead of falling to a red `Offline` when the server closes the stream.
  `/plan review` stays comment-only and refuses approval.
- `plan`: the browser review's inline code is a soft `--surface` fill instead of a
  bordered chip, so a code-dense plan reads as prose rather than a patchwork of
  buttons.
- `file-browse`: the header's branch chip no longer carries its own dirty dot and
  warn tint. The `● N changes +A −D` chip already reports uncommitted changes, so
  the header row stated the same fact twice, with two amber dots a few pixels
  apart; the branch chip now shows the branch (or detached head) alone.
- `bytefly`: a tool with no renderer of its own now gets a readable fallback
  call line — the leading string argument bare, the rest as trailing options
  (`open_path src/app.ts`, `enter_worktree tool-gallery`) — instead of a dump of
  raw `key="value"` pairs.
- `web_search`: the call line states the requested limit (`(max 8)`), so it no
  longer reads as the result count beside the result's actual `via <provider> ·
  N results`; the direct answer is labelled `Answer:`.
- `read_doc`: the result summary groups its counts and names the next offset
  (`PDF · chars 40,001–120,000 of 250,000 · next at 120,000`) instead of mixing
  a raw bound with a `k`-suffixed one (`1–40k of 42k chars · more at 40k`).
- `memory`, `goal`, `todo`: the call line carries the summary and the body the
  new state, so a note, objective, or task is no longer printed twice in one
  block. `memory` confirms the write (`Added to project memory` plus the new
  counts) without repeating the note, `goal` shows the status header (`Goal ·
  active`) alone instead of restating the objective, and `todo` shows progress
  (`todo → 1/4`) with the items only on the result rows.
- `themes`: the rules, frames, and fences are visible again. `borderMuted` draws
  every divider and the chrome frame, and at `#484f58` and `#d0d7de` it reached
  only 2.3:1 and 1.5:1 on the canvas, so the rule grammar washed out, especially
  in the light theme; `borderMuted` and `border` now clear 3:1 in both
  appearances, `mdCodeBlockBorder` follows `muted` like Pi's own themes, and
  `scrollbarThumb` moved to `muted` so the fullscreen thumb separates from its
  track.

### Fixed

- Tooling: the tool gallery draws the decorations a terminal does. The page is
  assembled from ANSI in a process without a TTY, where chalk dropped bold,
  italic, underline, strike, and reverse video, so every tool name was unbolded
  and the `edit` diff's changed words were plain; the capture now emits them,
  and reverse video is rendered as the terminal swaps it — a filled cell —
  instead of an `invert()` filter. The `edit` fixture is a one-line replacement
  so the image shows that word-level highlighting at all.
- `bytefly`: the startup header now takes its left margin from Pi's `outputPad`
  instead of a fixed column, so `outputPad: 0` no longer leaves the nameplate one
  column right of the transcript, and its grouped help hangs one body indent
  inside that margin instead of at `screenHint`'s screen indent. Its rule stops
  at the transcript's right edge instead of the terminal edge. The hint helper
  gains an optional `indent` (default unchanged), which the header uses;
  `bun run screenshots render chrome` now draws the whole frame at Pi's default
  pad so the preview matches a real session.
- `subagent`: the call line survives a partially-streamed call. A streamed
  `tasks` or `chain` element can reach the renderer before its `agent` and
  `task`, and the renderer called `replace` on the missing task, so the call
  block dropped to Pi's generic call line until the arguments settled; a missing
  or wrong-typed field now reads as a placeholder, and a `tasks`/`chain` that is
  not an array reads as absent.
- `themes`: both files point `$schema` at Pi's published schema
  (`https://pi.dev/schemas/theme.schema.json`) instead of a raw GitHub path that
  answers 404, so editor validation and completion work again.
- `themes`: light-theme text clears 4.5:1 on every surface it is painted on. The
  tool title reached only 4.44:1 on the error panel and the accent 4.21:1 on a
  selected row, so the error and selection tints are one step lighter;
  `test/theme.test.ts` now fails when a role drops below its floor, when
  `$schema` is not Pi's, when a theme's name does not match its file, or when the
  light and dark files' role mappings drift apart.
- `bytefly`: the transcript notice and the turn separator now follow Pi's
  `outputPad` setting, like the tool blocks already did. Pi pads its own
  components and hands tool renderers (`context.outputPad`) and message
  renderers (`options.outputPad`) the value, but gives an entry renderer none
  and adds its component raw, so the notice and separator had sat at column 0
  while tool blocks were one column in. One shared `PadSource` carries the value
  to all three; no new config, and Pi's setting is the only knob.
- `bytefly`: the tool-call colour grammar is applied consistently. The generic
  fallback paints a subject with the accent and its options faint, like the
  built-ins, instead of the whole argument dump muted; and `run_doctor`'s call
  line names the tool in bold (`run_doctor`) instead of `doctor` unbolded.
- `subagent`, `question`: the call's content — a task or step, and a question's
  option lines — uses the body colour rather than the faintest, which is the same
  value as the borders and sits under WCAG AA on the dark theme.
- `document`: `read_doc`'s paging options use `faint` like the other call lines,
  instead of the result body's muted.
- `bytefly`: a framed `edit` block sat one column deeper than every other tool
  whenever the output-pad setting was on. Pi's `edit` is a natively self-shell
  renderer and pads its own box by `outputPad`, and the frame applied the pad
  again; the frame now hands the base renderer `outputPad: 0` and applies the
  pad once, so the headline and diff line up with the rest of the transcript.
- `bytefly`: a shell call whose command wraps past the width kept the accent (and
  the bold) on its wrapped fragments — only the first rendered line was
  repainted. The call string is recoloured before it wraps, so the whole command
  reads in the body colour and only the tool name keeps the accent.
- `subagent`: the result header's agent name uses the accent, matching the name
  on the call's step lines; the two agreed only because the shipped themes alias
  `toolTitle` to the accent.
- `todo`: the transcript result rows were indented two columns too far in —
  `todoRailLines` prefixed its own `BODY_INDENT` on top of the indent the
  tool-block frame already applies — so they now start at the standard body
  indent, matching `goal`, `memory`, and the built-ins.
- `job`, `watch`: the transcript result rows drop `listRow`'s reserved
  selection-marker column (the interactive `/jobs` and `/watch` screens keep
  it), so their status glyphs sit at the body indent instead of two columns
  deeper.
- `subagent`, `ask_user_question`: the call's continuation lines (a task/step
  list, or a per-question option list) no longer indent themselves, so they sit
  at the body indent instead of two columns deeper — the tool-block frame
  already supplies it.
- `plan`: the browser review's sidebar hint now names `a` on a review that can
  approve and points at `?` for the full shortcut list, instead of listing only
  `j`/`k`/`c`/`s` after approval moved onto the page.
- `question`: the `ask_user_question` call line no longer jumps a column while
  the call's arguments are still streaming. A partial parse can hand back a
  question before its `header`, or an option before its `label`, and the summary
  helpers passed that straight to `sanitizeLine`, which threw; Pi answers a
  throwing renderer with its own call line, a column to the left of the framed
  one. A non-string field now reads as absent.
- `bytefly`: a tool renderer that throws is now caught by the block frame and
  drawn as the frame's own fallback at the frame's pad, instead of the throw
  reaching Pi and the row dropping to Pi's generic call line. This keeps the
  frame's one-left-edge invariant for every tool, not just `ask_user_question`.
- `plan`: a list item's continuation lines now hang under the item's text in the
  browser review. A hard-wrapped or lazy-continued line was emitted as a bare
  paragraph at the block's left margin, so a multi-line step read as several
  disconnected lines.
- `rewind`: a run started by a custom message (a wake) no longer prints a stack
  trace into the transcript. `before_agent_start` fires for those runs with no
  user prompt, so `summarizePrompt` threw on `undefined`; a missing prompt now
  yields no summary, and rewind still resets its per-run state.
- `file-browse` / `plan`: the app shell now fills the viewport. `min-height:100vh`
  left the shell's height indefinite, so the sidebar, content pane, and code
  viewport all grew with their content and the whole document scrolled instead
  of the panes; the shell now has a definite `height:100vh` and the browser's
  default body margin is reset, while narrow screens return to normal page
  scroll.
- `file-browse`: a diff's pinned hunk header no longer stacks on the next one,
  and `n`/`p` step relative to the code viewport rather than the window top.
  Each hunk is now wrapped in its own section so a pinned header is bounded by
  its body, and the keyboard scrolls the code pane to the hunk instead of
  calling `scrollIntoView` on the pinned (already-at-top) header.
- `file-browse` / `plan`: rendered Markdown tables no longer inherit the prose
  `overflow-wrap:anywhere`. Since `anywhere` also shrinks a cell's min-content
  width, auto layout collapsed a code-span column to one character and split
  identifiers such as `feature-detail` mid-word across two code chips. Cells now
  wrap at `break-word`, headers and code spans stay on one line, and a table too
  wide for the column overflows into its scrolling wrapper instead of being
  squeezed.
- `subagent`: the call's step agent names now read in the body colour, so the
  `subagent` tool name is the call line's only accent, matching the rule every
  other call follows.
- `subagent`: a step whose `agent` or `task` has not finished streaming no
  longer throws, so the call body stays framed instead of falling back to Pi's
  generic call line.

## [0.9.0] - 2026-10-16

### Added

- `file-browse`: a read-only git diff view. A `● N changes` chip links to
  `/diff`, a change overview with `git diff --stat`, and `/diff/<rel>` renders
  one file's unified diff with `head` / `staged` / `worktree` scopes; untracked
  files show as all-add and an unborn `HEAD` falls back to the index. Configured
  by the `gitDiff`, `diffContext`, and `maxDiffLines` keys.
- `file-browse`: diff view polish — changed lines are syntax-highlighted with the
  file's language, dirty files and their directories carry a marker in the
  listing and the tree, and the header chip shows `+A −D` line totals.
- `plan`: the browser review header shows an always-visible status chip —
  connection state, comment count, and whether there are unsaved changes. It
  reads "Connecting…" until the stream first opens, so a slow initial connect
  never flashes "Offline".
- `file-browse`: a `?` keyboard sheet over a shortcut layer — `/` or
  `Ctrl/Cmd+K` quick open, `u` line wrapping, `r` rendered/raw Markdown, and
  `n`/`p` between a diff's hunks. A hairline reading-progress bar follows the
  page's main scroller, a file's diff head shows its own `+A −D` totals and hunk
  count, and a diff's hunk headers pin to the top of the code viewport while its
  body scrolls.
- `file-browse`: rendered Markdown autolinks a bare `http(s)://` or `www.` URL
  the way GitHub does, with trailing punctuation and an unclosed `)` left out of
  the link.

### Changed

- `bytefly`: the TUI chrome and the `/bytefly` screen are drawn from a new
  shared `lib/tui/` design system (semantic roles, rules, rows, columns, gauge),
  so every surface follows the active theme by role rather than by token name.
  The look is refreshed: the header bolds the agent name and anchors its rule
  with an accent lead under the mark, and the screen uses a label-first
  `bytefly ────` title, one row grammar, and `◼`/`◻` checkboxes in place of
  `[x]`/`[ ]`. The footer and the turn rule are unchanged on screen; their
  colors and the context gauge now come from the kit.
- `job`, `watch`: the `/jobs` and `/watch` screens are drawn from the same
  `lib/tui/` design system, so their title rule is now label-first
  (`Jobs ────` instead of `─── Jobs ───`) and their rows use the shared grammar.
  The id-anchored selection and the log/match pane they each re-implemented now
  live once, in `lib/tui/cursor.ts` (`IdCursor`) and `lib/tui/line-pane.ts`
  (`LinePane`), and their footer chips share
  `lib/tui/status-controller.ts`. Keys, wording, and layout are unchanged.
- `todo`, `memory`, `rewind`: the `/todos`, `/memory`, and `/rewind` screens are
  drawn from the `lib/tui/` design system too — a label-first title rule, the
  shared `listRow` rows and `emptyState`, and the shared dock frame. `/rewind`
  now uses that frame, so its blank lines and its row budget match the other
  list screens.
- `question`: the dialog is drawn from the `lib/tui/` design system — a
  label-first `Question ────` title rule over a muted closing rule, the shared
  `◼`/`◻` checkbox in place of `[x]`/`[ ]`, and the kit's new `flowCells` for
  the tab bar.
- `plan`: the review overlay is drawn from the `lib/tui/` design system — a
  label-first `Plan Review ────` title rule in place of the centered one, the
  shared `◼`/`◻` for the plan's `- [ ]` / `- [x]` task lines (in place of
  `[✓]`/`[ ]`), and the kit's `gaugeBar` for the scroll meter. The frame, the
  scroll keys, and the section jumps are unchanged.
- `wechat`: the `/wechat login` and `/wechat status` screens are drawn from the
  `lib/tui/` kit — a label-first title rule, the shared `keyValueRow` for the
  status label column, and role-based colors — closing the last interactive
  screens that still named theme tokens inline.
- `subagent`, `document`: the transcript renderers draw their colors through the
  `lib/tui/` roles, and the subagent's `Task` / `Output` section rules come from
  the kit's `centeredRule`. The rendered output is unchanged; `toolOutput` and
  `toolTitle` stay direct, since they are Pi's tool vocabulary rather than
  chrome.
- every extension's tool renderer and status chip now draws through a
  `lib/tui/` role (`paint`), completing the design-system sweep: no raw theme
  token is left outside the kit, with Pi's `toolOutput` / `toolTitle` (
  tool-block vocabulary, not chrome) the only exception. Rendered output is
  unchanged.
- `bytefly`: one `/bytefly` command replaces the `/bytefly`, `/extensions`, and
  `/doctor` aliases. `/bytefly [extension] [refresh]` opens the screen and
  `/bytefly doctor [extension] [refresh]` prints the doctor report
  (`run_doctor`'s text; the dock screen in `tui`). The header hint and the
  proactive warning now point at `/bytefly doctor`.
- `plan`: browser review reuses a plan's last loopback port across turns, so the
  page origin (and the browser's saved `pi-web-theme` choice) stays stable.
- `plan`: the browser review is a reading-first surface. The page title comes
  from the plan's H1, the document keeps one centred measure with a comment rail
  in its left margin, the side panel reports step progress and per-section
  comment counts, and GFM tables and `---` rules render. `j`/`k` move between
  blocks, `c` comments, `s` saves, and `?` opens a shortcut sheet.
- `plan`: the browser review document is GitHub's Markdown content column (a
  centred measure of at most 1012px) with the comment rail inside it, and a bare
  `http(s)://` or `www.` URL in a plan is autolinked the way GitHub renders it.
- `file-browse`: the rendered Markdown body follows GitHub's Markdown content
  column — one centred measure of at most 1012px carrying headings, prose,
  tables, code, and images, with wide tables scrolling inside it.
- `file-browse`: the root listing is named after the served folder instead of
  `/`, and the file head drops the always-`application/octet-stream` response
  type so the footer carries the relative path instead.

### Fixed

- `question`: the dialog is now height-aware. The option list windows with an
  `option A–B of N` row when the terminal is shorter than the question, so the
  hint and the closing rule can no longer be pushed off-screen by a long list.
- `memory`: the `/memory` hint advertised `g`/`G` but nothing bound them; they
  now jump to the first and last note.
- `plan`: the browser review save/cancel response is delivered before the
  session closes, so a successful save no longer shows "Failed to fetch".
- `plan`: browser feedback stripping is fence-aware, so a `> [!REVIEW]` line
  inside a fenced code block is content, not stored feedback.
- `plan`: a review-page link to a protocol-relative URL (`//host`) is no longer
  followed as an external link.
- `plan`: a 409 save conflict now offers a **Reload** action instead of a
  generic error, and a remembered text selection is cleared on re-render.
- `plan`: the loopback review server rejects a missing or non-string `Host`
  header (fail closed) and returns no content type for the favicon.
- `plan`: the review server removes its abort listener when a session ends.

## [0.8.1] - 2026-10-15

### Changed

- `file-browse`: rendered Markdown demotes document headings one level so the
  page keeps a single `h1`, gives each heading a stable anchor id so in-document
  `#anchor` links resolve, and adds an **On this page** outline for a document
  with four or more headings. The `copy` action reads `copy contents`, and
  task-list items are real disabled checkboxes instead of hidden glyphs.

### Fixed

- Package: the gallery renders the hero screenshot — `README.md` uses Markdown
  image syntax, which the gallery rewrites to the npm CDN, instead of a raw
  `<img>` tag it strips — and `pi.image` is an absolute
  `raw.githubusercontent.com` URL, which the package-preview service requires.
- Docs: the release steps publish with `--registry https://registry.npmjs.org/`,
  so a machine whose default registry is a read-only mirror does not fail with
  `E401`.

## [0.8.0] - 2026-10-15

### Added

- Docs: a Simplified Chinese `README.zh-CN.md`, linked from the root `README.md`.
- `file-browse`: rendered Markdown resolves reference-style links — full
  `[text][id]`, collapsed `[text][]`, and shortcut `[text]`, using `[id]: url`
  definitions, which are no longer shown as paragraphs — and decodes numeric and
  common named character references (`&amp;`, `&#39;`, `&copy;`) as literal text.

### Changed

- `plan`: `set_plan_step` is now `set_plan_steps`. It takes an `updates` array
  instead of a single `step`/`status` pair, so several steps can be ticked off
  or reopened in one all-or-nothing write: nothing changes if any step is out
  of range. Reopening a step now also drops its `[DONE:n]` marker, so the file
  agrees with the checkbox.
- `bytefly`: `/bytefly [extension] [refresh]` opens one docked screen that
  merges the `/extensions` picker and the `/doctor` report into one row per
  extension — enable checkbox, worst-severity glyph, and summary, with the
  focused extension's findings underneath — and `/extensions` and `/doctor`
  are registered against the same handler as aliases.
- `bytefly`: the footer's `price` config is read once per install (session start
  or a session-tree change) instead of every time the footer is toggled back
  on, so an edit is picked up by a new session or tree change rather than a
  toggle.
- `bytefly`: the header docs describe the current nameplate — a two-tone
  half-block mark beside the agent and chrome identities and a grouped help
  block — instead of the older "recolors Pi's brand mark" header, in
  `extensions/bytefly/README.md` and `docs/extensions.md`.
- `bytefly`: the startup header's help block tracks Pi's current expanded
  startup help — `ctrl+d to exit (empty)`, `!!` bash without context, `ctrl+p`
  model cycling, `shift+tab` thinking cycling, `alt+enter` follow-up, and
  `ctrl+v` paste — instead of the older wording that omitted them.
- Docs: the root and Chinese READMEs keep one hero screenshot and move the
  plan-review and file-browse screenshots into their extension READMEs.
- Docs: the "pin a release" install example now pins `v0.8.0`.

### Removed

- `bytefly`: the `/bytefly header`, `/bytefly footer`, and `/bytefly status`
  subcommands and the master chrome toggle. The header, footer, and turn rule
  are always installed in interactive (`tui`) sessions now; disable the bytefly
  extension through `pi config` to remove its chrome.

### Fixed

- `bytefly`: on terminals without half blocks the header's two-tone `Pi`
  wordmark no longer doubles the name (it read `Pi   Pi v1.2.0`); the wordmark
  is the app name, so only the version follows it.
- `file-browse`: rendered Markdown tables, task-list checkboxes, and images
  are styled again. The web brand migration dropped the `md-*` rules, so tables
  had no borders or padding, alignment was ignored, and task items kept their
  bullet. Columns size to their content rather than filling the card.
- `file-browse`: rendered Markdown tables follow GFM more closely. A delimiter
  row whose cell count differs from the header's is no longer a table, so a
  stray `---` row cannot turn prose into one; header cells carry `scope="col"`;
  a wide table scrolls horizontally instead of wrapping; and a list item whose
  text starts with a pipe (`- | a | b |`) stays a list.

## [0.7.0] - 2026-10-15

### Added

- Docs: an open-source documentation structure. A grouped, end-user-first
  `README.md`, a `CONTRIBUTING.md` and `SECURITY.md`, guides under `docs/`
  (`getting-started`, `extensions`, `configuration`, `architecture`,
  `development`, `security`), and GitHub issue and pull-request templates.
- `plan`: browser review. Press `w` on the `exit_plan_mode` review screen, or
  run `/plan review [path]`, to open a plan in a loopback browser, select text
  to leave inline comments, and save them into the plan file as `> [!REVIEW]`
  lines; the comments come back to the model as a refinement request. The
  server is tokenized, bound to `127.0.0.1`, and closed on save, cancel, tab
  close, or session shutdown.
- `wechat`: inbound slash commands. An admitted peer can type `/new` in the
  chat to start a fresh session; the bridge intercepts it before it becomes a
  turn, replies, and reconnects on the new session. The registry supports
  snippets (a predefined body expanded into the turn) and actions (run locally,
  with no turn), with `/new` as the only entry today.
- `bytefly`: `bytefly.json` is the shared config document for the whole
  package. Every extension owns a top-level section (`document`, `job`,
  `web-access`, …; bytefly owns `price`, `notify`, and `doctor`), and
  `assets/bytefly.schema.json` describes the document for editors.
- `bytefly`: an opt-in notify capability that raises an OS notification when a
  full run settles, when a background `job` finishes (published on the shared
  `my-pi-agent/job-finished` event-bus channel), or when the agent asks for
  input mid-run. Settings live in the `notify` section of `bytefly.json`, and
  delivery picks an OSC 777/99 sequence or a platform notifier (`osascript`,
  `notify-send`, a Windows toast).
- `watch`: tail a file or a command's merged output and match each new line
  against a regular expression (with an optional exclude list, case-insensitive
  by default). Matching lines are sanitized, alerted, and reported to the model
  at the next turn, or wake a turn immediately with `wake: true`. The `watch`
  tool has `add`, `list`, `status`, `matches`, `logs`, `stop`, and `clear`; a
  `⊚ N`/`! N` chip pair shows running watchers and unreported matches, and
  `/watch` opens a dock screen to read matches, stop, and clear. Watchers are
  session-only. Configuration lives in the `watch` section of `bytefly.json`.
- `memory`: an interactive `/memory` picker in the TUI. A bare `/memory` opens a
  dock screen listing both stores, with `j`/`k` (and the wheel) to move, `s`/Tab
  to filter by scope, `Enter`/`e` to edit a note inline, `a` to add one, `d` to
  forget one behind a `y/N` confirm, and `r` to reload. Other modes and
  `/memory list` keep the plain listing.
- `wechat`: `/wechat help`, plus `n` (new session) and `o` (log out) on the
  `/wechat` control screen, so every operator action is one key. A WeChat peer
  can type `/help` to list the chat commands.
- Docs: `README.md` screenshots for the package chrome, the browser plan
  review, and the loopback file browser; the `pi.image` manifest field now
  points at `assets/bytefly-chrome.png`.

### Changed

- Docs: the extension catalog and the contributor contracts move out of the
  root `README.md` into `docs/extensions.md`, `CONTRIBUTING.md`, and the
  `docs/` guides; the tool-naming invariant now names `docs/extensions.md`.
- `plan`: the browser review page is rebuilt on the shared web theme — a sticky
  header with the plan title, comment count, and theme toggle, a section
  outline, a right-hand comment rail aligned to each block, and
  syntax-highlighted code.
  The theme tokens, the pre-paint bootstrap, and the syntax highlighter move to
  `lib/` (`web-theme.ts`, `highlight.ts`, `escape.ts`) and are shared with
  `file-browse`; the light/dark choice now lives under one `pi-web-theme` key.
- The local browser surfaces adopt the Bytefly web brand system (`lib/web/`):
  the palette is derived from the `bytefly-dark`/`bytefly-light` terminal
  themes, and a shared `bf-*` component, app-shell, and markup layer replaces
  the page-local CSS. The file manager, file viewer, and plan review are
  rebuilt on it, and `lib/web-theme.ts` is replaced by `lib/web/`.
- `wechat`: the bridge now starts automatically on `session_start` while an
  account is stored (and after `login`), so it reconnects itself across a
  session replacement. The `/wechat status` screen no longer offers start/stop.
- Config: every per-extension config file (`document.json`, `file-browse.json`,
  `goal.json`, `jobs.json`, `memory.json`, `rewind.json`, `todo.json`,
  `web-access.json`, `wechat.json`, `worktree.json`) moved into a top-level
  section of the shared `bytefly.json`, and bytefly's price keys moved under
  `price`. Breaking: the old files and `doctor.json` are no longer read. Run
  `bun run config:migrate` once per machine and repository to move them.
- Distribution: releases are published to npm as well as tagged in git. The
  package declares `publishConfig.access: public` and a `files` allowlist
  (extensions, lib, themes, assets; tests excluded), and the docs document both
  sources.
- `wechat`: `/wechat` and `/wechat status` open one control screen, and the
  subcommands (`login`, `new`, `status`, `logout`, `help`) are shortcuts for the
  same actions. An unknown subcommand reports the valid verbs instead of
  silently opening the status screen.
- `plan`: browser review comments render inline under the block they anchor to
  instead of in a right-hand rail; the plan fills the review column, the
  two-column grid and `bf-review--no-rail` collapse are gone, and the section
  outline fills the sidebar height.
- `plan`: the terminal review screen no longer shows an `n/m steps done` row
  under the header, and the browser review header no longer shows a comment
  counter.
- `file-browse`: the Markdown file view fills the file card instead of capping
  at an 80ch reading measure.

### Removed

- `wechat`: `/wechat start` and `/wechat stop`. The stored account now controls
  the bridge lifecycle; `/wechat logout` is the only way to stop polling.

### Fixed

- `plan`: the browser review outline highlights the active section again (the
  observer still selected the pre-rebrand block class), the comment composer and
  editor textareas use the shared theme, the save/cancel message sits inline in
  the header instead of a reserved full-width band, a heading-less plan no longer
  collapses the review into the outline column, and the outline is sticky again
  on wide screens.
- `rewind`: a snapshot taken with `includeUntracked` disabled captures tracked
  files again. The temporary index is seeded from HEAD before `git add -u`, so
  the snapshot is no longer the empty tree (a code rewind had been a silent
  no-op).
- `rewind`: parallel tool calls in one prompt take a single snapshot. The run's
  root and policy are resolved before the first tool call, so the one-snapshot
  guard is synchronous.
- `wechat`: the removed `/wechat start` guidance no longer appears in the source
  comments, the login-failure notice, or the `send_wechat` tool description and
  error.
- `plan`: the browser review no longer stretches every block to fill the window,
  and the outline band sizes to its content.
- `plan`: selecting text in the browser review no longer opens the comment
  composer, so text can be copied; the selection is quoted when you click
  **+ Comment**.
- `file-browse`: the narrow-viewport sidebar is a working disclosure again. The
  shared shell's media rule lost the cascade to the base `display:none`, so the
  file tree, the path filter, and quick open were unreachable below the
  breakpoint; the sidebar now collapses at 860px instead of 720px.
- `file-browse`: the breadcrumb no longer repeats the page heading or card
  title, and the header's theme toggle stays right-aligned when the toolbar
  wraps.
- `plan`: the review outline collapses to its `Sections` disclosure at the same
  860px breakpoint as the shared shell (and its panel label no longer doubles
  the summary on narrow screens).

## [0.6.1] - 2026-10-14

### Fixed

- `memory`: `/memory list` is handled as an explicit subcommand instead of
  falling through to the bare-command default, and an unknown `/memory`
  subcommand now reports a warning instead of silently listing the store.

## [0.6.0] - 2026-10-14

### Added

- `plan`: the plan document is now shaped and trackable. `write_plan` documents
  a canonical outline (a `# <Title>`, then `## Goal`, `## Context`,
  `## Approach`, `## Steps`, `## Risks`, `## Verification`) and guides the model
  to follow it, with steps written as `- [ ]` checkboxes so the review gauge and
  the seeded todo list are meaningful. Guidance only: any markdown is accepted
  and rendered as written. The review screen splits the body at its headings,
  names the current section, and jumps between sections with `n`/`p`; a new
  `set_plan_step` tool marks a step `pending` or `completed` in the approved
  plan file in place, so the artifact stays current as the work is done.

- `bytefly`: the startup header is bytefly's again, restoring the surface the
  `chrome` extension dropped. It reproduces Pi's built-in identity — the brand
  mark and the version — and recolors the mark from the active theme's tokens
  (`accent` / `warning`) instead of the fixed brand palette, so it follows the
  `bytefly-dark` and `bytefly-light` themes. It is installed only in
  interactive (`tui`) sessions and restored on shutdown; the content is
  unchanged and the look is tuned in `header/config.ts`.

- `bytefly`: the two-line, width-adaptive footer formerly shipped as
  `status-bar` and then `chrome`, replacing Pi's built-in footer. The footer
  keeps pwd + session name + git branch/worktree +
  browse chip on line 1 and the context gauge + usage + mode/alert + model +
  thinking level on line 2; `/bytefly [status]` toggles it. The display name,
  command, extension directory, and config file are all `bytefly` now.
- `bytefly`: absorbs the `/extensions` picker, formerly the
  `extension-picker` extension. `/extensions` lists every resolved Pi
  extension across all configured packages and enables or disables one (Global
  or Project settings) by writing `settings.json`; changes apply on reload. The
  footer, turn rule, and picker now share one disable switch
  (`PI_DISABLED_EXTENSIONS=bytefly`), and `bytefly` is omitted from its own
  list.
- `bytefly`: absorbs the `doctor` extension.
  `/doctor [extension] [refresh]` and the read-only `run_doctor` tool report
  whether each extension has what it needs at runtime — missing binaries,
  optional packages, login/state files, and config files that fail to parse —
  with one warning at session start when an enabled extension cannot work. The
  list screen is TUI-only; every other mode prints the same report, and the
  doctor config file stays `doctor.json`. Breaking: there is no separate
  `doctor` row in the report, and `PI_DISABLED_EXTENSIONS=doctor` no longer has
  an effect — disable the whole extension with `bytefly`.

- `goal`: a bare `/goal` with no goal set shows the command usage instead of
  only `No goal set.`, and `/goal help` (or `-h` / `--help`) shows it at any
  time, so a first-time user can discover how to set and manage a goal without
  the README.
- `file-browse`: code files render with first-party syntax highlighting in the
  text view, and fenced code blocks in the rendered Markdown view are
  highlighted too (keywords, strings, numbers, comments, and markup) for
  JavaScript/TypeScript, JSON, CSS (incl. SCSS/Sass/Less), HTML/XML and
  template components, shell, Python, Java, YAML, and SQL. The tokenizer is
  escape-first and dependency-free, so it works without JavaScript and unmapped
  file types or fence languages stay plain.
- `file-browse`: a header theme toggle switches between the dark and light
  palettes and remembers the choice per browser (`localStorage`); until it is
  used the palette follows the system `prefers-color-scheme`, and a pre-paint
  `/theme.js` script applies the saved choice to avoid a flash.
- `memory`: stored notes are re-read when their file changes on disk (an
  mtime/size check before every read) and `/memory reload` forces a refresh, so
  a hand edit or another session lands without a restart.
- `memory`: the tool gains an `update` action that replaces an exact note in
  place, in one mutation, instead of the forget-then-add gap; `to` carries the
  replacement, a non-matching `text` is rejected without writing, and an
  update to the same text is a no-op.
- `memory`: `add` now skips a note that is already stored, comparing under a
  conservative key (case, whitespace runs, and trailing sentence punctuation)
  and returning the stored text as `existing`, so re-stating a fact in new words
  no longer grows the store.
- `goal`: `/goal raw <prompt>` records the typed words verbatim and starts the
  run, skipping the comprehension step, for when the user already knows exactly
  what they want.
- `wechat`: in the TUI, `/wechat status` opens a control screen instead of
  printing one line — account, connection state, owner, activity counters, and a
  pending remote prompt, with `l` to log in/reconnect, `s` to start or stop, and
  `r` to refresh. Other modes keep the one-line summary.

### Changed

- `bytefly`: the startup header is a nameplate instead of a recolor of Pi's.
  It draws a two-tone half-block mark from the `accent` / `warning` tokens beside
  the agent identity (`Pi vX.Y.Z`) and the chrome identity
  (`enhanced by bytefly vX.Y.Z`, read from the package manifest), then a `─` rule
  and a grouped help block whose keys resolve live from Pi's keybindings (so a
  rebound key shows the user's chord). It is a fixed height, sheds the chrome
  version, the chrome line, then the agent name as the terminal narrows, drops
  whole help keys rather than clipping one, and falls back to a two-tone `Pi`
  wordmark on terminals that cannot render half blocks.

- `bytefly`: `/bytefly` now toggles the whole bytefly chrome — the header and
  the footer together — instead of only the footer. `/bytefly header` and
  `/bytefly footer` toggle one surface, `/bytefly status` reports both, and the
  subcommands still complete with Tab.

- `file-browser` is renamed `file-browse` everywhere: the extension directory
  and `pi.extensions` path, the package description and keywords, the
  `PI_DISABLED_EXTENSIONS` name, and the config file (`file-browser.json` is now
  `file-browse.json`). Its command changes from `/serve` to `/browse`, so the
  `◉ <port>` status chip now publishes under the `browse` status key. Point a
  saved `file-browser.json` and any `PI_DISABLED_EXTENSIONS=file-browser` at the
  new names.

- `plan`: `write_plan`'s description and `content` parameter document the
  outline; `exit_plan_mode` numbers the steps it seeds into `todo` and tells the
  model to tick each one off with `set_plan_step` (which is itself refused while
  plan mode is on, so the read-only guarantee is unchanged).

- `document`: `read_doc` extracts every format in process instead of shelling
  out to the `pdfcraft-cli` / `wordcraft-cli` / `gridcraft-cli` executables. PDF
  uses `unpdf`, DOCX `mammoth`, legacy DOC `word-extractor`, ODT `fflate` plus
  `fast-xml-parser`, RTF `rtf-parser`, and XLSX `exceljs`. The libraries ship as
  dependencies and load lazily on first read, so `read_doc` needs no per-format
  install step, `doctor` no longer probes for the three binaries, and every
  format keeps the same paged output.
- `file-open`: the `file-explorer` extension is renamed to `file-open` — the
  directory, package manifest entry, `PI_DISABLED_EXTENSIONS` name, and docs.
  The `/open` command, its `open_path` tool, and its schema are unchanged.
- `question`: the `ask-user-question` extension is renamed to `question` — the
  directory, package manifest entry, `PI_DISABLED_EXTENSIONS` name, and docs.
  The `ask_user_question` tool and its schema are unchanged.
- `goal`: `/goal <prompt>` now establishes a shared understanding of the goal
  instead of rewriting the prompt. The model restates the goal as it understands
  it and, when it cannot yet, the command asks its questions directly through
  host dialogs (`select` / `input`); a second model call folds the answers into
  the final restatement, which the user confirms or corrects in the editor. The
  `ask_user_question` delegation is gone, so the handoff can no longer be lost.
- `lib/ui.ts`: every shared `GLYPHS` entry is now narrow or neutral
  `East_Asian_Width` — the snapshot marker is `⬥` (was the ambiguous `◆`) — and
  a new test asserts the width class, since `visibleWidth` cannot. Status glyphs
  in `job`, `subagent`, `todo`, `goal`, and `plan` now route through `GLYPHS`
  instead of retyping `○`/`◐`/`◎`/`✓`/`✗`, so a CJK-width terminal no longer
  renders them two columns wide.
- `ask_user_question`: the answer hints render through the shared `screenHint`,
  so a narrow terminal drops whole keys instead of wrapping or clipping one.
- `bytefly`: the extension is reorganized into feature folders. `footer/` holds
  the status bar, its price calculation, and the `/bytefly` toggle; `separator/`,
  `picker/`, and `doctor/` are otherwise unchanged. No configuration, command, or
  rendering behaviour changes.
- `themes`: `nocturne-dark` and `nocturne-light` are renamed `bytefly-dark` and
  `bytefly-light` (file names, the `name` field, and the README selectors). An
  existing `theme` setting or `--use-theme` value must be pointed at the new
  name; `"bytefly-light/bytefly-dark"` keeps the automatic light/dark switching.
- `subagent`: a `chain` is capped at 8 steps, matching the parallel task cap; an
  over-long chain is rejected before any process starts.
- `goal`: `/goal` argument completion now offers `achieved` and `-h`/`--help`,
  which the parser already accepted.
- `wechat`: `/wechat login` now starts the bridge on a confirmed scan instead
  of leaving the user to discover and run a second `/wechat start`. That command
  remains for reconnecting after `/wechat stop` or when the automatic connect
  fails (for example, another session holds the poller lock).
- `wechat`: a session that expires while the bridge is running keeps an
  error-colored `✆ wechat expired` status chip instead of the chip vanishing,
  and `/wechat start` / `/wechat status` route the user to the one-step
  `/wechat login` recovery. An explicit stop or logout clears it.
- `wechat`: remote-prompt hints are bilingual (Chinese and English), and an
  unrecognized reply now re-sends the prompt with a short “didn’t recognize
  that” notice instead of repeating it silently.
- `web-access`: `web_fetch` takes a single required `url` again. The `urls[]`
  batch, `formatBatch`, and the `{ pages: [...] }` output wrapper are gone, so
  one call renders one page without a `### <url>` heading; `web_search` now
  labels its answer, shows one URL per result, and keeps a snippet hidden until
  the result is expanded.

### Removed

- Removed the `scripts/` development checks. `transpile`, `smoke`, and
  `prompt-budget` no longer exist, and `bun run check` now runs `format:check`,
  `typecheck`, and `test`. The real-runtime package load, the per-extension
  lifecycle smoke run, and the tool-prompt size budget are gone;
  `test/prompt-budget.test.ts` still covers the injected-context ceilings.
- `bytefly`: the `chrome.json` migration and read fallback are gone; the footer
  reads only `bytefly.json`. Rename an existing `chrome.json` to `bytefly.json`
  to keep a saved price configuration.
- `turn-separator`: absorbed into `bytefly`, which now draws the labeled turn
  rule itself. The rule renders the `bytefly-separator` entry type, so
  separators recorded as `turn-separator` no longer render, and
  `PI_DISABLED_EXTENSIONS=turn-separator` no longer suppresses the rule; use
  `bytefly` instead.
- `extension-picker`: absorbed into `bytefly`, which now owns the
  `/extensions` command and the picker's discovery, toggle, and dock screen.
  The retired `PI_DISABLED_EXTENSIONS=extension-picker` name no longer has an
  effect; use `bytefly`, `/bytefly`, or `pi config`.

### Fixed

- `subagent`: a delegated run now starts in the active worktree root rather than
  the parent's recorded cwd, so a subagent no longer reads or writes the main
  checkout when the child does not load the worktree extension.
- `subagent`: a child terminated by a signal (an OOM kill, a crash) is reported
  as a failure naming the signal instead of a clean exit 0 with no output.
- `job`: a `detached` POSIX job now writes its own output straight to its log
  file and is unrefed, so it keeps logging and survives the session ending
  instead of losing output (and risking SIGPIPE) when the parent's pipe closes.
- `job`: the durable registry is keyed by the session cwd rather than the active
  worktree root, so entering or leaving a worktree mid-session no longer moves
  the registry out from under the jobs already recorded there.
- `job`: a `wake` completion is marked reported only after the wake send
  succeeds, so a failed send no longer drops it from the next turn.
- `job`: a reattached `wake` job that finishes is now settled by the repaint
  poll with its one wake turn, instead of only being reported at the next turn.
- `worktree`: the `PI_WORKTREE_*` environment is re-exported when a session
  restores a worktree and cleared on session shutdown, so peer extensions and
  child processes no longer follow a stale or non-isolated root after `/new`,
  `/resume`, or `/continue`.
- `worktree`: the shell guard refuses an exported `GIT_DIR`/`GIT_WORK_TREE` that
  leaves the worktree and treats `sh -c`/`bash -c` as unparsable when
  `blockUnparsableCommands` is enabled.
- `plan`: exiting plan mode after navigating the session tree now restores the
  tools of the branch it was left on rather than the previous branch's, so
  `write`/`edit` are not lost and a tool the target branch never had is not
  re-activated.
- `todo`: the lag reminder now appends to the boundary's proposed entries
  instead of replacing them, so it no longer discards another extension's pending
  `agent_before_settle` entries (and is no longer discarded by one that runs
  after it).
- `todo`: the result renderer no longer throws when a call is rejected before
  `execute` — host argument validation and blocked calls carry `details: {}` —
  and falls back to the error message.
- `todo`: a failed or blocked tool call no longer counts as work for the lag
  reminder, so a run that changed nothing is not forced into an extra request.
- `plan`: an approved plan whose steps the `todo` tool rejects now reports that
  tool's reason in the approval message instead of claiming it is unavailable.
- `goal`, `todo`, `memory`, `wechat`, `question`, `subagent`, `bytefly/doctor`,
  `plan`: a tool call Pi rejects before `execute` — argument validation or a
  permission block, which arrives as `details: {}` — now renders the host's
  message instead of a misleading clear, a blank result, or a renderer throw.
- `goal`: `/goal edit <text>` and `/goal set <text>` record the text without
  starting a run; previously `edit <text>` fell through to the free-form prompt
  path and started the work on the literal string.
- `goal`: replacing an active goal with `/goal <prompt>` or `/goal raw <prompt>`
  now asks for confirmation first.
- `goal`: a failed or unusable comprehension call tells the user it is keeping
  their wording, instead of silently prefilling the editor.
- `goal`: `/goal done` on an already achieved goal is a no-op with an info
  notice instead of re-persisting the entry.
- `goal`: a restatement containing braces is kept as plain text instead of being
  mistaken for a failed JSON reply, and a `}` inside a JSON string no longer ends
  the object early.
- `goal`: a free-form answer is sanitized to one line before it is folded into
  the goal.
- `ask_user_question`: question text, tab headers, option labels and
descriptions, and the selection summary are sanitized to one safe line before
rendering, so model-authored control characters cannot reach the terminal.
- `job`: a model-supplied id in an error line and an unknown action in the call
  line are sanitized before rendering.
- `subagent`: agent and tool names are sanitized before rendering, the collapsed
  result leads with the block separator blank line, and `Step` is capitalized
  consistently with the expanded view.
- `doctor`: a disabled extension shows a neutral `∅` instead of a green check,
  and a degraded row's summary is colored `warning` to match its glyph.
- `bytefly`: the picker's dirty line reads `Saved · reload to apply`, since
  each toggle is already persisted and only a reload is pending.
- `bytefly`: `/bytefly status` reports `on`/`off` instead of `footer`/`disabled`.
- `rewind`: the list no longer over-reserves a row, unselected rows use `muted`
  so the code-snapshot marker reads, and the hint names the navigation keys.
- `plan`: the approve hint says approval also runs the plan.
- `bytefly`: a compacted status keeps its own colour instead of losing it exactly
  when the bar tightens; an alert (a failed job) sorts ahead of the modes, and
  the status slot is droppable, so a narrow bar drops it rather than truncating
  the model.
- `bytefly`: the session name is bracketed and `muted` (was `dim`), the branch
  uses a neutral token (was the unrelated `customMessageLabel`), and a missing
  model reads `no model` in `muted` (was an accent-coloured `no-model`).
- `job`: `d` on a finished job and `x` with nothing finished now say so instead
  of a silent no-op; the log pane subheader shows whether the view is
  `following` the tail or `paused`; the list and log hints name their working
  aliases.
- `doctor`: a re-probe shows `refreshing…` and a second `r` is ignored while one
  is in flight, so probes cannot stack.
- `plan`: the scroll gauge stays visible while the inline refine editor is open,
  since the body above it is still clipped.
- `ask_user_question`: `Space` on the `Other` row opens the editor instead of a
  silent no-op.
- `goal`, `todo`, `memory`, `wechat`: a tool error line sanitizes its message
  before rendering, matching `job` and `subagent`, so a probe- or
  model-authored control character cannot reach the terminal through an error.
- `file-browse`: a directory page has an `<h1>` (the table is labelled by it),
  listing and tree rows show a focus ring and not only hover, the sort buttons
  are made non-interactive under `noscript`, the copy buttons announce
  `Copied to clipboard` / `Copy failed` through a live region, and the
  quick-open input has its own label. The README now describes the served
  palette accurately instead of claiming the `nocturne` themes.
- `web-access`: `web_fetch` drops credentials when a redirect leaves the
  original origin, matching the Fetch spec, so an `Authorization`, `Cookie`, or
  `Proxy-Authorization` header is no longer forwarded to another host.

## [0.5.1] - 2026-10-13

### Added

- `file-browse`: `.md`/`.markdown` files render as formatted Markdown
  (headings, lists, tables, code, links, images) with a server-rendered
  Rendered/Raw switch (`/view/<rel>?raw=1`). The renderer is first-party and
  escape-first, so raw HTML and unsafe URL schemes (`javascript:`, `data:`) are
  neutralized and external images are shown as links instead of loaded.
- `file-browse`: directory listings sort by Name/Size/Modified (directories
  first) and the choice is remembered per browser.
- `file-browse`: file pages copy the root-relative path or the file contents,
  and text/raw views toggle line wrapping.
- `file-browse`: a quick-open palette (`/` or `Ctrl/Cmd+K`, or the sidebar
  button) fuzzy-searches a capped index of the served tree and opens the chosen
  file. The index skips `.git`, `node_modules`, and symlinks, is bounded by
  `maxIndexEntries`, and is cached per server; results highlight the matched
  characters and the palette is keyboard- and screen-reader-accessible.

### Changed

- `job`: `start` results badge `detached` and `wake`, so the job's lifetime and
  wake behaviour are visible without reading the arguments.
- `plan`: the review screen renders the plan with Pi's Markdown theme (headings,
  lists, code, links, quotes) and colors task checkboxes (`[✓]` done, `[ ]`
  pending). A step-progress gauge row shows `n/m steps done`, the scroll row is
  a gauge with the position and line range, and the footer colors the
  approve/refine actions.

### Fixed

- `job`: the transcript no longer renders the model-facing `logs` header as
  output; the rail shows the sanitized tail, and a job with no output yet shows
  `No output yet.`
- `job`: a `kill` result confirms the signal sent (`· SIGTERM sent`) instead of
  redisplaying the job's pre-kill running row.

## [0.5.0] - 2026-10-13

### Added

- `goal`: `/goal <prompt>` classifies the prompt with one clarifier call on the
  session model. A clear goal is confirmed or edited, then recorded and run. An
  unclear goal is delegated to the agent, which asks up to three clarifying
  questions with `ask_user_question` before recording the clarified goal itself.
  Classification is best-effort (a failure falls back to the typed text), needs a
  dialog UI and a model, and a dismissed dialog cancels the command. The `goal`
  tool remains the silent setter.

### Changed

- `goal`: `/goal <prompt>` now sets the goal *and* starts the agent on it,
  instead of only recording the objective.

### Removed

- `prompt`: removed the extension. Ordinary user prompts are no longer refined,
  and the structured question/answer flow and `prompt.json` are gone; prompt
  refinement now happens only for `/goal <prompt>`.

## [0.4.0] - 2026-10-12

### Added

- `prompt`: refine a submitted prompt before the agent acts on it. One clarifier
  call on the session model decides whether the request is clear; when it is
  not, structured dialogs collect the goal and answers and the agent receives
  the original wording plus both. Configured by `prompt.json`;
  `/prompt refine [on|off|status]` toggles it for the session, and any failure
  or cancellation submits the original prompt unchanged.
- `status-bar`: the cost segment can be calculated from your own rates.
  `status-bar.json` maps `provider/model` (with wildcards) to per-million-token
  prices in the currency you choose, with an optional peak/off-peak schedule
  evaluated against each entry's own timestamp. DeepSeek's published yuan rates
  and peak tariff ship as the default table, so a DeepSeek session is priced
  correctly with no file at all, while a model with no matching rate keeps Pi's
  recorded cost. Internally the extension is now a `collect → price → render`
  pipeline.
- `doctor`: reports whether each extension has what it needs at runtime — external
  binaries on `PATH`, optional npm packages,
  login/state files, and config files that fail to parse. Each extension declares
  its prerequisites in `lib/requirements.ts`, so the same table feeds the
  `/doctor` command, the read-only `run_doctor` tool, and one warning at session
  start when an enabled extension cannot work. Malformed config is now named
  instead of silently ignored, and the install hints `document` and `web-access`
  raise come from that table too.
- `file-explorer`: open or reveal a file or directory in the OS-native
  application. `/open [path]` handles the interactive case (`/open -r <path>`
  reveals it in the file manager), and the `codemode`-exposed `open_path` tool
  does the same from a script; both resolve the path against the effective
  working directory.
- Always-on prompt budget: `scripts/prompt-budget.ts` reports each tool's
  model-facing size (description + parameter schema, snippet, and guidelines)
  and `bun run prompt-budget:check` fails past a pinned ceiling; it runs as the
  last step of `bun run check`, and `test/prompt-budget.test.ts` pins the
  per-turn injected-context sizes.

### Changed

- `status-bar`: DeepSeek pricing is now the default rather than an opt-in, so
  `currency` defaults to `¥` — the unit of the built-in rates. A session that
  mixes DeepSeek with a provider the table does not cover sums yuan and dollars
  into one number until the currency or a rate is configured. A wrong-typed
  `peak.windows` now keeps the configured windows instead of silently flattening
  the tariff to a single rate.
- `extension-picker`: the `/extensions` list is now scannable and honest about
  the active scope. It hides the picker's own entry, dims disabled rows, shows
  each source group's extension count, and prints the focused extension's full
  path. The summary leads with the accented Global/Project scope, rapid
  `Space`/`Enter` presses toggle once each instead of dropping the second, and
  `Tab` lands on a real row. The hint row and dirty line are reworded.
- Put every tool's model-facing prompt on one contract: the `description`
  states the contract, `promptGuidelines` state when and how to use it, and
  neither repeats the other. `subagent` no longer tags agents with their
  internal source, `job` spells out both bounds of `timeoutMs`, `plan` says
  "the only file write is `write_plan`", and `ask-user-question` documents
  `multiSelect`. A smoke check now requires a `promptSnippet` on every tool this
  package registers.
- Trimmed the always-on model context: each tool's `description` and
  `promptGuidelines` no longer restate each other, parameter docs and snippets
  are shorter, `subagent`'s description lists built-in agents by name only, and
  the plan-mode, goal, and worktree injections are shorter. The active tool set
  is ~23% smaller (~1,000 tokens per request), and the plan-mode context is down
  about half.

### Removed

- `web-access`: the optional `playwright` JavaScript-rendering path in
  `web_fetch`. The `render` parameter, the `renderJs`, `renderTimeoutMs`,
  `renderWaitUntil`, `renderMinChars`, and `renderExecutablePath` config keys,
  the `rendered` output field, and the `playwright` prerequisite `doctor`
  reported are gone; `unpdf` PDF extraction, paging, `find`, and the page cache
  are unchanged.
- The `keep-awake` extension. It held a transient OS inhibitor (`caffeinate` /
  `systemd-inhibit` / `SetThreadExecutionState`) with a `/keep-awake` command and
  a `✦` status chip; the feature is no longer used.
- The `lib/wake-hold.ts` cross-extension wake-hold contract, along with the
  holds the WeChat bridge announced on it — `keep-awake` was the only subscriber,
  so the mechanism had nothing left to drive.

### Fixed

- Untrusted single-line text reaches a widget through one shared boundary
  (`lib/format.ts`'s `sanitizeLine`): `sanitize` collapsed whitespace but left
  ESC, BEL, and the C1 block in place, and pi-tui's `truncateToWidth` keeps ANSI
  sequences, so a filename, a prompt summary, a stored note, or the session name
  could still send an escape to the terminal. The status bar's own strip removed
  SGR only; it now parses away a CSI or OSC sequence too.
- `doctor`: each extension's `git` check is described in its own terms, so
  `file-browse` no longer reports "worktrees, rewind snapshots, project-scope
  memory, and the branch chip" as its requirement, `document` no longer declares
  a `git` check it never uses, and the missing-check glyph (U+2715) is no longer
  an East-Asian-ambiguous character that some terminals draw two columns wide.
- Config: a value that is not a number (`null`, an empty string, `true`, an
  array) is ignored instead of clamped to the field's minimum.
- `subagent`: launching a nested `pi` no longer reads a user argument as an entry
  script, which broke delegation from a single-file build.

## [0.3.1] - 2026-10-10

### Removed

- npm publish configuration (`.npmignore` and `publishConfig`). Distribution is
  git-only through `pi install git:github.com/gavin-hu/my-pi-agent@vX.Y.Z`, and
  a release is an annotated `vX.Y.Z` tag plus a GitHub release.

## [0.3.0] - 2026-10-10

### Added

- `memory`: durable cross-session notes stored as human-editable markdown — a
  global file under the agent directory and a project file under the repository
  root's `.pi/`. The `memory` tool adds, forgets, or lists notes; stored notes
  are injected as a hidden `[MEMORY]` context before each run; `/memory` lists,
  edits, or clears a store. Project notes load and write only for a trusted
  project, text is sanitized at the boundary, and writes are read-modify-write
  under the host file-mutation queue and land atomically.
- `doc`: `read_doc` now extracts `.xlsx` spreadsheets through the
  `gridcraft-cli` executable. Every worksheet becomes a `[Sheet]` heading
  followed by tab-separated rows, values use the workbook's displayed text, and
  legacy `.xls` gets a conversion hint.
- `document`: `read_doc` now reads legacy `.doc`, `.odt`, and `.rtf` through the
  same `wordcraft-cli` backend as `.docx`. All four are pageable like any other
  format, and the legacy `.doc` conversion hint is gone.
- `todo`: when a run is about to settle after mutating work (`write`, `edit`,
  `bash`, `powershell`, or a tool declaring `readOnlyHint: false`) without a
  todo update, the extension injects one hidden reminder and forces a single
  continuation, so the list does not drift behind the work. It fires only while
  the list has unfinished items, at most once per user turn, and is dropped
  on the next user turn.
- `keep-awake`: hold a transient OS inhibitor while Pi works so the machine does
  not sleep mid-run. `caffeinate` on macOS, `systemd-inhibit` on Linux, and
  `SetThreadExecutionState` on Windows, each self-terminating when Pi exits.
  `auto` (the default) engages only between `agent_start` and `agent_settled`,
  `always` keeps the whole session awake, and `/keep-awake on|off|auto|status`
  overrides it per session. Shows a `✦` status chip while held; configured
  through `keep-awake.json` (`mode`, `keepDisplay`). Other extensions request a
  wake hold through `lib/wake-hold.ts`, so a long poll can keep the machine
  awake too.
- `wechat`: a thin bridge between the live Pi session and WeChat over Tencent's
  Weixin iLink bot API. An inbound text, image, or file becomes a real user turn
  in that session, with images attached as model image content and files saved
  under `<agent-dir>/wechat/media/` and referenced by path; the reply is sent
  back with a native typing indicator. `/wechat login|start|stop|status|logout`
  manages the connection and the `✆ wechat` status chip, the owner-only
  `send_wechat` tool lets the model message the owner proactively, and
  interactive confirmations raised during a WeChat turn (including plan
  approval) are answered over WeChat. Owner-only by default (`allowedPeers`
  opts in others), and the bridge runs only while the session is alive —
  holding the machine awake through the shared wake hold while it polls.
- `extension-picker`: an `/extensions` dock screen listing every resolved Pi
  extension across all configured packages and settings. `Space`/`Enter`
  toggles one, writing `+pattern`/`-pattern` into the selected `settings.json`;
  `Tab` switches the write scope between Global and Project; changes apply on
  reload.

### Changed

- `document`: the `doc` extension is renamed to `document` — the directory,
  package manifest entry, `PI_DISABLED_EXTENSIONS` name, and docs. Its config
  file is now `document.json`; an existing `doc.json` is ignored, so rename it
  by hand. The `read_doc` tool, its schema, paging, and rendering are unchanged.
- `doc`: `read_doc` extracts `.pdf` and `.docx` by running `pdfcraft-cli` and
  `wordcraft-cli` instead of the in-process `unpdf` and `mammoth` packages, and
  `.xlsx` likewise through `gridcraft-cli`. The extension now ships no document
  parser, a missing executable's error names its `cargo install --git …`
  command, and `mammoth` and `read-excel-file` are no longer dependencies. The
  tool's schema, paging, confinement, and transcript rendering are unchanged.
- `subagent`: the running glyph animates with a braille spinner while a
  delegated agent works.

### Fixed

- `plan`: the read-only git shell guard accepts Windows path separators (a
  backslash before an ordinary character) instead of refusing every backslash,
  so read-only git commands through Git Bash work on Windows. A backslash that
  escapes a metacharacter, whitespace, a quote, another backslash, or ends the
  command is still blocked, and `powershell` remains unavailable.
- `web-access`: a paged `web_fetch` result keeps its `startIndex` hint inside its
  character budget instead of having the batch formatter cut it, and the offset
  is repeated as `nextIndex` in `structuredContent`. A multi-URL call keeps whole
  pages with a `(showing K of N pages)` note rather than cutting a section
  mid-way, and `find` reports `matchesTruncated` when `maxMatches` caps the list.

## [0.2.0] - 2026-10-09

### Added

- `doc`: a `read_doc` tool that extracts plain text from a local `.pdf` or
  `.docx` under the effective working directory, paged with `startIndex` /
  `maxChars` and guarded like the built-in path tools. PDF extraction uses the
  optional `unpdf` package and DOCX the optional `mammoth` package, both loaded
  lazily with a clear install hint when missing. Formats are table-driven, so
  more are additive. `lib/path.ts` now shares `realPathOfNearest` /
  `isInsideReal` with the worktree guard.
- `env`: `PI_DISABLED_EXTENSIONS` (comma- or whitespace-separated extension
  names, case-insensitive) loads the package without the named extensions, so a
  session can omit one without uninstalling it.

### Changed

- Every tool's transcript row was reworked for consistency: a blank line
  separates a header from a multi-line body while single-line status rows stay
  flush, hidden content ends with the `app.tools.expand` hint, and renderers
  reuse `context.lastComponent` instead of allocating each frame. Per row:
  `read_doc` leads with the format and a humanized range instead of repeating
  the path and previews the text when expanded; `todo` shows progress and the
  active item on the call line; `job list` renders the `/jobs` row rail and
  `job logs` a themed tail; `subagent` separates its header from the body and
  binds its expand hint; `plan` separates the plan body from its header;
  `ask_user_question` lists one option line per question; `web_search` expands
  to every title.
- `file-browse`: the `/browse` UI fills the window — a full-height app shell
  with independently scrolling sidebar and content panes (mobile keeps normal
  page scroll).

### Fixed

- `web-access`: search answers/titles and fetched page titles/errors are
  stripped of control characters and ANSI sequences before reaching the
  terminal, so a page cannot restyle or corrupt it.
- `job`: `job list` honours the expanded state (`ctrl+o`) instead of always
  capping at eight rows; capped `todo` and `job` results now advertise the
  expand key.

## [0.1.0] - 2026-10-09

Initial public release: a personal collection of Pi customizations packaged as
one installable Pi package.

### Added

- `worktree`: isolated `git worktree` lifecycle through `enter_worktree` /
  `exit_worktree` / `prune_worktrees` / `list_worktrees`, the `/worktree*`
  commands, and `--worktree <name>`. It rebinds the built-in path tools to the
  worktree and guards file and shell escapes. A disposable managed-worktree
  registry (`.pi/worktrees/index.json`) records provenance and last use;
  `list_worktrees` shows derived dirty/ahead/behind/merged/locked state, and
  `/worktree prune` ages worktrees by last use.
- `rewind`: automatic per-prompt working-tree snapshots plus `/rewind`, which
  lists every prompt on the active branch and restores the **code**, the
  **conversation**, or **both**. Snapshot metadata records the `sessionId` and
  the conversation `entryId` each snapshot precedes, so code and conversation
  rewind share one timeline; the abandoned branch is preserved.
- `plan`: read-only planning through `enter_plan_mode` / `write_plan` /
  `exit_plan_mode`. Plans are saved under `.pi/plans` and approved before
  execution (`--plan` to start, `/plan` toggles, `Ctrl+Alt+P`). Plan mode allows
  `bash` only for read-only git commands, forces `readOnly: true` on `subagent`
  delegation, and blocks `powershell`.
- `subagent`: delegate to a specialized agent (`explorer`, `planner`,
  `reviewer`, `worker`, `researcher`, `tester`, `debugger`, `documenter`) in its
  own `pi` process — single, parallel (max 8, 4 at once), or chained via
  `{previous}`. Optional user agents from `<agent-dir>/agents` and project agents
  from the nearest `.pi/agents` load from markdown frontmatter; `agentScope`
  selects the directories consulted, and an untrusted project is confirmed or
  refused. A `readOnly` parameter runs every spawned agent with a reader-only
  tool list.
- `job`: run long-lived shell commands in the background through `job`
  (`start` / `list` / `status` / `logs` / `kill` / `wait` / `clear`), `/jobs`,
  and the `▸ N` running / `✗ N` failure status chips. `start.timeoutMs`
  auto-kills a job that runs past its deadline.
- `file-browse`: `/browse` starts a read-only local HTTP server on a port fixed
  for the session, rooted at the working directory, and opens a two-pane tree
  browser — a collapsible path tree, directory listings, text pages with a line
  gutter, images, and download cards, plus image thumbnails, per-language icons,
  a client-side path filter, and a git header. It binds `127.0.0.1` only.
- `web-access`: `web_search` (keyless DuckDuckGo by default; `search.provider`
  selects DuckDuckGo, a self-hosted SearXNG JSON instance, or the Brave Search
  API) and `web_fetch` (GET/POST with optional headers and body, redirect
  handling with per-hop SSRF checks, paging and `find`, and optional PDF
  extraction through `unpdf` and JS rendering through `playwright`).
- `ask-user-question`: ask the user one or more structured questions (labelled
  options plus a free-form "Other") and wait for the answer.
- `todo`: a whole-list task list (`pending`/`in_progress`/`completed`) with a
  one-line rail widget and `/todos`. The tool declares an `outputSchema` and
  returns `structuredContent`, so scripts and codemode can read it as data.
- `goal`: a persistent session objective (`active`/`achieved`) shown in a
  one-line rail widget and restated before each turn, with
  `/goal [text|clear|done]` and an `outputSchema`/`structuredContent` result.
- `status-bar`: a two-line colorful footer — pwd + git state + browse chip, then
  context gauge + usage + mode/alert + model + thinking level — toggled with
  `/status-bar`.
- `turn-separator`: a labeled dashed line between completed turns
  (`╌╌╌ turn N ╌╌╌`), rendered from an inert custom entry and TTY-only.
- `nocturne-dark` and `nocturne-light` themes, with
  `nocturne-light/nocturne-dark` auto-switching.

### Changed

- `web-access`: `web_search` is pluggable and works with no configuration. Under
  `"auto"` the first configured non-default provider wins, then DuckDuckGo — one
  provider, no failover. `search.language`, `safeSearch`, and `categories` apply
  to SearXNG only.
- `job`: the registry is one file per session (`registry-<sessionHash>.json`),
  so concurrent sessions in one project cannot clobber each other. Loading
  merges every session file and adopts a dead session's records; job ids are
  reserved atomically with an `O_EXCL` lock. `/jobs`, `job list`, and both
  chips are session-scoped. A POSIX job writes `$?` to a per-job status file so
  a reattached job reports its real exit code.
- `plan`: a `bash` call may chain multiple read-only git commands with `&&` or
  `;`, with every segment validated independently (pipes, substitution,
  redirection, and `||` remain blocked), and a refused call explains the fix.
  The `readOnlyHint` path backstop scans arguments recursively and recognizes
  path-key words and path-shaped values.
- `goal`, `todo`, and `job` share one rail family: label-first one-line widgets
  in a stable `goal` → `todo` → `job` order, hidden while a dock screen
  (`/todos`, `/jobs`, `/rewind`) is open.
- `subagent`: every built-in agent uses an explicit tool allowlist, so `worker`
  can no longer recurse into `subagent` and `explorer` no longer has `bash`. The
  delegated/headless `planner` stays separate from interactive plan mode.
- `todo`: the tool returns a compact progress/current-item result instead of
  echoing the list, and an `in_progress` item requires a non-blank `activeForm`.
- `goal`: the `achieved` widget config takes `show`/`hide` (default `hide`).
- `rewind`: the `↺ N` chip counts every prompt on the active branch, matching the
  `/rewind` list; the per-row code-snapshot marker is `◆`.
- `status-bar`: the context gauge floors its fill and stays in the neutral color
  below the warn threshold, and the line-1 git state shows a worktree fork.
- Cross-platform: CI runs the full `bun run check` on Ubuntu, Windows, and macOS
  (`fail-fast: false`), and the test suite is portable — native real paths, no
  POSIX path literals, and symlink tests skipped when the host cannot create
  symlinks.

### Fixed

- `job`: the default registry directory is resolved under the agent dir
  (`PI_CODING_AGENT_DIR`) instead of a hardcoded `~/.pi/agent/jobs`, and a live
  peer session's unreported failure no longer pins this session's `✗ N` chip.
- `job`: the `/jobs` "clear finished" confirmation no longer counts jobs it will
  not remove and warns when unreported completion reports will be discarded.
- `job`: the cross-session registry race is gone (per-session files plus atomic
  id reservation), and a reattached POSIX job recovers its exit code from a
  status file instead of settling as `unknown`.
- `job`: `/jobs` tracks selection by job id and pins its log pane, so the live
  running-first re-sort cannot move the cursor; `d`/`K` and `x` confirm before
  acting; the log pane repaints only when the tail changes; the repaint clock
  parks while a dock screen is open; `wait` shows a `Waiting on <id>…` row.
- `job`: the footer chip shows `▸N·✗N` when jobs are running and an unreported
  failure waits, and the running chip is re-published on every repaint tick.
- `goal`: `/goal clear` reports "No goal set." when nothing is set, `/goal
  achieved` is a synonym for `done`, an unknown status is rejected, an empty
  objective with `status: "achieved"` is rejected, and `getGoal()` returns a
  copy.
- `todo`: the `/todos` screen re-renders when the list changes while it is open.
- `worktree`: a `name` that resolves outside the managed worktree directory is
  refused; the built-in tool overrides keep their renderers and `edit`'s
  `prepareArguments`; `exit_worktree` reports `removed` from the actual removal.
- `worktree`: the bash isolation guard keeps backslashes in unquoted/Windows
  paths and resolves real paths natively, catches `cd -P`/`cd --`/`pushd -n`
  option forms, `>&file` redirects, and `git -c core.worktree=`, and no longer
  mistakes a `GIT_DIR=` argument for a redirect.
- Cross-platform runtime paths: git's `--show-toplevel` output is canonicalized
  to the native real path, and plan containment and the browse guard resolve
  symlinks with `realpathSync.native`. A traversal check accepts an in-tree
  sibling whose name merely starts with `..` (for example `..notes`).
- `subagent`: `shortenPath` normalizes separators before replacing the home
  prefix, so a Windows home shortens to `~` for `/`-separated paths too.
- Windows: the smoke script waits for a background job to exit before removing
  the worktree it ran in, and the rewind end-to-end test seeds its snapshot with
  the native repo root.

[Unreleased]: https://github.com/gavin-hu/my-pi-agent/compare/v0.15.0...HEAD
[0.15.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.15.0
[0.14.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.14.0
[0.13.1]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.13.1
[0.13.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.13.0
[0.12.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.12.0
[0.11.4]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.11.4
[0.11.3]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.11.3
[0.11.2]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.11.2
[0.11.1]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.11.1
[0.10.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.10.0
[0.9.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.9.0
[0.8.1]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.8.1
[0.8.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.8.0
[0.7.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.7.0
[0.6.1]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.6.1
[0.6.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.6.0
[0.5.1]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.5.1
[0.5.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.5.0
[0.4.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.4.0
[0.3.1]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.3.1
[0.3.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.3.0
[0.2.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.2.0
[0.1.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.1.0
