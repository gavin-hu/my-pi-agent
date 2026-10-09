# rewind — prompt-anchored snapshots and conversation rewind for Pi

Snapshot the working tree at the start of each task and return to an earlier
prompt from a menu — restoring the **code**, the **conversation**, or **both**.
A snapshot is a git commit kept under `refs/pi/rewind/<id>`; restoring one
rewrites the working tree and index **without moving HEAD**, so commits,
branches, and the reflog are untouched. Conversation rewind uses Pi's session
tree, so the branch you leave is not erased.

This is the `rewind` extension entrypoint; it is one of two sibling git
extensions in this package (`worktree` is the other).

```
pi --extension ./extensions/rewind   # load this extension alone
pi -e .                              # load the whole @gavin-hu/my-pi-agent package
pi install ./                        # install the package
```

## What it does

- Takes **one automatic snapshot per user prompt**, before the prompt's first
  mutating tool call. A read-only prompt snapshots nothing.
- `/rewind` lists **every user prompt on the active branch** (newest first), each
  marked `◆` when a code snapshot was captured for it.
- Picking a point asks what to restore: **Code and conversation**,
  **Conversation only**, or **Code only**.
  - *Code* rewrites the working tree to the snapshot and is itself undoable
    (a `pre-restore` safety snapshot is taken first).
  - *Conversation* moves the session tree back to that prompt and puts the
    prompt text back in the editor; the abandoned branch stays in the session.
- Shows a `↺ N` status chip counting the prompts on the active branch — the
  same points `/rewind` lists (its list size), whether or not each has a code
  snapshot.
- Stores metadata in the commit body, so snapshots survive across sessions and
  are listed from git rather than from session state.

Snapshots include tracked files plus (by default) untracked, non-ignored files.
`.gitignore`d files are never captured. Because refs live in the shared git
directory, a snapshot taken inside a [`worktree`](../worktree/) is visible from
the main checkout; `list`/matching filter to the current root by default.

## Command

| Command | What it does |
|---|---|
| `/rewind` | Open the timeline; pick a prompt, then a restore scope. |

The timeline is keyboard-driven: `↑`/`↓` or `j`/`k` move, `PgUp`/`PgDn`/`Home`/`End`
jump, `Enter` chooses the focused prompt, the mouse wheel scrolls, `Esc` closes.
The scope choice and the confirmation (with a diff preview) run after the screen
closes.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| Interactive TUI | Full selectable timeline component; scope choice and confirmation follow after it closes. |
| RPC (`hasUI`) | Timeline falls back to `ui.select`; scope choice and confirmation use forwarded dialogs. |
| `print` / `json` | No picker: the prompt list is printed. |

## Configuration

Merged from `~/.pi/agent/rewind.json` (global) and `<root>/.pi/rewind.json`
(project); project values win.

```json
{
  "autoSnapshots": true,
  "max": 20,
  "includeUntracked": true,
  "safetySnapshot": true,
  "autoPrune": true,
  "showStatus": true,
  "watch": [],
  "ignore": [],
  "refNamespace": "refs/pi/rewind"
}
```

| Key | Meaning |
|---|---|
| `autoSnapshots` | Take one automatic snapshot per prompt. Default `true`. |
| `max` | Snapshot refs kept per root before the oldest are pruned on save. |
| `includeUntracked` | Capture untracked, non-ignored files. |
| `safetySnapshot` | Save the current state before a code restore. |
| `autoPrune` | Delete the oldest refs beyond `max` after saving. |
| `showStatus` | Draw the `↺ N` status chip. |
| `watch` | Extra tool names to treat as mutating. |
| `ignore` | Tool names never to snapshot; this package's own tools are always excluded. |
| `refNamespace` | Ref namespace for stored snapshots. |

## How snapshots are stored

Each snapshot is a commit under `refs/pi/rewind/<id>` whose body carries a
`pi-rewind: {json}` metadata line at **schema version 3**. The metadata records
the id, reason, prompt summary, timestamp, root, branch, HEAD, clean state, the
untracked flag, the **session id**, and the **conversation entry id** of the
prompt it precedes. A ref written by another schema version is ignored, so older
refs are not misread.

Because the schema moved to v3 with the conversation anchor, snapshots taken by
the old `checkpoint` extension (or an earlier rewind) under
`refs/pi/checkpoints/*` are no longer listed. They are not deleted; remove them
with `git update-ref -d` or `git for-each-ref --format='%(refname)' refs/pi/checkpoints | xargs -n1 git update-ref -d`.

A clean working tree still records a commit (so the metadata always travels with
the snapshot); git reuses the identical tree object, so the only cost is a small
commit. These refs are not branches and are not touched by `git push --all`.

## Non-goals

- No per-file or partial code rewind; a restore is all-or-nothing.
- No capture of `.gitignore`d files.
- No moving HEAD, committing, stashing, or pushing.
- No non-git projects for code snapshots (conversation-only rewind still works
  outside git).
