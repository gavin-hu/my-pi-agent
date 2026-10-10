# @gavin-hu/my-pi-agent

A personal collection of [Pi](https://pi.dev) customizations, packaged as one
installable Pi package. Everything is discovered through the `pi` manifest in
[`package.json`](./package.json), so Pi loads only what is declared here.

![The Pi TUI with the extensions, status bar, and turn separators from this package loaded](./assets/screenshot.jpg)

## Install

```bash
pi install git:github.com/gavin-hu/my-pi-agent   # from git
pi install ./                                    # personal, from this checkout
pi install ./ -l                                 # project-local (.pi/settings.json)
pi -e .                                          # try it for a single run
```

Requires a working Pi installation. Bun and the dev dependencies are needed
only for the development tasks below.

## Contents

| Resource | Path | What it does |
|---|---|---|
| Extension | [`extensions/worktree/`](./extensions/worktree/) | `worktree`: isolated `git worktree` lifecycle — `enter_worktree` / `exit_worktree` / `prune_worktrees` / `list_worktrees`, `/worktree*`, and `--worktree <name>`, re-rooting the built-in path tools and guarding escapes. |
| Extension | [`extensions/rewind/`](./extensions/rewind/) | `rewind`: automatic per-prompt snapshots under `refs/pi/rewind` plus `/rewind` to restore code, conversation, or both, and a `↺ N` status chip. |
| Extension | [`extensions/ask-user-question/`](./extensions/ask-user-question/) | `ask_user_question`: ask the user one or more structured questions (labelled options + free-form “Other”) and wait for the answer. |
| Extension | [`extensions/todo/`](./extensions/todo/) | `todo`: a TodoWrite-style task list (whole-list replacement, `pending`/`in_progress`/`completed`) with a persistent one-line widget and `/todos`. |
| Extension | [`extensions/goal/`](./extensions/goal/) | `goal`: a persistent session objective (`active`/`achieved`) kept in a one-line widget and restated before each turn; `/goal [text\|clear\|done]`. |
| Extension | [`extensions/plan/`](./extensions/plan/) | `plan`: read-only planning via `enter_plan_mode` / `write_plan` / `exit_plan_mode`; plans are saved to `.pi/plans` and approved before execution (`--plan` to start, `/plan` toggles, `Ctrl+Alt+P`); `subagent` delegation is forced read-only and `powershell` is blocked. |
| Extension | [`extensions/subagent/`](./extensions/subagent/) | `subagent`: delegate a task to a specialized agent (`explorer`, `planner`, `reviewer`, `worker`, `researcher`, `tester`, `debugger`, `documenter`) running in its own `pi` process — single, parallel (max 8/4), or chained via `{previous}`, with optional user/project markdown agents and a `readOnly` mode that passes only reader tools to the child. |
| Extension | [`extensions/job/`](./extensions/job/) | `job`: run long-lived shell commands in the background (`job` tool: start/list/status/logs/kill/wait/clear; `/jobs`; `▸ N` running / `✗ N` failure chips) with sanitized log tails and shutdown/reconcile lifecycle. |
| Extension | [`extensions/web-access/`](./extensions/web-access/) | `web-access`: web access with two tools — `web_search` (general web search through a pluggable provider: keyless DuckDuckGo by default, optional SearXNG or Brave) and `web_fetch` (GET/POST a URL and read readable text, with paging, `find`, per-hop SSRF checks, and optional PDF/JS support); native `fetch`, one `web-access.json`. |
| Extension | [`extensions/file-browser/`](./extensions/file-browser/) | `file-browser`: `/serve` starts a read-only local HTTP server on a stable per-project port, rooted at the working directory, and opens a two-pane browser tree — listings, file views, image thumbnails, per-language icons, and a filter; `127.0.0.1` only, no dependencies, with a `⊙ <port>` status chip. |
| Extension | [`extensions/doc/`](./extensions/doc/) | `doc`: `read_doc` extracts plain text from a local PDF or DOCX (optional, lazily loaded `unpdf` / `mammoth`), paged with `startIndex`/`maxChars` and confined to the effective working directory. |
| Extension | [`extensions/status-bar/`](./extensions/status-bar/) | `status-bar`: a two-line colorful footer — pwd + git state + serve chip, then context gauge + usage + mode/alert + model + thinking level; width-adaptive, `/status-bar` toggles it. |
| Extension | [`extensions/turn-separator/`](./extensions/turn-separator/) | `turn-separator`: a labeled dashed line between completed turns — `agent_settled` appends an inert custom entry that an entry renderer draws as `╌╌╌ turn N ╌╌╌`; width-adaptive, TTY-only. |
| Extension | [`extensions/extensions-manager/`](./extensions/extensions-manager/) | `extensions-manager`: `/extensions` lists every resolved Pi extension across all configured packages and enables or disables one (Global or Project settings) by writing `settings.json`; changes apply on reload. |
| Theme | [`themes/nocturne-dark.json`](./themes/nocturne-dark.json) | `nocturne-dark`: a GitHub-inspired dark palette (deep blue-black canvas, cool gray text, blue accent, green/red/yellow status colors, purple/pink operators). |
| Theme | [`themes/nocturne-light.json`](./themes/nocturne-light.json) | `nocturne-light`: the light companion (white canvas, GitHub light accents), for `nocturne-light/nocturne-dark` auto-switching. |

More extensions, skills, and prompts can be added under the conventional
directories and listed in the `pi` manifest. Each extension ships its own
`README.md` under its directory for the full tool and command surface, the Pi
integration contract, and design notes.

### Theme notes

Select `nocturne-dark` or `nocturne-light` through `/settings` → **Theme**, or
use automatic light/dark switching with
`"theme": "nocturne-light/nocturne-dark"` (`pi --use-theme nocturne-dark` for a
one-off). Pi themes cannot set the terminal's background, so the live canvas
stays your terminal's color — set it to `#0d1117` for the intended look. HTML
exports use the theme's `export.pageBg`, so they are unaffected.

## Disabling extensions

Every extension in this package is on by default. Set `PI_DISABLED_EXTENSIONS`
to a comma- or whitespace-separated list of extension names to load the package
without them:

```bash
PI_DISABLED_EXTENSIONS=todo,job pi -e .
```

Names are the extension directories under [`extensions/`](./extensions/)
(`worktree`, `rewind`, `ask-user-question`, `todo`, `goal`, `plan`, `subagent`,
`job`, `web-access`, `file-browser`, `doc`, `status-bar`, `turn-separator`,
`extensions-manager`),
compared case-insensitively; unknown names are ignored. This is a package-local
switch: Pi still imports each entrypoint, but a disabled factory registers
nothing. To drop the whole package instead, use Pi's own `--no-extensions` or a
settings `-path` entry.

## Development

```bash
bun install
bun run test       # unit tests (bun test --parallel)
bun run typecheck  # tsc --noEmit
bun run format     # biome format --write .
bun run transpile  # bun build (--no-bundle) every extension
bun run smoke      # real-runtime package load + worktree enter/list/exit (no model call)
bun run check      # format:check + typecheck + transpile + tests + smoke
```

AI coding agents should read [`AGENTS.md`](./AGENTS.md) for the repo
conventions and the worktree-based branch flow.

### Cross-platform

The package and its checks run on Windows, macOS, and Linux; CI runs the full
`bun run check` on all three. `git` must be on `PATH`. Symlink-dependent tests
skip automatically when the host cannot create symlinks (unprivileged Windows
without Developer Mode), so an unprivileged Windows checkout still passes with a
few skips instead of failures.

Extensions are plain TypeScript loaded by Pi through `jiti`, so there is no
build step to run an extension. `@earendil-works/pi-*` and `typebox` are
`peerDependencies` supplied by the Pi host; they are installed as dev
dependencies here only for typechecking and tests.

## Tool naming

Model-facing tools are lowercase `snake_case` and follow Claude Code's
plan/worktree shape:

- A singleton tool is named for its domain: `todo`, `goal`, `job`,
  `subagent`.
- A multi-word tool is verb-first: `enter_worktree`, `exit_worktree`,
  `prune_worktrees`, `list_worktrees`, `enter_plan_mode`, `write_plan`,
  `exit_plan_mode`, `ask_user_question`. The noun-first `web_search` and
  `web_fetch` mirror Claude Code's `WebSearch`/`WebFetch`.
- A name one tool calls through `ctx.executeTool()` lives in
  [`lib/tool-names.ts`](./lib/tool-names.ts), never as a cross-extension import
  (see [`lib/README.md`](./lib/README.md)).
- [`test/naming.test.ts`](./test/naming.test.ts) enforces the shape, uniqueness,
  verb-first ordering, and the reviewed set of names. Built-in overrides
  (`read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`) reuse the built-in names and
  are excluded.

## Package conventions

- `keywords: ["pi-package"]` and a `pi` manifest in `package.json`.
- Host-provided packages (`@earendil-works/pi-*`, `typebox`) stay in
  `peerDependencies` with a `"*"` range, never in `dependencies`.
- Publishing is selected by `.npmignore` (there is no `files` allowlist in
  `package.json`; an allowlist would make `.npmignore` inert).
- See the [Pi Packages docs](https://github.com/earendil-works/pi/blob/main/docs/packages.md).

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for release notes.

## License

MIT
