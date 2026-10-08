# `worktree` — Design

Status: **implemented**. This document describes the current design and carries
the **[planned]** v2 refinement roadmap at the end. User-facing behavior lives in
[`README.md`](./README.md).

## Goal

Let one Pi session work inside an isolated `git worktree` — its own branch and
checkout — and manage the set of worktrees it creates: enter one, switch between
them, and exit, with cleanup that refuses to throw away work. The model keeps
calling `read`/`write`/`edit`/`bash` with ordinary relative paths; only the
effective root changes.

## Non-goals

- **No OS-level sandbox.** The guard is best-effort at the shell boundary; real
  isolation of arbitrary writes needs a sandbox.
- **Not a general branch manager.** It creates, enters, and removes checkouts it
  knows about. It does not rename, rebase, merge, or push branches.
- **No user-shell re-rooting, yet.** A shell the user runs directly (`!` /
  `user_bash`) is not isolated today. **[planned]** via the `user_bash` event.
- **No Windows `powershell` surface, yet.** The overrides guard the POSIX
  `bash` tool only. **[planned]**.

## Core model: Registry / Binding / Checkout

The design separates three things that are easy to conflate:

| Concept | Storage | Authority | Lifetime |
|---|---|---|---|
| **Checkout** — a real `git worktree` on disk | git | `git worktree list` | repo |
| **Managed record** — provenance and usage | registry (`.pi/worktrees/index.json`) | extension | repo |
| **Binding** — this session's active root | session entry `worktree` | session | session |

- **Checkout** is never owned by the extension; git is authoritative about
  whether a worktree exists.
- **Managed record** answers "what worktrees exist, who made them, when were
  they last used, are they merged?", persisted in a disposable index at
  `.pi/worktrees/index.json`.
- **Binding** answers "which checkout is *this* session in?" and drives
  `getRoot()`. It is replayable on the active branch.

**Checkout status is derived, not stored:** `missing | orphaned |
locked(live|stale) | dirty | ahead(n) | behind(n) | merged | clean`. `statusOf()`
in `registry.ts` feeds status, prune, and (later) exit.

## Invariants

1. `binding.path` is always a live checkout in the same repo as
   `binding.repoRoot`.
2. A live lock is owned by exactly one session; binding a checkout locked by a
   *live* different session warns or refuses. (Today only newly created
   worktrees are locked and the owner is not checked on bind — **[planned]**.)
3. A branch is deleted only when fully merged
   (`git merge-base --is-ancestor <branch> <main|upstream>`) or empty, and never
   while it is checked out anywhere.
4. Every destructive removal either has a recoverable artifact or is refused.

## Current architecture (implemented)

**Override the built-ins at load time; re-root at call time.** Pi builds the
path-taking built-ins once, bound to the session cwd, and exposes no way to
rebuild them. Extensions may override a built-in by registering the same tool
name, but only at load time. So `root-tools.ts` registers same-named wrappers
that re-run the real built-in definition with a `Proxy` context whose `cwd` is
the active root. The wrapper spreads the real built-in definition, so it keeps
the built-in renderers (`renderCall`/`renderResult`) and `edit`'s
`prepareArguments`. Entering or exiting a worktree only changes that root;
`defaultActive: false` leaves activation to the built-in registration.

**Two layers: re-root and guard.** Re-rooting relative paths in `root-tools.ts`
is not enough on its own — an absolute path, `cd`, or `git -C` still escapes.
`guard.ts` runs centrally from the `tool_call` handler, so nested tool calls are
covered too, and refuses: file edits outside the worktree (including through a
symlink), shell commands whose cwd leaves it, git redirected at the main
checkout, and (opt-in) commands whose text cannot be statically verified. It
parses quotes, escapes, redirections, `~`/`$VAR` expansion, `cd` options and
`--`, `>&file`/`&>file` forms, and `git -c core.worktree=` rather than grepping
the command string, and only treats `GIT_DIR=`/`GIT_WORK_TREE=` as a redirect in
command-prefix position.

