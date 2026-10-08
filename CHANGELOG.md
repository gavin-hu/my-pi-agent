# Changelog

All notable changes to this package are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `file-browser`: a read-only `/serve` command that starts a local HTTP server rooted
  at the effective working directory and opens the default browser. The page is
  a two-pane tree browser — a collapsible path tree, directory listings, and
  file pages (text with a line-number gutter, images, binary/download cards) —
  with image thumbnails, per-language icons, and a client-side path filter. It
  binds `127.0.0.1` only, rejects foreign `Host` headers, guard-checks every path
  against traversal and symlink escapes, caps listing/text/thumbnail/file sizes,
  and uses a strict CSP (`/raw` is `script-src 'none'; sandbox`). No
  dependencies beyond `node:http` and one first-party `app.js`.

### Changed

- Internal: removed `extensions/_shared/`. Cross-extension helpers now live in a
  top-level [`lib/`](./lib/) (the worktree-environment module is now
  `lib/env.ts`), and the single-consumer helpers moved into their extension
  (`web-access/http.ts`, `plan/path-guard.ts`). No behavior change.
- `git` tool: clarified the per-action parameter documentation, added a
  params-by-action summary to the description, and improved transcript rendering
  (the call line now shows the effective invocation and errors render in the
  error color). The action set and argv are unchanged. The tool source moved
  under `extensions/git/tool/` (`index.ts` / `schema.ts` / `format.ts` /
  `render.ts`), and the rewind status chip now reuses the shared
  `lib/ui.ts` key and glyph.
- `plan-mode`: renamed the extension to `plan` at `extensions/plan/`. The tools
  (`enter_plan_mode` / `write_plan` / `exit_plan_mode`), the commands (`/plan`,
  `/plans`), the `--plan` flag, the `plan-mode` status key, and the persisted
  `plan-mode` session entry are unchanged.
- `jobs`: renamed the extension directory to `extensions/job/` (and its tests to
  `test/job/`) so the folder matches the `job` tool. The `/jobs` command and
  screen, the `jobs.json` config, the `~/.pi/agent/jobs/` registry/log store,
  and the `jobs` status key are unchanged.
- `git`, `worktree`, and `rewind`: merged into one `git` extension at
  `extensions/git/`, with the worktree and rewind code now living in the nested
  `worktree/` and `rewind/` modules. Tool and command names are unchanged
  (`git`, `enter_worktree` / `exit_worktree` / `prune_worktrees` /
  `list_worktrees`, `/worktree*`, `/rewind`), and the modules are no longer
  loadable as standalone extensions.
- `web-access`: merged the `web-search` and `web-fetch` extensions into one. The
  `web_search` and `web_fetch` tools are unchanged; their settings now live in
  one `web-access.json` under `search` and `fetch` sections.
- `jobs`: removed the above-editor widget. Job state now lives entirely in the
  status bar as a `▸ N` running chip and a separate `✗ N` unreported-failure
  chip (each keeps its count in the compact bar); the `showWidget` config option
  is gone.
- Cross-platform: CI now runs the full `bun run check` on Ubuntu, Windows, and
  macOS (matrix, `fail-fast: false`), so platform regressions are caught on every
  pull request. The test script raises the per-test timeout to 30s so the slower
  Windows temp/git tests are not flaky.

### Fixed

- Cross-platform runtime paths: git's `--show-toplevel` output is canonicalized
  to the native real path in the shared `repoRoot`, so rewind and plan-mode
  compare roots consistently on Windows (forward slashes vs backslashes, and 8.3
  short names). Plan containment and the serve guard likewise resolve symlinks
  with `realpathSync.native`.
- `worktree`: the bash isolation guard keeps backslashes in unquoted/Windows
  paths (only shell-significant characters are unescaped) and resolves real
  paths natively, so `git -C C:\main\checkout` is still blocked on Windows. The
  traversal check also accepts an in-tree sibling whose name starts with `..`.
- `subagent`: `shortenPath` normalizes separators before replacing the home
  prefix, so a Windows home (`C:\Users\x`) shortens to `~` for `/`-separated
  paths too.
- Windows: the test suite is portable. Temp paths are normalized with
  `realpathSync.native` so the 8.3 short names from `os.tmpdir()` compare equal to
  git's expanded output; path assertions use `join`/`resolve` instead of POSIX
  literals; test repos are created with `git init -q -b main` and
  `core.autocrlf=false` so restored files stay byte-exact; teardown retries a
  locked temp directory instead of failing with `EBUSY`; and symlink-dependent
  tests skip automatically when the host cannot create symlinks (for example
  unprivileged Windows) via `test/helpers/platform.ts`.
