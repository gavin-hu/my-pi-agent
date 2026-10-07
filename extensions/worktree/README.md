# pi-worktree — EnterWorktree / ExitWorktree for Pi

An isolated `git worktree` workflow for Pi, modelled on Claude Code's
`EnterWorktree` / `ExitWorktree` tools.

```
pi --extension ./extensions/worktree          # load just this extension
pi -e .                                       # load the whole @gavin-hu/my-pi-agent package
pi --extension ./extensions/worktree --worktree feature-auth
```

Or install it as a package:

```bash
pi install ./            # personal (the package root)
pi install ./ -l         # project-local
```

## What it does

- `worktree_enter` — creates `<repo>/.pi/worktrees/<name>` on branch
  `worktree-<name>` (or enters an existing worktree by `path`) and rebinds the
  session's working root to it.
- `worktree_exit` — returns to the main checkout. A clean worktree is removed
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

## Commands / flags

| | |
|---|---|
| `/worktree` | status + list managed worktrees |
| `/worktree enter [name]` | enter a worktree |
| `/worktree exit [--keep\|--remove]` | exit a worktree |
| `/worktree prune` | remove clean, unused, old managed worktrees |
| `--worktree <name>` | enter at session start |

The `worktree_status` tool is the model-facing equivalent of `/worktree`:
isolated or not, path/branch, inactive overrides, and managed worktrees.

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

In `bash`, redirect paths are expanded before the containment check: `~`,
`$VAR`, and `${VAR}` are resolved, and a value that cannot be resolved
statically (an unknown variable, `~user`, a backtick) is treated as escaping.
Redirect options are only recognized in real argument position, so
`git log --grep='--git-dir=/tmp/x'` and `git log -C` are not false positives.

`skipOverrides` matters when another extension owns one of the same built-in
tool names: Pi refuses to load two extensions that register the same tool, so
exclude the name here to load alongside it. `/worktree` and `worktree_status`
list any overridden tool that is not re-rooted.

Add the worktree directory to `.gitignore`:

```
.pi/worktrees/
```

## How it works

Pi has no mutable session cwd, and its built-in tools capture cwd when the
session is built. Extensions can override a built-in by registering a tool with
the same name, but only at load time. This extension therefore registers
same-named wrappers for the path-taking tools (`root-tools.ts`) that re-run the
real built-in definition with a context whose `cwd` is the active root; entering
or exiting a worktree just changes that root.

### Modules

| File | Responsibility |
|---|---|
| `index.ts` | Extension factory: flags, lifecycle events, wiring |
| `runtime.ts` | Shared mutable state (active worktree, config cache, env, events) |
| `lifecycle.ts` | `enterWorktree` / `exitWorktree` / `pruneWorktrees` / `worktreeStatus` |
| `tools.ts` / `commands.ts` | Model tools / slash commands |
| `root-tools.ts` | Built-in tool overrides bound to the active root |
| `git.ts` / `guard.ts` / `include.ts` / `config.ts` / `state.ts` | Git plumbing, isolation guard, `.worktreeinclude`, config, session state |

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

`worktree_enter` accepts a PR/MR reference in `name`, as does the startup flag:

```
pi --worktree '#1234'
pi --worktree 'https://github.com/owner/repo/pull/1234'
```

It fetches `pull/<n>/head` (GitHub) or `merge-requests/<n>/head` (GitLab) from
`origin` and creates the worktree at `.pi/worktrees/pr-<n>`.

## Subagents and parallel sessions

While isolated, the extension exports `PI_WORKTREE_ROOT` (and
`PI_WORKTREE_BRANCH`) into the process environment. A child `pi` process — a
subagent spawned by an extension, or any `pi` you start from a tool — inherits
it and binds to the same worktree instead of the main checkout. The child is
read-only with respect to lifecycle: `worktree_enter` and `worktree_exit` refuse,
and the parent owns cleanup.

Extensions can also follow changes on the `pi.events` channel
`worktree:changed`, which receives `{ active, path, branch, borrowed }`.

## Locking and pruning

Entering a managed worktree takes a `git worktree lock` (reason
`pi:<pid>:<session>`), so a concurrent sweep cannot remove it; exiting and
shutdown release it. `/worktree prune` (or the `worktree_prune` tool) removes
managed worktrees that are clean, have no new commits, are not the current or a
live-locked one, and are older than `pruneAfterDays`. It releases locks whose
owning process is gone first, and any failure keeps the worktree with a reason.

## Testing

```bash
bun test          # unit + git-integration tests
bun run smoke     # real-runtime load + enter/status/exit via the Pi SDK
bun run check     # typecheck + transpile + tests + smoke
bun run test:watch
```

The suite covers the pure logic (`include.ts` gitignore matcher, `guard.ts` path and
command checks, `parsePrReference`) and drives the extension end-to-end against real
temporary git repositories through a mocked `pi` API: enter/exit, isolation guards,
borrowed worktrees, prune, and inactive-override reporting.

## Status

Implemented:

- **M1** — enter/exit, root-bound tool overrides for `read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`,
  session-state persistence/restore, prompt injection, `/worktree*` commands, `--worktree`.
- **M2** — centralized guards (`guard.ts`): file-escape checks, git redirects
  (`git -C`, `--git-dir`, `--work-tree`, `GIT_DIR`, `GIT_WORK_TREE`), `cd` outside the root, and an
  opt-in command-shape check; recursive submodule inspection before cleanup; richer
  resume-refusal messages for gone/unsafe/unverified worktrees.
- **M3** — `.worktreeinclude` copying (gitignore matcher, gitignored-only); 24-hour capped default-branch
  fetch; worktree-name reuse reset rules; PR/MR references; an offer to add the worktree directory to
  `.gitignore`.
- **M4** — subagent/child-process isolation via `PI_WORKTREE_ROOT` and the `worktree:changed` event;
  `git worktree lock`/`unlock` with a stale-lock-aware `/worktree prune`; packaged as a Pi package
  (`package.json` with a `pi` manifest and host packages as peers).
- **Hardening** — `worktree_status` tool; symlink-safe containment (`blockSymlinkEscapes`);
  credential-prompt suppression for network fetches; inactive-override reporting; shell-expansion-aware
  git redirect checks; a `bun test` suite (63 tests) and CI.

Known limitations:

- Pi refuses to load two extensions that register the same tool name. If another
  extension owns `bash` (or another overridden name), set
  `skipOverrides: ["bash"]` so this extension does not register it; bash
  isolation is then guard-only, and `worktree_status` says so.
- The guard is best-effort at the shell level: command substitution, `eval`, and
  `sh -c` are only covered when `blockUnparsableCommands` is enabled, and real
  isolation of arbitrary shell writes needs an OS sandbox.
- Only the model's `bash` tool is re-rooted and guarded. A shell command the
  user runs directly (`!` in the TUI / the `user_bash` event) is not re-rooted
  and still runs in the main checkout; Pi has no mutable session cwd to change
  that. `/worktree` and `worktree_status` report the active root.
