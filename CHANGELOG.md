# Changelog

All notable changes to this package are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `bytefly`: the two-line, width-adaptive footer formerly shipped as
  `status-bar` and then `chrome`, replacing Pi's built-in footer while leaving
  its header alone. The footer keeps pwd + session name + git branch/worktree +
  serve chip on line 1 and the context gauge + usage + mode/alert + model +
  thinking level on line 2; `/bytefly [status]` toggles it. The display name,
  command, extension directory, and config file are all `bytefly` now, and a
  legacy `chrome.json` is migrated to `bytefly.json` on load.

- `goal`: a bare `/goal` with no goal set shows the command usage instead of
  only `No goal set.`, and `/goal help` (or `-h` / `--help`) shows it at any
  time, so a first-time user can discover how to set and manage a goal without
  the README.
- `file-browser`: code files render with first-party syntax highlighting in the
  text view, and fenced code blocks in the rendered Markdown view are
  highlighted too (keywords, strings, numbers, comments, and markup) for
  JavaScript/TypeScript, JSON, CSS (incl. SCSS/Sass/Less), HTML/XML and
  template components, shell, Python, Java, YAML, and SQL. The tokenizer is
  escape-first and dependency-free, so it works without JavaScript and unmapped
  file types or fence languages stay plain.
- `file-browser`: a header theme toggle switches between the dark and light
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

### Changed

- `document`: `read_doc` extracts every format in process instead of shelling
  out to the `pdfcraft-cli` / `wordcraft-cli` / `gridcraft-cli` executables. PDF
  uses `unpdf`, DOCX `mammoth`, legacy DOC `word-extractor`, ODT `fflate` plus
  `fast-xml-parser`, RTF `rtf-parser`, and XLSX `exceljs`. The libraries ship as
  dependencies and load lazily on first read, so `read_doc` needs no per-format
  install step, `doctor` no longer probes for the three binaries, and every
  format keeps the same paged output.
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

### Removed

- `turn-separator`: absorbed into `bytefly`, which now draws the labeled turn
  rule itself. The rule renders the `bytefly-separator` entry type, so
  separators recorded as `turn-separator` no longer render, and
  `PI_DISABLED_EXTENSIONS=turn-separator` no longer suppresses the rule; use
  `bytefly` instead.

### Fixed

- `goal`: `/goal edit <text>` and `/goal set <text>` record the text without
  starting a run; previously `edit <text>` fell through to the free-form prompt
  path and started the work on the literal string.
- `goal`: replacing an active goal with `/goal <prompt>` or `/goal raw <prompt>`
  now asks for confirmation first.
- `goal`: a failed or unusable comprehension call tells the user it is keeping
  their wording, instead of silently prefilling the editor.
- `goal`: a live goal is re-appended as a `goal` entry after compaction, so it
  survives a branch whose tool-result details were summarized away.
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
- `extension-picker`: the dirty line reads `Saved · reload to apply`, since each
  toggle is already persisted and only a reload is pending.
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
- `file-browser`: a directory page has an `<h1>` (the table is labelled by it),
  listing and tree rows show a focus ring and not only hover, the sort buttons
  are made non-interactive under `noscript`, the copy buttons announce
  `Copied to clipboard` / `Copy failed` through a live region, and the
  quick-open input has its own label. The README now describes the served
  palette accurately instead of claiming the `nocturne` themes.

## [0.5.1] - 2026-10-13

### Added

- `file-browser`: `.md`/`.markdown` files render as formatted Markdown
  (headings, lists, tables, code, links, images) with a server-rendered
  Rendered/Raw switch (`/view/<rel>?raw=1`). The renderer is first-party and
  escape-first, so raw HTML and unsafe URL schemes (`javascript:`, `data:`) are
  neutralized and external images are shown as links instead of loaded.
- `file-browser`: directory listings sort by Name/Size/Modified (directories
  first) and the choice is remembered per browser.
- `file-browser`: file pages copy the root-relative path or the file contents,
  and text/raw views toggle line wrapping.
- `file-browser`: a quick-open palette (`/` or `Ctrl/Cmd+K`, or the sidebar
  button) fuzzy-searches a capped index of the served tree and opens the chosen
  file. The index skips `.git`, `node_modules`, and symlinks, is bounded by
  `maxIndexEntries`, and is cached per server; results highlight the matched
  characters and the palette is keyboard- and screen-reader-accessible.

### Fixed

- `job`: the transcript no longer renders the model-facing `logs` header as
  output; the rail shows the sanitized tail, and a job with no output yet shows
  `No output yet.`
- `job`: a `kill` result confirms the signal sent (`· SIGTERM sent`) instead of
  redisplaying the job's pre-kill running row.

### Changed

- `job`: `start` results badge `detached` and `wake`, so the job's lifetime and
  wake behaviour are visible without reading the arguments.
- `plan`: the review screen renders the plan with Pi's Markdown theme (headings,
  lists, code, links, quotes) and colors task checkboxes (`[✓]` done, `[ ]`
  pending). A step-progress gauge row shows `n/m steps done`, the scroll row is
  a gauge with the position and line range, and the footer colors the
  approve/refine actions.

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
  `file-browser` no longer reports "worktrees, rewind snapshots, project-scope
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
- `file-browser`: the `/serve` UI fills the window — a full-height app shell
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
- `file-browser`: `/serve` starts a read-only local HTTP server on a port fixed
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
- `status-bar`: a two-line colorful footer — pwd + git state + serve chip, then
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
  to the native real path, and plan containment and the serve guard resolve
  symlinks with `realpathSync.native`. A traversal check accepts an in-tree
  sibling whose name merely starts with `..` (for example `..notes`).
- `subagent`: `shortenPath` normalizes separators before replacing the home
  prefix, so a Windows home shortens to `~` for `/`-separated paths too.
- Windows: the smoke script waits for a background job to exit before removing
  the worktree it ran in, and the rewind end-to-end test seeds its snapshot with
  the native repo root.

[Unreleased]: https://github.com/gavin-hu/my-pi-agent/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.5.1
[0.5.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.5.0
[0.4.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.4.0
[0.3.1]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.3.1
[0.3.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.3.0
[0.2.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.2.0
[0.1.0]: https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.1.0
