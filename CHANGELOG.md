# Changelog

All notable changes to this package are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `todo`: the `todo` tool declares an `outputSchema` and returns matching
  `structuredContent`, so codemode/scripts can read the list as data.
- `worktree`: a disposable managed-worktree registry
  (`.pi/worktrees/index.json`) recording provenance and last use, plus a
  `statusOf()` view for derived dirty/ahead/behind/merged/locked state.
  `list_worktrees` shows the derived marks, and `/worktree prune` now ages
  worktrees by last use instead of directory mtime.

### Changed

- `todo`: the `todo` tool now returns a compact progress/current-item result
  instead of echoing the full list it was just given; the list stays in the
  tool-result `details` and in `/todos`.
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
