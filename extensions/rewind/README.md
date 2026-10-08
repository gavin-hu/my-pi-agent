# rewind — prompt-anchored snapshots and conversation rewind for Pi

Snapshot the working tree at the start of each task and return to an earlier
prompt from a menu — restoring the **code**, the **conversation**, or **both**.
A snapshot is a git commit kept under `refs/pi/rewind/<id>`; restoring one
rewrites the working tree and index **without moving HEAD**, so commits, branches,
and the reflog are untouched. Conversation rewind uses Pi's session tree, so the
branch you leave is not erased.

```
pi --extension ./extensions/rewind   # load just this extension
pi -e .                              # load the whole @gavin-hu/my-pi-agent package
pi install ./                        # install the package
```

## What it does

- Takes **one automatic snapshot per user prompt**, before the prompt's first
  mutating tool call. A read-only prompt snapshots nothing.
- `/rewind` lists **every user prompt on the active branch** (newest first), each
  marked `↺` when a code snapshot was captured for it.
- Picking a point asks what to restore: **Code and conversation**,
  **Conversation only**, or **Code only**.
  - *Code* rewrites the working tree to the snapshot and is itself undoable
    (a `pre-restore` safety snapshot is taken first).
  - *Conversation* moves the session tree back to that prompt and puts the
    prompt text back in the editor; the abandoned branch stays in the session.
- Shows a `↺ N` status chip counting the prompts on the active branch that have
  a code snapshot — the same points `/rewind` can code-restore.
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
closes. In RPC mode the timeline falls back to `select`; in print/JSON modes the
prompt list is printed.

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

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: wire the runtime, the command, and the per-prompt snapshot events. |
| `types.ts` | `Snapshot`, `SnapshotReason`, `RestoreSummary`. |
| `config.ts` | Config defaults and merge/normalize over `_shared/config.ts`. |
| `git.ts` | Git plumbing behind an injectable `RunGit`. |
| `snapshot.ts` | Create a snapshot (tree from a temporary index → commit → ref). |
| `restore.ts` | Plan and apply a working-tree rewind. |
| `store.ts` | Versioned metadata encoding and ref-backed listing/pruning. |
| `policy.ts` | Which tool calls are worth a snapshot. |
| `runtime.ts` | Root/config caches, serialized runner, temp index, status chip. |
| `timeline.ts` | Pure: prompts on the branch, paired with their snapshots. |
| `rewind.ts` | Scope choice, confirmation, and applying code + conversation rewind. |
| `rewind-tui.ts` | The selectable, width-safe timeline component. |
| `commands.ts` | The `/rewind` command. |
| `format.ts` | Model-facing and transcript text (pure). |

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
