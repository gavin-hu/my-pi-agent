# `checkpoint` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the agent (and the user) a lightweight undo point for the working tree:
snapshot before risky edits, and rewind to a snapshot when a change goes wrong.
It must be safe by default — never destroy unpushed history, never move HEAD,
never corrupt the real index — and cheap enough to run automatically every turn.

## Decisions

**Snapshots are git commits kept by refs, not copied files.** A snapshot builds
a tree from the working tree and stores it as a commit under
`refs/pi/checkpoints/<id>`. This reuses git's content-addressed storage (no
duplicated tree on disk), keeps snapshots alive against `git gc` through a real
ref, and makes them listable with ordinary plumbing. A side directory of copied
files was rejected: it would duplicate the whole tree, ignore git's ignore
rules, and drift from the repository. `git stash` was rejected because
`stash create` cannot include untracked files reliably and `stash store`
pollutes the user's stash list.

**A temporary index keeps the real index and HEAD untouched.** Staging goes
through `GIT_INDEX_FILE`, a per-process index under `.git/pi/`. `pi.exec` has no
`env` option, so the variable is set on `process.env` for the duration of the
call, mirroring how the worktree extension handles `GIT_TERMINAL_PROMPT`.
Because that is process-global, every staging operation is serialized through
one promise queue in `runtime.ts`; read-only listings are not queued because
they never set the variable.

**A clean tree still records a metadata commit.** After building the tree, if it
equals `HEAD^{tree}` the checkpoint is marked `clean`. It is still committed so
the metadata line is attached and the snapshot is listable; git reuses the
identical tree object, so the cost is one small commit. (Storing metadata only
when dirty, and pointing clean refs at HEAD, was rejected because a HEAD commit
carries the user's message, not ours, so the snapshot would not be listable.)

**Rewind is `read-tree --reset -u` plus explicit untracked removal.** The target
commit's tree is loaded into the index and tracked working tree with
`read-tree --reset -u`, which restores modifications and deletions and removes
paths the snapshot never had. `read-tree` leaves untracked files alone, so the
paths added since the snapshot are computed beforehand (by staging the current
working tree into the temp index and diffing) and deleted explicitly. HEAD is
never passed to `read-tree`, so no branch moves. Refusing while a merge, rebase,
cherry-pick, revert, or bisect is in progress avoids clobbering an in-flight
operation.

**Untracked handling is symmetric.** `includeUntracked` governs both the
snapshot and the removal set. When it is `true` (default), untracked files are
captured and files created since the snapshot are removed on rewind. When it is
`false`, untracked files are neither captured nor deleted, so a rewind cannot
destroy a file the snapshot never contained. The flag is recorded in metadata
so a snapshot restored in a later session is interpreted the same way.

**Metadata lives in the commit body.** Each checkpoint commit carries a
`pi-checkpoint: {json}` line with id, reason, label, tool, turn, timestamp,
root, branch, head, clean, and the untracked flag. Listing reads refs and commit
bodies, so checkpoints survive across sessions and branches without any external
index; a malformed line is skipped rather than trusted. The ref name is treated
as the identity, so a rewritten message cannot alias another ref.

**Automatic snapshots reuse the shared read-only policy.** `_shared/policy.ts`
classifies a tool as mutating unless it is a known structured reader or carries
`readOnlyHint`. Reusing it covers tools this extension has never seen — `bash`,
MCP servers, future extensions — without naming them. `watch` forces a tool to
count; `ignore` and this package's own tools never snapshot. The default
granularity is one snapshot per turn; the flag is set synchronously before the
first `await`, so parallel tool calls in one turn cannot double-snapshot. A
`tool_call` handler failure blocks the model's call, so the whole handler is
wrapped: a checkpoint problem warns once and never blocks the work.

**A pre-restore safety checkpoint makes rewind undoable.** Unless disabled,
`restore` first snapshots the current state with reason `pre-restore`, so a
rewind is itself a snapshot away from being reversed.

**Worktrees share refs, so roots are recorded and filtered.** Refs live in the
shared git directory, so a checkpoint taken in a linked worktree is visible from
the main checkout. Each checkpoint records its `root`; `list`/`restore` filter
to the current root, `all` widens the list, and restoring a snapshot from a
different worktree is refused. The effective root follows `PI_WORKTREE_ROOT`
when set, exactly as the `git` tool does.

**Identity is fixed for internal commits.** `commit-tree` runs with
`-c user.name=pi -c user.email=pi@localhost`, so snapshots work in a repository
without committer identity configured and never depend on the user's git config.

## Non-goals

- No capture of `.gitignore`d files.
- No per-file or partial rewind; a restore is all-or-nothing.
- No moving HEAD, committing, stashing, or pushing — that is the user's or the
  `git` tool's job.
- No non-git projects.
- No custom transcript entry per snapshot; the status chip, tool results, and
  `/checkpoint` carry the signal, keeping the transcript free of noise.
- No ref cleanup on session end; checkpoints persist until pruned or cleared.

## Model surface

| Field | Value |
|---|---|
| `name` | `checkpoint` |
| `action` | `save` \| `list` \| `diff` \| `restore` \| `clear` |
| `label` | Optional, for `save` |
| `id` | Optional, for `diff`/`restore`; defaults to `"last"` |
| `all` | Optional, widens `list`/`clear` across worktrees |
| `exposure` | `direct` (default) |
| `executionMode` | `sequential` — the shared temp index and queue assume no overlap |
| `annotations` | `readOnlyHint: false`, `destructiveHint: true` — plan mode blocks it |

`restore` needs `ctx.hasUI` and confirms with a diff preview; headless it
returns an actionable error telling the user to run `/checkpoint restore`.
