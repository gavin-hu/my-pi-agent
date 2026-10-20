# rewind — prompt-anchored snapshots and conversation rewind for Pi

Snapshot the working tree at the start of each task and return to an earlier
prompt from a menu — restoring the **code**, the **conversation**, or **both**.
`/review` uses the same snapshot to show the latest turn's changes and revert one
file or the whole turn. A snapshot is a git commit kept under
`refs/pi/rewind/<id>`; restoring one rewrites the working tree **without
touching the real index or moving HEAD**, so commits, branches, staged state, and
the reflog are untouched. Conversation rewind uses Pi's session tree, so the
branch you leave is not erased.

This is the `rewind` extension entrypoint; it is one of two sibling git
extensions in this package (`worktree` is the other).

<img src="../../assets/rewind.png" alt="The /rewind screen: prompt rows newest first, a diamond marking prompts with a code snapshot, and the focused prompt's snapshot detail" width="100%">

<img src="../../assets/review.png" alt="The /review screen: changed files with M, A, and D marks, line counts, and the focused file's detail" width="100%">

```
pi --extension ./extensions/rewind   # load this extension alone
pi -e .                              # load the whole @gavin-hu/my-pi-agent package
pi install ./                        # install the package
```

## What it does

- Takes **one automatic snapshot per user prompt**, before the prompt's first
  mutating tool call. A read-only prompt snapshots nothing.
- `/review` compares the working tree with the snapshot taken before the latest
  prompt on the active branch. The file list carries `M`/`A`/`D` and line
  counts; `Enter` opens a scrollable patch, `r` reverts the focused file, and
  `R` reverts every changed path. Each revert asks first and takes the usual
  pre-restore safety snapshot.
- `/rewind` lists **every user prompt on the active branch** (newest first), each
  marked `⬥` when a code snapshot was captured for it.
- Picking a point asks what to restore: **Code and conversation**,
  **Conversation only**, or **Code only**.
  - *Code* rewrites the working tree to the snapshot and is itself undoable
    (a `pre-restore` safety snapshot is taken first).
  - When code moves, a second step asks **Restore what?** — **Everything (N
    files)** or **Choose paths…**. The checklist lists every changed path
    grouped by directory (`M` modified, `D` deleted since the snapshot, `A`
    created after it), with all of them selected, so `Enter` twice reproduces a
    whole-tree restore. `Space` toggles a file or a directory, `a`/`n` select
    all/none, and the confirm that follows previews only the chosen subset.
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
| `/rewind` | Open the timeline; pick a prompt, then a restore scope, then (for code) the paths. |
| `/review` | Review the latest prompt's changes; open a diff, revert a file, or revert all of them. |

The path checklist is its own `ctx.ui.custom` screen: `Space` toggles the focused
row, `a`/`n` select all or none, `Enter` returns the selection, and `Esc` cancels
the rewind.

The timeline is keyboard-driven: `↑`/`↓` or `j`/`k` move, `PgUp`/`PgDn`/`Home`/`End`
jump, `Enter` chooses the focused prompt, the mouse wheel scrolls, `Esc` closes.
The scope choice and the confirmation (with a diff preview) run after the screen
closes. The path checklist is the same grammar: `Space` toggles, `a`/`n` select
all or none, `Enter` restores the selection, `Esc` cancels the rewind.

The review list is keyboard-driven too: `↑`/`↓` or `j`/`k` move, `PgUp`/`PgDn` and
`Home`/`End` jump, `Enter` opens the focused file's diff, `r` reverts that file,
`R` reverts every changed path, and `Esc` closes. In the diff, `j`/`k`, the arrows,
`PgUp`/`PgDn`, and `g`/`G` scroll, `r` reverts the file, and `Esc` goes back.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| Interactive TUI | Full selectable timeline, then the scope choice, the path checklist, and the confirmation. `/review` mounts the changed-file list and the per-file diff. |
| RPC (`hasUI`) | Timeline falls back to `ui.select`; scope choice and confirmation use forwarded dialogs. `/review` prints the changed-path list. |
| `print` / `json` | No picker: the prompt list is printed. `/review` prints the changed-path list. |

## Configuration

The `rewind` section of the shared `bytefly.json` (global document, then
`<root>/.pi/bytefly.json`, project wins).