- Windows: the `smoke` script waits for a background job to exit before removing
  the worktree it ran in, and `e2e:rewind` seeds its snapshot with the native
  repo root.
- `plan-mode`: the traversal guard accepts an in-tree sibling whose name merely
  starts with `..` (for example `..notes`).

## [0.4.0] - 2026-10-08

### Added

- `subagent`: four new built-in agents — `researcher` (sourced web research via
  `web_search`/`web_fetch`), `tester` (writes and runs tests), `debugger`
  (read-only root-cause analysis), and `documenter` (docs/README/changelog) —
  alongside the existing `explorer`, `planner`, `reviewer`, and `worker`.
- `subagent`: optional user agents from `<agent-dir>/agents` and project agents
  from the nearest `.pi/agents`, loaded from markdown files with `name`,
  `description`, `tools`, and optional `model` frontmatter. The new `agentScope`
  parameter (`user` default, `project`, `both`) selects which directories are
  consulted. Project agents load only for `project`/`both`, and an untrusted
  project is confirmed interactively — or refused without a UI; the model cannot
  opt out.
- `todo`: the `todo` tool declares an `outputSchema` and returns matching
  `structuredContent`, so codemode/scripts can read the list as data.
- `worktree`: a disposable managed-worktree registry
  (`.pi/worktrees/index.json`) recording provenance and last use, plus a
  `statusOf()` view for derived dirty/ahead/behind/merged/locked state.
  `list_worktrees` shows the derived marks, and `/worktree prune` now ages
  worktrees by last use instead of directory mtime.

### Changed

- `jobs`: `runtime.ts` was split into focused seams — `store.ts` (durable
  registry), `logs.ts` (log tails), `ui.ts` (chip + widget), and `waiters.ts` —
  leaving the runtime as composition. The `job` tool's parameters now normalize
  to a `JobCall` discriminated union, removing the non-null assertions in the
  tool body. No behaviour change.
- `subagent`: every built-in agent now uses an explicit tool allowlist. `worker`
  is scoped (`read, write, edit, bash, grep, find, ls`) so it can no longer
  recurse into `subagent` or pick up ambient tools, and `explorer` no longer has
  `bash`. The `researcher`, `reviewer`, `debugger`, `tester`, and `documenter`
  prompts now state their tool boundaries more precisely.
- `subagent`: the `planner` agent is now framed as the delegated/headless
  planning primitive. Interactive, user-reviewed planning stays plan-mode's job
  (which blocks `subagent`), so the two are never used together.
- `todo`: the `todo` tool now returns a compact progress/current-item result
  instead of echoing the full list it was just given; the list stays in the
  tool-result `details` and in `/todos`.
- `todo`: an `in_progress` item now requires a non-blank `activeForm`, so the
  widget always shows a present-continuous label ("Writing tests") rather than
  falling back to the imperative content. Branch replay tolerates lists written
  before the rule.
- `worktree`: tool names are now verb-first, matching Claude Code's
  `EnterWorktree`/`ExitWorktree`: `worktree_enter` → `enter_worktree`,
  `worktree_exit` → `exit_worktree`, `worktree_prune` → `prune_worktrees`,
  `worktree_status` → `list_worktrees`.
- `rewind`: the `↺ N` status chip now counts every prompt on the active branch,
  matching the `/rewind` list size. Previously it counted only the prompts with
  a code snapshot, so it read lower than the menu whenever a prompt was
  read-only. The list's per-row code-snapshot marker moved from `↺` to `◆`, so
  `↺` means one thing everywhere: a rewind point.