- No ref cleanup on session end; snapshots persist until pruned or cleared.
- No migration of the old `refs/pi/checkpoints/*` snapshots.

## Pi integration

| Integration point | Value |
|---|---|
| Model-facing tools | None. `/rewind` is user-driven; automatic snapshots cover the start of every task. |
| Commands | `/rewind` (`pi.registerCommand`). |
| Events | `session_start` (reset run state, status, stale-index sweep), `session_tree` (status refresh after tree navigation), `before_agent_start` (capture prompt summary), `tool_call` (take the run's snapshot before the first mutating call), `session_shutdown` (release indexes, clear status). |
| State storage | Git refs `refs/pi/rewind/<id>` with metadata in the commit body. No tool-result `details` and no `pi.appendEntry`. |
| Lifecycle | Index paths are created lazily and released in `session_shutdown`; status chip is set on start/tree/snapshot and cleared on shutdown. |

## Design notes

- **One snapshot per user prompt.** The unit is the task, not the tool call:
  `before_agent_start` records the prompt summary and the run's first mutating
  tool call takes the snapshot before any mutation. The run-scoped flag is set
  synchronously before the first `await`, so parallel tool calls cannot
  double-snapshot.
- **The timeline comes from the session tree, not from git.** `/rewind` lists
  every user message on the active branch and pairs each with the snapshot whose
  recorded `entryId` matches, so read-only prompts appear too and the list
  follows `/tree` navigation. Conversation rewind calls `ctx.navigateTree` on the
  parent of the selected message and returns its text to the editor, leaving the
  abandoned branch reversible.
- **Snapshots are git refs, not copied files.** A tree is built from the working
  tree and stored as a commit under `refs/pi/rewind/<id>`, reusing git's
  content-addressed storage, surviving `git gc`, and staying listable with
  ordinary plumbing. A side directory would duplicate the tree and ignore git's
  ignore rules; `git stash` cannot reliably include untracked files and pollutes
  the stash list.
- **A temporary index keeps the real index and HEAD untouched.** Staging goes
  through `GIT_INDEX_FILE` under `.git/pi/`. Because `pi.exec` has no `env`
  option the variable is set on `process.env`, so every staging operation is
  serialized through one promise queue in `runtime.ts`; read-only listings are
  not queued.
- **Rewind is `read-tree --reset -u` plus explicit untracked removal.** The
  target tree is loaded into the index and tracked tree; paths added since the
  snapshot are computed and deleted explicitly. HEAD is never passed to
  `read-tree`, and rewind refuses while a merge, rebase, cherry-pick, revert, or
  bisect is in progress.
- **Untracked handling is symmetric.** `includeUntracked` governs both capture
  and the removal set, and the flag is recorded in metadata so a later-session
  restore is interpreted the same way. When `false`, a rewind cannot delete a
  file the snapshot never contained.
- **Metadata is versioned in the commit body (v3).** A malformed line, or one
  from another schema version, is skipped rather than trusted; the ref name is
  treated as identity. The recorded `sessionId` guards against matching a
  same-id entry from another session or a fork.
- **A pre-restore safety snapshot makes code rewind undoable.** Unless disabled,
  restore first snapshots the current state with reason `pre-restore`.
  Conversation rewind is already reversible through `/tree`.
- **Worktrees share refs, so roots are recorded and filtered.** Each snapshot
  records its `root`; listing and matching filter to the current root and
  restoring another worktree's snapshot is refused. The effective root follows
  `PI_WORKTREE_ROOT` when set.
- **Identity is fixed for internal commits.** `commit-tree` runs with
  `-c user.name=pi -c user.email=pi@local`, so snapshots work without committer
  identity configured and never depend on the user's git config.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Registrar: wire the runtime, the command, and the per-prompt snapshot events (`registerRewind`). |
| `types.ts` | `Snapshot`, `SnapshotReason`, `RestoreSummary`. |
| `config.ts` | Config defaults and merge/normalize over `lib/config.ts`. |
| `git.ts` | Single git entry point: rewind plumbing, the shared read helpers rewind consumes, and the production `RunGit`. |
| `snapshot.ts` | Create a snapshot (tree from a temporary index → commit → ref). |
| `restore.ts` | Plan and apply a working-tree rewind. |
| `store.ts` | Versioned metadata encoding and ref-backed listing/pruning. |
| `policy.ts` | Which tool calls are worth a snapshot. |
| `temp-index.ts` | Per-process `GIT_INDEX_FILE` paths: create, release, and sweep stale files. |
| `status.ts` | The `↺ N` status chip. |
| `runtime.ts` | Root/config caches, the serialized git queue, and the snapshot/list/plan/restore operations. |
| `timeline.ts` | Pure: prompts on the branch, paired with their snapshots. |
| `rewind.ts` | Scope choice, confirmation, and applying code + conversation rewind. |
| `rewind-tui.ts` | The selectable, width-safe timeline component. |
| `commands.ts` | The `/rewind` command. |
| `format.ts` | Model-facing and transcript text (pure). |