```json
// bytefly.json → "rewind"
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

## Limitations

- **The path checklist is TUI-only.** RPC, `print`, and `json` modes restore the
  whole tree; there is no typed path syntax, because a list of exact paths is what
  the checklist is for and a glob would need its own validation and preview.
- **`/review` is whole-file only.** There is no hunk selection. A rename is two
  rows (`D` old, `A` new), so reverting both undoes it and reverting one leaves
  the pair half-applied.
- **`/review` follows the latest prompt with a snapshot.** A read-only prompt
  after it does not change the target, and a turn whose snapshot failed has no
  review of its own. Actions are TUI-only; other modes print the changed list.
- **`/review` refuses while plan mode is on.** Plan mode is read-only, so approve
  the plan before reverting its changes.

## Non-goals

- No capture of `.gitignore`d files.
- No moving HEAD, committing, stashing, or pushing.
- No non-git projects for code snapshots (conversation-only rewind still works
  outside git).
- No ref cleanup on session end; snapshots persist until pruned or cleared.
- No migration of the old `refs/pi/checkpoints/*` snapshots.

## Pi integration

| Integration point | Value |
|---|---|
| Model-facing tools | None. `/rewind` and `/review` are user-driven; automatic snapshots cover the start of every task. |
| Commands | `/rewind` and `/review` (`pi.registerCommand`). |
| Events | `session_start` (reset run state, status, stale-index sweep), `session_tree` (status refresh after tree navigation), `before_agent_start` (record the prompt — absent on a run a custom message starts — and resolve the run's snapshot decision), `tool_call` (take the run's snapshot before the first mutating call), `session_shutdown` (release indexes, clear status). |
| State storage | Git refs `refs/pi/rewind/<id>` with metadata in the commit body. No tool-result `details` and no `pi.appendEntry`. |
| Lifecycle | Index paths are created lazily and released in `session_shutdown`; status chip is set on start/tree/snapshot and cleared on shutdown. |

## Design notes

- **One snapshot per user prompt.** The unit is the task, not the tool call:
  `before_agent_start` records the prompt summary and resolves the run's root,
  policy, and config, so the first mutating `tool_call` takes the snapshot with a
  fully synchronous guard. No `await` sits between that guard's check and its
  claim, so parallel sibling calls cannot double-snapshot. A run a custom message
  starts (a wake) has no prompt to record; the snapshot it takes is otherwise the
  same.
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
  through `GIT_INDEX_FILE` under the worktree's own git dir (`<git-dir>/pi/`:
  `.git/pi/` in the main checkout, `.git/worktrees/<name>/pi/` in a linked
  worktree), so concurrent sessions never share a staging index. Because
  `pi.exec` has no `env` option the variable is set on `process.env` for the
  duration of a call, so every staging operation is serialized through the queue
  in `queue.ts`; read-only listings are not queued.
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
- **Review is derived, not stored.** `/review` uses the same
  `buildRewindPoints` pairing as `/rewind`, calls `planRestore`, and fetches a
  patch only when a file is opened. A revert is the existing subset restore, so
  the safety snapshot and the working-tree-only rewrite are the ones `/rewind`
  already guarantees.
- **Identity is fixed for internal commits.** `commit-tree` runs with
  `-c user.name=pi -c user.email=pi@localhost`, so snapshots work without committer
  identity configured and never depend on the user's git config.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Registrar: wire the runtime, the commands, and the run-state module to Pi's events (`registerRewind`). |
| `types.ts` | `Snapshot`, `SnapshotReason`, `RestoreSummary`. |
| `config.ts` | Config defaults and merge/normalize over `lib/config.ts`. |
| `git.ts` | Single git entry point: rewind plumbing, the shared read helpers rewind consumes (name status, stat, patch, and `--numstat`), and the production `RunGit`. |
| `snapshot.ts` | Create a snapshot (tree from a temporary index → commit → ref). |
| `snapshot-run.ts` | Per-run automatic-snapshot state: one snapshot per prompt, with a synchronous guard. |
| `restore.ts` | Plan and apply a working-tree rewind, whole or for a chosen subset of paths. |
| `paths.ts` | Pure: the changed-path list from `git diff --name-status`, its directory grouping, the change marks, the `--numstat` counts, and the restore counts. |
| `path-picker.ts` | The checklist screen a partial restore opens: grouped paths, toggles, and the selection it returns. |
| `store.ts` | Versioned metadata encoding and ref-backed listing/pruning. |
| `policy.ts` | Which tool calls are worth a snapshot. |
| `temp-index.ts` | Per-process `GIT_INDEX_FILE` paths: create, release, and sweep stale files. |
| `status.ts` | The `↺ N` status chip. |
| `queue.ts` | The serialized git operation queue for staging calls (`GIT_INDEX_FILE`). |
| `runtime.ts` | Root/config caches and the snapshot/list/plan/patch/numstat/restore operations. |
| `timeline.ts` | Pure: prompts on the branch, paired with their snapshots. |
| `rewind.ts` | Scope choice, the path step, confirmation, and applying code + conversation rewind. |
| `review.ts` | The `/review` orchestration: the latest snapshot, the list/diff loop, confirmations, and the revert. |
| `review-tui.ts` | The changed-file list and the scrollable per-file diff. |
| `rewind-tui.ts` | The selectable, width-safe timeline component, drawn from the `lib/tui/` kit (`titleRule`, `dockListFrame`, `listRow`, `emptyState`). |
| `commands.ts` | The `/rewind` and `/review` commands. |
| `format.ts` | Pure rewind and review text, including diff bounding. |
