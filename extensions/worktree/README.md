# worktree — isolated git worktrees for Pi

`worktree` lets one Pi session work inside an isolated `git worktree` — its own
branch and checkout — and manages the worktrees it creates: enter, switch, and
exit, with cleanup that refuses to throw work away. The model keeps calling
`read`/`write`/`edit`/`bash` with ordinary relative paths; only the effective
root changes. It is one of two sibling git extensions in this package
(`rewind` is the other).

```bash
pi --extension ./extensions/worktree   # load just this extension
pi -e .                                # load the whole @gavin-hu/my-pi-agent package
pi install ./                          # install the package
pi -e . --worktree feature-auth        # load the package and enter a worktree at startup
```

## What it does

- `enter_worktree` creates `<repo>/.pi/worktrees/<name>` on branch
  `worktree-<name>` (or enters an existing worktree by `path`) and rebinds the
  session's working root to it.
- `exit_worktree` returns to the main checkout. A clean worktree is removed
  automatically; one with uncommitted changes or new commits prompts (or is
  kept in non-interactive mode). A branch that still holds work (uncommitted
  changes, or commits not reachable from the recorded base) is never
  force-deleted, even with `remove: true`.
- While isolated, `read`/`write`/`edit`/`bash`/`grep`/`find`/`ls` all resolve
  relative paths inside the worktree, and:
  - writes/edits outside the worktree are refused, including through a symlink
    that points at the main checkout;
  - `git -C <main>`, `GIT_DIR=`, `GIT_WORK_TREE=`, `--git-dir=`, `--work-tree=`,
    and `cd` outside the worktree are refused in `bash`;
  - network `git fetch` runs with terminal prompting disabled, so a credentials
    prompt fails fast instead of hanging.
- State is stored as a custom session entry, so `/resume` (and `--continue`)
  restores an active worktree, or reports when it is gone.

## Commands and flags

| | |
|---|---|
| `/worktree` | status + list managed worktrees |
| `/worktree enter [name]` | enter a worktree (a name may be a PR/MR reference) |
| `/worktree exit [--keep\|--remove]` | exit a worktree |
| `/worktree prune` | remove clean, unused, old managed worktrees |
| `--worktree <name>` | enter at session start |

`--remove` forces removal without prompting and may discard uncommitted
changes; a branch that still holds work is kept. Declining a confirmation
(entering an outside path, exiting a worktree with work) is reported as normal
feedback, not an error.

The model surface mirrors this with four tools:

| Tool | Usage |
|---|---|
| `enter_worktree` | `name` to create a worktree, or `path` to enter an existing one. Errors if already isolated. |
| `exit_worktree` | optional `remove` and `keepBranch`. Returns the clean/keep/remove decision. |
| `prune_worktrees` | no parameters. Removes eligible managed worktrees and reports the rest. |
| `list_worktrees` | no parameters. Read-only status: active root, inactive overrides, managed worktrees. |

## Configuration

Merged from `~/.pi/agent/worktree.json` and `<repo>/.pi/worktree.json`
(project wins):

```jsonc
{
  "dir": ".pi/worktrees",
  "baseRef": "fresh",        // "fresh" = remote default branch, "head" = local HEAD
  "branchPrefix": "worktree-",
  "fetchRemote": true,
  "fetchTimeoutMs": 5000,
  "onExit": "ask",           // "ask" | "keep" | "remove"
  "pruneAfterDays": 7,       // age before /worktree prune may remove a clean worktree
  "include": [],             // fallback when .worktreeinclude is absent
  "skipOverrides": [],       // tool names not to override (e.g. ["bash"])
  "guard": {
    "blockFileEscapes": true,
    "blockReadEscapes": false,
    "blockGitRedirects": true,
    "blockSymlinkEscapes": true,
    "blockUnparsableCommands": false
  }
}
```

`skipOverrides` matters when another extension owns one of the same built-in
tool names: Pi refuses to load two extensions that register the same tool, so
exclude the name here to load alongside it. It is read when the extension
loads, from the process working directory; reload after changing it. `/worktree`
and `list_worktrees` list any overridden tool that is not re-rooted.

Add the worktree directory to `.gitignore`:

```
.pi/worktrees/
```

## Security

The extension enforces a best-effort boundary around the worktree; it is not an
OS sandbox.