**Mutable root in one place.** Pi loads one extension factory per runtime, so
`runtime.ts` owns the single active worktree, the config cache, and the process
environment hook. Lifecycle, tools, and commands stay stateless functions over
that state. The status chip is published through `ctx.ui.setStatus` with a
shared key so the status-bar renders it.

**Binding as a session entry; registry as a disposable cache.** The active
worktree is a custom session entry, so `/resume` and `--continue` restore it, or
report accurately when the directory is gone. `state.ts` owns that shape, and
cleanup checks live before removing anything. `registry.ts` separately keeps
durable management metadata (provenance, base, `createdAt`/`lastUsedAt`) at
`.pi/worktrees/index.json`; it is a cache, reconciled against `git worktree list`
on every management read, and never the source of truth for the binding.

**Children inherit through the environment.** A subagent or any `pi` started
from a tool cannot read this process's memory, so the active root, branch, and
main checkout are exported as `PI_WORKTREE_ROOT` / `_BRANCH` / `_MAIN`. Peer
extensions (git, rewind, jobs) resolve their `cwd` through
[`_shared/worktree-env.ts`](../_shared/worktree-env.ts). A child is read-only
with respect to lifecycle; the parent owns cleanup. Env is the **[planned]**
fallback rather than the primary contract.

**Lock, then prune.** Entering a managed worktree takes a `git worktree lock`
(`pi:<pid>:<session>`) so a concurrent sweep cannot remove it.
`/worktree prune` removes managed worktrees that are clean, carry no new commits,
are not the current or a live-locked one, and are older than `pruneAfterDays`;
it clears stale locks first, and any failure keeps the worktree with a reason.

**Never force out work.** `exit_worktree` never force-deletes a branch that
still holds uncommitted changes or commits not reachable from the recorded base,
even with `remove: true`. A clean worktree is created by the session and removed
automatically; a dirty one prompts, or is kept in non-interactive mode.

## v2 refinement roadmap

Each item is shippable on its own. Item 1 is **done**; the rest are **[planned]**.
The sequencing at the end reflects dependencies.

### 1. Registry + `statusOf()` — implemented
`registry.ts` stores records at `.pi/worktrees/index.json` keyed by canonical
path (`{ path, name, branch, repoRoot, base, createdAt, lastUsedAt, pr,
createdByUs }`) and exposes `loadRegistry` / `upsertRecord` / `touchRecord` /
`removeRecord` / `reconcileRegistry`. `statusOf()` derives one `CheckoutStatus`
(`clean|dirty|missing`, changed, ahead, behind, merged, locked, staleLock,
lastUsedAt) from a listed worktree plus its record. `enter`/`exit` maintain
records, prune ages by `lastUsedAt` (falling back to directory mtime), and
`list_worktrees` renders the derived marks.

### 2. Merge-aware cleanup + snapshot **[planned]**
- Treat a branch fully contained in the main checkout or `origin/<default>` as
  **merged** and delete it without prompting. Today commits merged into main are
  still counted as "ahead of the recorded base", so merged work is kept forever.
- Before a forced removal, snapshot `git diff` and record `HEAD` under
  `.pi/worktrees/.trash/<id>/` and report the path, so `--force` cannot lose
  work. Pairs with the rewind extension.
- Exit policy becomes a precedence resolver (`flag > config > clean-default >
  prompt`) that returns a dry-run preview in the tool result.

### 3. Switch + picker **[planned]**
Allow `enter_worktree(path)` (or a new `switch`) while active: release the
current binding (unlock, keep on disk) and bind the new one. Add a picker over
the registry. Removal stays exclusive to `exit`.

### 4. `user_bash` re-rooting **[planned]**
Handle the `user_bash` event and return `operations` that run the built-in local
shell with `cwd = worktreeRoot`, closing the documented "user `!` is not
isolated" gap.

