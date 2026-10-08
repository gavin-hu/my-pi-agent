# `worktree` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Let one Pi session work inside an isolated `git worktree` — its own branch and
checkout — and then return the session to the main checkout, with cleanup that
refuses to throw away work. The model keeps calling `read`/`write`/`edit`/`bash`
with ordinary relative paths; only the effective root changes.

## Non-goals

- No OS-level sandbox. The guard is best-effort at the shell boundary; real
  isolation of arbitrary writes needs a sandbox.
- No re-rooting of a shell the *user* runs directly (`!` / `user_bash`); Pi
  offers no mutable session cwd to change.
- Not a general branch manager. It creates and removes the worktrees it manages.

## Decisions

**Override the built-ins at load time; re-root at call time.** Pi builds the
path-taking built-ins once, bound to the session cwd, and exposes no way to
rebuild them. Extensions may override a built-in by registering the same tool
name, but only at load time. So `root-tools.ts` registers same-named wrappers
that re-run the real built-in definition with a `Proxy` context whose `cwd` is
the active root. Entering or exiting a worktree only changes that root;
`defaultActive: false` leaves activation to the built-in registration.

**Two layers: re-root and guard.** Re-rooting relative paths in `root-tools.ts`
is not enough on its own — an absolute path, `cd`, or `git -C` still escapes.
`guard.ts` runs centrally from the `tool_call` handler, so nested tool calls are
covered too, and refuses: file edits outside the worktree (including through a
symlink), shell commands whose cwd leaves it, git redirected at the main
checkout, and (opt-in) commands whose text cannot be statically verified. The
guard parses quotes, escapes, redirections, and `~`/`$VAR` expansion rather than
grepping the command string.

**Mutable root in one place.** Pi loads one extension factory per runtime, so
`runtime.ts` owns the single active worktree, the config cache, and the process
environment hook. Lifecycle, tools, and commands stay stateless functions over
that state. The status chip is published through `ctx.ui.setStatus` with a
shared key so the status-bar renders it.

**State as a session entry, not disk.** The active worktree is a custom session
entry, so `/resume` and `--continue` restore it, or report accurately when the
directory is gone. `state.ts` owns the shape; cleanup checks live before
removing anything.

**Children inherit through the environment.** A subagent or any `pi` started
from a tool cannot read this process's memory, so the active root, branch, and
main checkout are exported as `PI_WORKTREE_ROOT` / `_BRANCH` / `_MAIN`. Peer
extensions (git, rewind, jobs) resolve their `cwd` through
[`_shared/worktree-env.ts`](../_shared/worktree-env.ts). A child is read-only
with respect to lifecycle; the parent owns cleanup.

**Lock, then prune.** Entering takes a `git worktree lock` (`pi:<pid>:<session>`)
so a concurrent sweep cannot remove it. `/worktree prune` only removes managed
worktrees that are clean, carry no new commits, are not the current or a
live-locked one, and are older than `pruneAfterDays`; it clears stale locks
first, and any failure keeps the worktree with a reason.

**Never force out work.** `worktree_exit` never force-deletes a branch that
still holds uncommitted changes or commits not reachable from the recorded base,
even with `remove: true`. A clean worktree is removed automatically; a dirty one
prompts, or is kept in non-interactive mode.

## Known limitations

- Another extension owning one of the overridden tool names must be listed in
  `skipOverrides`; bash isolation is then guard-only.
- Command substitution, `eval`, and `sh -c` are only inspected when
  `blockUnparsableCommands` is enabled.
- A program that computes and writes an absolute path itself is not contained.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: flags, lifecycle events, prompt injection, wiring |
| `runtime.ts` | Shared state (active worktree, config cache, env, events) |
| `lifecycle.ts` | Barrel: `enterWorktree` / `exitWorktree` / `pruneWorktrees` / status |
| `enter.ts` / `exit.ts` / `prune.ts` | The lifecycle phases |
| `tools.ts` / `commands.ts` | Model tools / slash commands |
| `root-tools.ts` | Load-time built-in overrides bound to the active root |
| `git.ts` | Git plumbing (shared runner + read helpers) |
| `guard.ts` | Path, shell, and git-redirect isolation checks |
| `include.ts` | `.worktreeinclude` matcher and copy |
| `config.ts` / `state.ts` / `status.ts` | Config, session entry shape, status text |
