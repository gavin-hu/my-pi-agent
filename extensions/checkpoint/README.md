# checkpoint — prompt-anchored working-tree snapshots for Pi

Snapshot the working tree at the start of each task and rewind to an earlier
snapshot from a menu. A checkpoint is a git commit kept under
`refs/pi/checkpoints/<id>`; restoring one rewrites the working tree and index
**without moving HEAD**, so commits, branches, and the reflog are untouched.

```
pi --extension ./extensions/checkpoint   # load just this extension
pi -e .                                  # load the whole @gavin-hu/my-pi-agent package
pi install ./                            # install the package
```

## What it does

- Takes **one automatic snapshot per user prompt**, before the prompt's first
  mutating tool call. A read-only prompt snapshots nothing.
- Labels each snapshot with a short summary of the prompt, so the list reads as
  a task timeline instead of a wall of tool names.
- `/checkpoint` opens a selectable menu: `↑↓`/`j`/`k` or the mouse wheel move
  the selection, `PgUp`/`PgDn` page, `Enter` restores (with a confirm and a
  diff preview), `d` shows the diff, `Esc` closes.
- Restoring is undoable: by default it first saves a `pre-restore` checkpoint of
  the current state.
- Shows a `⟲N` status chip with the number of checkpoints for the current
  worktree.
- Stores metadata in the commit body, so checkpoints survive across sessions and
  are listed from git rather than from session state.

Snapshots include tracked files plus (by default) untracked, non-ignored files.
`.gitignore`d files are never captured. Because refs live in the shared git
directory, a checkpoint taken inside a
[worktree](../worktree/) is visible from the main checkout; `list`/`restore`
filter to the current root by default.

## Tool

| Field | Value |
|---|---|
| `name` | `checkpoint` |
| `label` | Optional label for the saved snapshot (at most 120 characters). |

The only model action is `save`: mark a labeled point mid-task. The working tree
is already checkpointed automatically at the start of each prompt, and the user
restores checkpoints from the `/checkpoint` menu, so a rewind is always
user-confirmed.

## Command

| Command | What it does |
|---|---|
| `/checkpoint` | Open the selectable menu (prints the list in non-interactive modes). |
| `/checkpoint save [label]` | Save a snapshot now. |
| `/checkpoint diff [id]` | Show what changed since a snapshot. |
| `/checkpoint restore [id]` | Rewind; picks from the menu when no id is given. |
| `/checkpoint clear` | Delete this worktree's checkpoint refs, including orphaned refs. |

The menu is keyboard-driven: `↑`/`↓` or `j`/`k` move, `PgUp`/`PgDn`/`Home`/`End`
jump, `Enter` restores the focused checkpoint, `d` shows its diff, `s` saves a
new checkpoint (prompting for an optional label), `c` clears them, `Esc` closes.
Diff, save, and clear keep the menu open; the focused row loads its change stats
lazily.

## Configuration

Merged from `~/.pi/agent/checkpoint.json` (global) and `<root>/.pi/checkpoint.json`
(project); project values win.

```json
{
  "autoSnapshots": true,
  "max": 20,
  "includeUntracked": true,
  "safetyCheckpoint": true,
  "autoPrune": true,
  "showStatus": true,
  "watch": [],
  "ignore": [],
  "refNamespace": "refs/pi/checkpoints"
}
```

| Key | Meaning |
|---|---|
| `autoSnapshots` | Take one automatic snapshot per prompt. Default `true`. |
| `max` | Checkpoint refs kept per root before the oldest are pruned on save. |
| `includeUntracked` | Capture untracked, non-ignored files. |
| `safetyCheckpoint` | Save the current state before a restore. |
| `autoPrune` | Delete the oldest refs beyond `max` after saving. |
| `showStatus` | Draw the `⟲N` status chip. |
| `watch` | Extra tool names to treat as mutating. |
| `ignore` | Tool names never to snapshot; this package's own tools are always excluded. |
| `refNamespace` | Ref namespace for stored checkpoints. |

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: wire the runtime, tool, command, and per-prompt snapshot events. |
| `types.ts` | `Checkpoint`, `CheckpointDetails`, `RestoreSummary`. |
| `schema.ts` | TypeBox parameters and pure label validation for the save tool. |
| `config.ts` | Config defaults and merge/normalize over `_shared/config.ts`. |
| `git.ts` | Git plumbing behind an injectable `RunGit`. |
| `snapshot.ts` | Create a checkpoint (tree from a temporary index → commit → ref). |
| `restore.ts` | Plan and apply a rewind. |
| `store.ts` | Versioned metadata encoding and ref-backed listing/pruning. |
| `policy.ts` | Which tool calls are worth a snapshot. |
| `runtime.ts` | Root/config caches, serialized runner, temp index, status chip. |
| `tools.ts` | The save-only `checkpoint` tool. |
| `commands.ts` | `/checkpoint` and its subcommands. |
| `tui.ts` | The selectable, width-safe menu component. |
| `format.ts` | Model-facing and transcript text (pure). |

## How snapshots are stored

Each snapshot is a commit under `refs/pi/checkpoints/<id>` whose body carries a
`pi-checkpoint: {json}` metadata line at **schema version 2**. The metadata
records the id, reason, label, prompt summary, timestamp, root, branch, HEAD,
clean state, and the untracked flag. A ref written by another schema version is
ignored, so older refs are not misread; remove them with
`git update-ref -d` if desired.

A clean working tree still records a commit (so the metadata always travels with
the snapshot); git reuses the identical tree object, so the only cost is a small
commit. These refs are not branches and are not touched by `git push --all`.