In `bash`, file redirection targets (`>`, `>>`, `>|`, `<`, `<>`, and the
`>&file`/`&>file` forms), `git` redirect options (`-C`, `--git-dir`,
`--work-tree`, and `-c core.worktree=`), and `cd`/`pushd`/`popd` targets
(including `-P`/`-L`/`--` option forms) are checked; `~`, `$VAR`, and `${VAR}`
are expanded first, and a value that cannot be resolved statically (an unknown
variable, `~user`, a backtick) is treated as escaping. File-descriptor
duplications (`2>&1`, `>&-`), heredocs, and here-strings are not treated as
paths, and options are only recognized in real argument position, so
`git log --grep='--git-dir=/tmp/x'` and `git log -C` are not false positives.

This guard covers the built-in file tools and these common shell forms. It
cannot contain a program that computes and writes an absolute path itself (for
example a script or an inlined interpreter).

## Gitignored files

A worktree is a fresh checkout, so untracked, gitignored files such as `.env`
are missing. Add a `.worktreeinclude` file at the repository root (gitignore
syntax: `*`, `?`, `**`, `[...]` classes, `!` negation, and `\` escapes); only
files that match a pattern *and* are ignored by git are copied into each new
worktree. Without that file, the `include` config list is used.

```text
.env
.env.local
config/secrets.json
```

## Pull / merge requests

`enter_worktree` accepts a PR/MR reference in `name`, as does the startup flag:

```
pi --worktree '#1234'
pi --worktree 'https://github.com/owner/repo/pull/1234'
```

It fetches `pull/<n>/head` (GitHub) or `merge-requests/<n>/head` (GitLab) from
`origin` and creates the worktree at `.pi/worktrees/pr-<n>`.

## Subagents and parallel sessions

While isolated, the extension exports `PI_WORKTREE_ROOT`, `PI_WORKTREE_BRANCH`,
and `PI_WORKTREE_MAIN` (the main checkout) into the process environment. A child
`pi` process — a subagent spawned by an extension, or any `pi` you start from a
tool — inherits it and binds to the same worktree instead of the main checkout.
The child is read-only with respect to lifecycle: `enter_worktree` and
`exit_worktree` refuse, and the parent owns cleanup.

Extensions can also follow changes on the `pi.events` channel
`worktree:changed`, which receives `{ active, path, branch, borrowed }`.

## Locking and pruning

Entering a managed worktree takes a `git worktree lock` (reason
`pi:<pid>:<session>`), so a concurrent sweep cannot remove it; exiting and
shutdown release it. `/worktree prune` (or the `prune_worktrees` tool) removes
managed worktrees that are clean, have no new commits, are not the current or a
live-locked one, and are older than `pruneAfterDays`. It releases locks whose
owning process is gone first, and any failure keeps the worktree with a reason.

Managed worktrees are tracked in a disposable index at
`.pi/worktrees/index.json` (provenance plus a `lastUsedAt` timestamp), reconciled
against `git worktree list` on every status/prune read. Prune age follows last
use, falling back to directory mtime for a worktree with no record.

## Limitations

- Pi refuses to load two extensions that register the same tool name. If another
  extension owns `bash` (or another overridden name), set
  `skipOverrides: ["bash"]` so this extension does not register it; that tool
  then runs in the main checkout with **no re-rooting**, so only its absolute
  writes are guarded (relative paths are not isolated), and `list_worktrees`
  reports it. `skipOverrides` is read at load time, from the process working
  directory.
- The guard is best-effort at the shell level: command substitution, `eval`, and
  `sh -c` are only covered when `blockUnparsableCommands` is enabled, and real
  isolation of arbitrary shell writes needs an OS sandbox.
- Only the model's `bash` tool is re-rooted and guarded. A shell command the
  user runs directly (`!` in the TUI / the `user_bash` event) is not re-rooted
  and still runs in the main checkout; Pi has no mutable session cwd to change
  that. `/worktree` and `list_worktrees` report the active root.

## Non-goals

- **No OS-level sandbox.** Real isolation of arbitrary writes needs a sandbox.
- **Not a general branch manager.** It creates, enters, and removes checkouts it
  knows about. It does not rename, rebase, merge, or push branches.
- **No user-shell re-rooting.** A shell the user runs directly (`!` /
  `user_bash`) is not isolated.
- **No Windows `powershell` surface.** The overrides guard the POSIX `bash`
  tool only.

## Pi integration

| Contract | Detail |
|---|---|
| Registration | The default export calls `registerWorktree`: root-tool overrides, the `--worktree` flag, lifecycle listeners, model tools, and the `/worktree` command. Nothing long-lived starts at load. |
| Tools | `enter_worktree`, `exit_worktree`, `prune_worktrees`, `list_worktrees` via `registerTool`. All `executionMode: "sequential"`. Annotations: `enter_worktree` destructive + open-world; `exit_worktree`/`prune_worktrees` destructive; `list_worktrees` read-only. No `outputSchema`; structured state is returned in tool-result `details`. |
| Built-in overrides | `read`/`write`/`edit`/`bash`/`grep`/`find`/`ls` are re-registered under the same names with `defaultActive: false`; each spreads the built-in definition and replaces only `execute`. `skipOverrides` is applied at load time. |
| Commands | `/worktree` via `registerCommand`, with argument completions for the subcommands and exit flags. |
| Flags | `--worktree` via `registerFlag`. |
| Events | `session_start` (bind inherited env, restore or refuse recorded state, read the flag), `session_shutdown` (release the lock, clear status), `before_agent_start` (set the prompt cwd and worktree section), `tool_call` (guard). |
| State | The binding is a custom session entry (`worktree`) written with `pi.appendEntry` and rebuilt from `ctx.sessionManager.getBranch()` on `session_start`. `.pi/worktrees/index.json` is a disposable managed-record cache, reconciled against `git worktree list`. Child processes inherit `PI_WORKTREE_*` env. |
| UI/events | Status chip via `ctx.ui.setStatus`; `worktree:changed` published on `pi.events`. |

## Design notes

- **Override at load, re-root at call.** Pi has no mutable session cwd and its
  built-ins capture cwd when the session is built, so a same-named wrapper is
  registered at load time and re-runs the real built-in definition with a Proxy
  context whose `cwd` is the active root. It spreads the built-in to keep
  renderers and `edit`'s `prepareArguments`; `defaultActive: false` leaves
  activation to the built-in registration.
- **Two layers: re-root and guard.** Re-rooting relative paths is not enough on
  its own — an absolute path, `cd`, or `git -C` still escapes. The guard runs
  centrally from the `tool_call` handler, so nested tool calls are covered too.
- **Core model: Checkout / Managed record / Binding.** A *Checkout* is a real
  `git worktree` and git is authoritative about it. A *Managed record* is
  provenance and usage in a disposable index. A *Binding* is this session's
  active root, a session entry that drives `getRoot()` and is replayable on the
  branch.
- **Mutable root in one place.** Pi loads one extension factory per runtime, so
  `runtime.ts` owns the single active worktree, the config cache, and the
  process-environment hook; lifecycle, tools, and commands stay stateless
  functions over it.
- **Binding is a session entry; the registry is a cache.** `/resume` and
  `--continue` restore the binding or report accurately when the directory is
  gone; the registry is reconciled against `git worktree list` on every
  management read and is never the source of truth.
- **Never force out work.** `exit_worktree` never force-deletes a branch that
  still holds uncommitted changes or commits not reachable from the recorded
  base, even with `remove: true`.
- **Lock, then prune.** Entering a managed worktree takes a `git worktree lock`
  so a concurrent sweep cannot remove it; prune releases stale locks first and
  keeps any worktree it cannot safely remove, with a reason.
- **Children inherit through the environment.** A child process cannot read this
  process's memory, so the active root, branch, and main checkout are exported
  as `PI_WORKTREE_*`; a child is read-only with respect to lifecycle and the
  parent owns cleanup.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Registrar: flags, lifecycle events, prompt injection, wiring (`registerWorktree`) |
| `runtime.ts` | Shared state (active worktree, config cache, env, events) |
| `lifecycle.ts` | Barrel: `enterWorktree` / `exitWorktree` / `pruneWorktrees` / status |
| `errors.ts` | Cancellation error that distinguishes a user decline from a failure |
| `enter.ts` / `exit.ts` / `prune.ts` | The lifecycle phases |
| `tools.ts` / `commands.ts` | Model tools / slash commands |
| `root-tools.ts` | Load-time built-in overrides bound to the active root |
| `git.ts` | Git plumbing (shared runner + read helpers) |
| `guard.ts` | Path, shell, and git-redirect isolation checks |
| `include.ts` | `.worktreeinclude` matcher and copy |
| `config.ts` / `state.ts` / `status.ts` | Config, session entry shape, status text |
| `registry.ts` | Disposable managed-worktree index + derived status |

## Testing

```bash
bun test          # unit + real-git tests
bun run smoke     # real-runtime load + enter/status/exit via the Pi SDK
bun run check     # typecheck + transpile + tests + smoke
bun run test:watch
```

The suite covers the pure logic (`include.ts` gitignore matcher, `guard.ts` path
and command checks, `parsePrReference`) and drives the extension end-to-end
against real temporary git repositories through a mocked `pi` API: enter/exit,
isolation guards, borrowed worktrees, prune, and inactive-override reporting.