- `plan-mode`: `/plan` with no argument now toggles plan mode instead of only
  entering it, so the toggle works in terminals that do not forward
  `Ctrl+Alt+P` (such as Zed's integrated terminal). `/plan <task>` still enters
  plan mode and runs the task.

### Fixed

- `goal`: `/goal clear` reports "No goal set." when nothing is set instead of
  silently succeeding, `/goal achieved` works as a synonym for `done`, and an
  unknown status is rejected before an empty objective can mask it. `getGoal()`
  returns a copy so callers cannot mutate the live goal without a sync.
- `todo`: the `/todos` screen now re-renders when the list changes while it is
  open, instead of showing the snapshot captured at open.
- `worktree`: refuse a `name` that resolves outside the managed worktree
  directory (an absolute or `..`-containing name could place the checkout
  anywhere).
- `worktree`: the built-in tool overrides keep the built-in renderers
  (`renderCall`/`renderResult`) and `edit`'s `prepareArguments`, so the TUI
  keeps diffs/highlighting and models that send `oldText`/`newText` still work.
- `worktree`: the bash guard now catches `cd -P`/`cd --`/`pushd -n` option
  forms, `>&file` redirects, and `git -c core.worktree=`; it no longer mistakes
  a `GIT_DIR=` argument (for example `echo GIT_DIR=/x`) for a redirect.
- `worktree`: `exit_worktree` reports `removed` from the actual removal, not
  the decision, and its error message no longer suggests an unsupported
  switch-by-path.
- `jobs`: the `/jobs` screen tracks selection by job id and pins the open log
  pane to its job, so the live running-first re-sort can no longer move the
  cursor or switch the log out from under the user.
- `jobs`: `d`/`K` (kill) and `x` (clear) ask for a `y`/`N` confirmation before
  acting, matching `plan-mode`'s confirm-before-delete convention.
- `jobs`: the `/jobs` log pane only repaints when its tail actually changes,
  instead of on every 500 ms poll.
- `jobs`: the repaint clock parks while a dock screen hides the rails and
  restarts when the screen closes, so a suppressed/hidden widget is not
  re-hidden every tick (and reattached jobs resume being polled on close).
- `jobs`: `wait` shows a `Waiting on <id>…` row while it blocks instead of
  rendering blank.
- `jobs`: the footer chip shows `▸N·✗N` when jobs are running and an unreported
  failure is waiting, instead of hiding the failure behind the running count
  (which mattered whenever the widget was hidden or disabled).
- `jobs`: the running chip is re-published on every repaint tick, so it cannot
  stay missing if something clears extension statuses while a job keeps running.
- `jobs`: docs now match the rendered `✗N`/`▸N·✗N` failure chip (was documented
  as `✕N`) and no longer imply the widget header shows the latest output line.

## [0.3.0] - 2026-10-08

### Changed

- `goal`, `todo`, and `jobs` share one rail family: label-first one-line
  widgets pinned in a stable `goal` → `todo` → `jobs` order, hidden while a dock
  screen (`/todos`, `/jobs`, `/plans`, `/rewind`) is open.
- `plan-mode`: the refine prompt keeps the plan on screen and opens an inline
  editor (`Enter` submits, `Esc` returns to the plan). The dialog fallback now
  reopens the review when the refine editor is cancelled instead of reporting
  the plan as not approved.
- Internal cleanup: git plumbing, worktree-root resolution, JSON narrowing, and
  the jobs record mapping moved to `_shared/` modules; duplicated and unused
  exports removed; `git` and `worktree` gained `DESIGN.md`.

## [0.2.0] - 2026-10-08

### Added

- `rewind` extension (replaces `checkpoint`): automatic per-prompt working-tree
  snapshots plus `/rewind`, which lists every prompt on the active branch and
  restores the **code**, the **conversation**, or **both**.
- Snapshot metadata schema v3 records the `sessionId` and the conversation
  `entryId` each snapshot precedes, so code and conversation rewind share one
  timeline.
- Conversation rewind uses Pi's session tree and returns the prompt to the
  editor; the abandoned branch is preserved.
- Real-SDK end-to-end test (`bun run e2e:rewind`), now part of `bun run check`.

### Changed

- Renamed the extension, command, config file (`rewind.json`), status chip, and
  ref namespace (`refs/pi/rewind`) away from `checkpoint`.

### Removed

- The model-facing `checkpoint` save tool and the `/checkpoint` command with its
  `list` / `save` / `diff` / `restore` / `clear` subcommands.

### Breaking

- Snapshots under `refs/pi/checkpoints/*` are ignored by schema v3 and are not
  listed. Delete them with
  `git for-each-ref --format='%(refname)' refs/pi/checkpoints | xargs -n1 git update-ref -d`.
- `checkpoint.json` is no longer read; rename it to `rewind.json` (the
  `safetyCheckpoint` key is now `safetySnapshot`).

## [0.1.0]

- Initial release.
