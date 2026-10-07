# `checkpoint` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the user a lightweight undo point per task: snapshot the working tree at
the start of each prompt, and rewind to a snapshot when a change goes wrong. It
must be safe by default — never destroy unpushed history, never move HEAD, never
corrupt the real index — and cheap enough to run automatically every prompt.

## Decisions

**One snapshot per user prompt.** The unit is the task, not the tool call:
`before_agent_start` records the prompt summary and the run's first mutating
tool call takes the snapshot (still before any mutation). A read-only prompt
snapshots nothing, and later turns of the same prompt do not snapshot again. Per-
turn or per-call granularity was rejected as the default because it produces a
wall of near-identical rows; `save` covers mid-task points. The run-scoped flag
is set synchronously before the first `await`, so parallel tool calls cannot
double-snapshot.

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
call. Because that is process-global, every staging operation is serialized
through one promise queue in `runtime.ts`; read-only listings are not queued
because they never set the variable.

**A clean tree still records a metadata commit.** After building the tree, if it
equals `HEAD^{tree}` the checkpoint is marked `clean`. It is still committed so
the metadata line is attached and the snapshot is listable; git reuses the
identical tree object, so the cost is one small commit.

**Rewind is `read-tree --reset -u` plus explicit untracked removal.** The target
commit's tree is loaded into the index and tracked working tree with
`read-tree --reset -u`, which restores modifications and deletions and removes
paths the snapshot never had. `read-tree` leaves untracked files alone, so the
paths added since the snapshot are computed beforehand and deleted explicitly.
HEAD is never passed to `read-tree`, so no branch moves. Refusing while a merge,
rebase, cherry-pick, revert, or bisect is in progress avoids clobbering an
in-flight operation.

**Untracked handling is symmetric.** `includeUntracked` governs both the
snapshot and the removal set. When it is `true` (default), untracked files are
captured and files created since the snapshot are removed on rewind. When it is
`false`, untracked files are neither captured nor deleted, so a rewind cannot
destroy a file the snapshot never contained. The flag is recorded in metadata
so a snapshot restored in a later session is interpreted the same way.

**Metadata is versioned in the commit body.** Each checkpoint commit carries a
`pi-checkpoint: { v: 2, ... }` line with id, reason, label, prompt, timestamp,
root, branch, head, clean, and the untracked flag. Listing reads refs and commit
bodies, so checkpoints survive across sessions and branches without any external
index; a malformed line, or one from another schema version, is skipped rather
than trusted. The ref name is treated as the identity, so a rewritten message
cannot alias another ref.

**Automatic snapshots reuse the shared read-only policy.** `_shared/policy.ts`
classifies a tool as mutating unless it is a known structured reader or carries
`readOnlyHint`. Reusing it covers tools this extension has never seen — `bash`,
MCP servers, future extensions — without naming them. `watch` forces a tool to
count; `ignore` and this package's own tools never snapshot. A `tool_call`
handler failure blocks the model's call, so the whole handler is wrapped: a
checkpoint problem warns once and never blocks the work.

**A pre-restore safety checkpoint makes rewind undoable.** Unless disabled,
`restore` first snapshots the current state with reason `pre-restore`, so a
rewind is itself a snapshot away from being reversed.

**Worktrees share refs, so roots are recorded and filtered.** Refs live in the
shared git directory, so a checkpoint taken in a linked worktree is visible from
the main checkout. Each checkpoint records its `root`; `list`/`restore` filter
to the current root, and restoring a snapshot from a different worktree is
refused. The effective root follows `PI_WORKTREE_ROOT` when set.

**Identity is fixed for internal commits.** `commit-tree` runs with
`-c user.name=pi -c user.email=pi@localhost`, so snapshots work in a repository
without committer identity configured and never depend on the user's git config.

**The surface is menu-first.** The `/checkpoint` menu is the primary way to
review, diff, save, clear, and restore: it resolves the chosen action after the
screen closes, so a confirm dialog or label prompt never fights it for input.
Diff, save, and clear keep the menu open; restore closes it. Restore always
confirms, with a diff preview, and refuses headlessly. The model-facing tool is
only `save` (mark a labeled point), because automatic snapshots already cover
the start of every task and the user owns the rewind.

**`clear` sweeps the ref namespace, not parsed metadata.** Because listing
validates the metadata schema, refs written by a different version are invisible
to it. Clear therefore enumerates refs directly and deletes those for this root
plus any ref it cannot parse, so a schema change cannot strand invisible orphans;
refs that parse and belong to another worktree are kept unless `all` is set.

## Non-goals

- No conversation rewind; the extension only restores the working tree.
- No capture of `.gitignore`d files.
- No per-file or partial rewind; a restore is all-or-nothing.
- No moving HEAD, committing, stashing, or pushing.
- No non-git projects.
- No ref cleanup on session end; checkpoints persist until pruned or cleared.

## Model surface

| Field | Value |
|---|---|
| `name` | `checkpoint` |
| `label` | Optional, for `save` |
| `exposure` | `direct` (default) |
| `executionMode` | `sequential` — the shared temp index and queue assume no overlap |
| `annotations` | `readOnlyHint: false`, `destructiveHint: false` — saving touches no working-tree file |

Restoring is a user action, performed from the `/checkpoint` menu.