### 5. Guard: lexer + nested interpreters **[planned]**
Promote parsing to a small lexer that emits typed escape actions (`chdir`,
`write`, `read`, `gitDir`, `gitWorkTree`, `gitConfig`, `nested`) and recurse into
`sh -c` / `bash -c` / `env` / `xargs` strings. Replace the five guard booleans
with a policy object (`{ reads, writes, git, unparsable: allow|warn|block }`)
plus a `strict` preset. Add a differential test harness that executes commands
in a sandbox and asserts the guard's decision matches where bytes actually
landed.

### 6. Children / event contract **[planned]**
Make `worktree:changed` the primary contract and env the fallback. Persist a
borrowed binding so `reload` no longer drops inherited isolation. Add a
`PI_WORKTREE_ID` to correlate with the registry. Where possible, pass `cwd`
explicitly to subagents instead of relying on inheritance.

### 7. Observability **[planned]**
Drive the status chip from derived status (`⧉ name ↑2 ↓1 ✱`, `merged ✅`),
refreshed on `tool_result`. `list_worktrees` returns `structuredContent` via
`outputSchema` so the model and peers can rely on it. `/worktree` becomes a
picker over the registry.

### 8. Config / override timing **[planned]**
Split config into `loadTime` (only `skipOverrides`, needed at registration) and
`runtime` (everything else). Resolve the load-time repo root eagerly; on
`session_start`, if the session cwd's repo would resolve `skipOverrides`
differently, warn "reload required" instead of silently using the wrong set.
Cache by `(repoRoot, mtime)` so edits are picked up.

### 9. Lock ownership & safety **[planned]**
Check existing lock ownership before binding a shared worktree. Add a
`lastUsedAt` heartbeat, and key stale-lock detection on session id (or pid plus
start time) rather than pid alone, so pid reuse cannot pin a lock forever.

## Simplifications **[planned]**

- Move the `.gitignore` auto-offer out of `enter` (it mutates the main checkout
  mid-bind) into an explicit `/worktree init` step.
- Replace the silent fresh-reset of a reused clean worktree with an explicit
  `--reset`, which is less surprising than a hard reset on reopen.
- Fold `baseRefMode` into the `base` record (`{ ref, commit, mode }`).
- Unify `/worktree` and `list_worktrees` output through one renderer.

## Sequencing

1. Registry + `statusOf()` — **done**.
2. Merge-aware cleanup + snapshot — safety win, low risk.
3. Switch + picker — the multi-worktree UX.
4. `user_bash` re-root — closes the last user-visible hole.
5. Guard lexer + nested interpreters — hardening.
6. Children/event contract — cleanup.
7. Observability, config timing, lock safety, simplifications.

## Open questions

- **Registry location:** an ignored file in the repo
  (`.pi/worktrees/index.json`, disposable) vs. under the agent dir (survives
  deleting the repo). Leaning in-repo next to the worktrees.
- **Switch preconditions:** require a clean worktree, or auto-stash? Leaning
  clean + explicit.
- **Windows scope:** is the `powershell` surface worth it, or macOS/Linux only?

## Known limitations

- Another extension owning one of the overridden tool names must be listed in
  `skipOverrides`; that tool is not re-rooted and runs against the main checkout,
  so only guard checks (not relative-path isolation) apply. `skipOverrides` is
  read at load time from the process working directory.
- Command substitution, `eval`, and `sh -c` are only inspected when
  `blockUnparsableCommands` is enabled (see roadmap item 5).
- A program that computes and writes an absolute path itself is not contained.
- Prune age follows the registry's `lastUsedAt` (falling back to directory
  mtime for unregistered worktrees), so a worktree used recently is not swept
  even when its top-level mtime is stale.

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
| `registry.ts` | Disposable managed-worktree index + `statusOf()` |
| `bash-reroot.ts` **[planned]** | `user_bash` handler that runs in the worktree |
