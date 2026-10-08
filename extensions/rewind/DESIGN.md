# `rewind` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the user a lightweight undo point per task: snapshot the working tree at
the start of each prompt, and return to an earlier prompt — restoring the code,
the conversation, or both. It must be safe by default — never destroy unpushed
history, never move HEAD, never corrupt the real index — and cheap enough to run
automatically every prompt.

This extension replaces an earlier `checkpoint` extension. The command surface,
config file, ref namespace, status key, and metadata schema were renamed and
reworked together; older `refs/pi/checkpoints/*` are ignored.

## Decisions

**One snapshot per user prompt.** The unit is the task, not the tool call:
`before_agent_start` records the prompt summary and the run's first mutating
tool call takes the snapshot (before any mutation). A read-only prompt snapshots
nothing, and later turns of the same prompt do not snapshot again. The run-scoped
flag is set synchronously before the first `await`, so parallel tool calls cannot
double-snapshot.

**The rewind timeline comes from the session, not from git.** `/rewind` lists
every user message on the active branch and pairs each with the snapshot whose
recorded `entryId` matches. This shows read-only prompts too, and it means the
list follows `/tree` navigation naturally. A git-only list was rejected because
it would hide prompts that never mutated a file and would not know where in the
conversation each snapshot belonged.

**Conversation rewind uses Pi's session tree.** `ctx.navigateTree(entryId)`
moves the active leaf to the parent of the selected user message and returns its
text to the editor; the abandoned branch is preserved. This is preferred over
mutating history: it is reversible with `/tree`, and it matches how Pi already
branches. `/rewind` calls it without `summarize` so a rewind is immediate and
does not spend tokens.

**The snapshot records its conversation anchor.** Metadata (v3) carries the
`sessionId` and the `entryId` of the prompt the snapshot precedes. The session id
guards against matching a same-id entry from another session or a fork; the entry
id is what `navigateTree` targets.

**Snapshots are git commits kept by refs, not copied files.** A snapshot builds
a tree from the working tree and stores it as a commit under
`refs/pi/rewind/<id>`. This reuses git's content-addressed storage (no duplicated
tree on disk), keeps snapshots alive against `git gc` through a real ref, and
makes them listable with ordinary plumbing. A side directory of copied files was
rejected: it would duplicate the whole tree, ignore git's ignore rules, and drift
from the repository. `git stash` was rejected because `stash create` cannot
include untracked files reliably and `stash store` pollutes the user's stash list.

**A temporary index keeps the real index and HEAD untouched.** Staging goes
through `GIT_INDEX_FILE`, a per-process index under `.git/pi/`. `pi.exec` has no
`env` option, so the variable is set on `process.env` for the duration of the
call. Because that is process-global, every staging operation is serialized
through one promise queue in `runtime.ts`; read-only listings are not queued
because they never set the variable.

**A clean tree still records a metadata commit.** After building the tree, if it
equals `HEAD^{tree}` the snapshot is marked `clean`. It is still committed so the
metadata line is attached and the snapshot is listable; git reuses the identical
tree object, so the cost is one small commit.

**Rewind is `read-tree --reset -u` plus explicit untracked removal.** The target
commit's tree is loaded into the index and tracked working tree with
`read-tree --reset -u`, which restores modifications and deletions and removes
paths the snapshot never had. `read-tree` leaves untracked files alone, so the
paths added since the snapshot are computed beforehand and deleted explicitly.
HEAD is never passed to `read-tree`, so no branch moves. Refusing while a merge,
rebase, cherry-pick, revert, or bisect is in progress avoids clobbering an
in-flight operation.

**Untracked handling is symmetric.** `includeUntracked` governs both the snapshot
and the removal set. When it is `true` (default), untracked files are captured
and files created since the snapshot are removed on rewind. When it is `false`,
untracked files are neither captured nor deleted, so a rewind cannot destroy a
file the snapshot never contained. The flag is recorded in metadata so a snapshot
restored in a later session is interpreted the same way.

**Metadata is versioned in the commit body.** Each snapshot commit carries a
`pi-rewind: { v: 3, ... }` line with id, reason, label, prompt, timestamp, root,
branch, head, clean, the untracked flag, the session id, and the conversation
entry id. Listing reads refs and commit bodies, so snapshots survive across
sessions and branches without any external index; a malformed line, or one from
another schema version, is skipped rather than trusted. The ref name is treated
as the identity, so a rewritten message cannot alias another ref.

**Automatic snapshots reuse the shared read-only policy.** `_shared/policy.ts`
classifies a tool as mutating unless it is a known structured reader or carries
`readOnlyHint`. Reusing it covers tools this extension has never seen — `bash`,
MCP servers, future extensions — without naming them. `watch` forces a tool to
count; `ignore` and this package's own tools never snapshot. A `tool_call`
handler failure blocks the model's call, so the whole handler is wrapped: a
snapshot problem warns once and never blocks the work.

**A pre-restore safety snapshot makes rewind undoable.** Unless disabled,
`restore` first snapshots the current state with reason `pre-restore`, so a code
rewind is itself a snapshot away from being reversed. Conversation rewind is
already reversible through `/tree`.

**Code is restored before the conversation.** `/rewind` applies the code restore
first, so the re-rendered transcript reflects the restored files, then navigates
the tree (which replaces the chat view and repopulates the editor).

**Worktrees share refs, so roots are recorded and filtered.** Refs live in the
shared git directory, so a snapshot taken in a linked worktree is visible from
the main checkout. Each snapshot records its `root`; listing and matching filter
to the current root, and restoring a snapshot from a different worktree is
refused. The effective root follows `PI_WORKTREE_ROOT` when set.

**Identity is fixed for internal commits.** `commit-tree` runs with
`-c user.name=pi -c user.email=pi@local`, so snapshots work in a repository
without committer identity configured and never depend on the user's git config.

**The surface is one command.** `/rewind` opens the timeline; the scope choice
and confirmation run after the screen closes so dialogs never fight it for input.
The extension registers no model-facing tool: automatic snapshots cover the start
of every task, and the user owns the rewind.

## Non-goals

- No capture of `.gitignore`d files.
- No per-file or partial code rewind; a restore is all-or-nothing.
- No moving HEAD, committing, stashing, or pushing.
- No non-git projects (conversation-only rewind still works outside git).
- No ref cleanup on session end; snapshots persist until pruned or cleared.
- No migration of the old `refs/pi/checkpoints/*` snapshots.
