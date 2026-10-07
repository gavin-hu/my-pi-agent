# checkpoint — working-tree snapshots and rewind for Pi

Snapshot the working tree before risky changes and rewind to an earlier
snapshot. A checkpoint is a git commit kept under `refs/pi/checkpoints/<id>`;
restoring one rewrites the working tree and index **without moving HEAD**, so
commits, branches, and the reflog are untouched.

```
pi --extension ./extensions/checkpoint   # load just this extension
pi -e .                                  # load the whole @gavin-hu/my-pi-agent package
pi install ./                            # install the package
```

## What it does

- Registers one model-callable tool, `checkpoint`, with five actions:
  `save`, `list`, `diff`, `restore`, `clear`.
- Takes an **automatic** snapshot before the first mutating tool call of each
  turn (configurable to per-call or off), so a bad edit can be undone with
  `restore`.
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
filter to the current root by default, and restoring a snapshot from another
worktree is refused unless you ask for it.

## Tool

| Field | Value |
|---|---|
| `name` | `checkpoint` |
| `action` | `save`, `list`, `diff`, `restore`, or `clear`. |
| `label` | Optional label for `save` (at most 120 characters). |
| `id` | Checkpoint id for `diff`/`restore`; defaults to the newest (`"last"`). |
| `all` | For `list`/`clear`, include every worktree's checkpoints. |

Validation (a violation returns an error result without running git): a known
`action`, a label within the limit, and an id matching `[A-Za-z0-9][A-Za-z0-9._-]*`.

`restore` requires an interactive UI to confirm; headless it refuses rather than
overwriting the working tree silently.

## Command

| Command | What it does |
|---|---|
| `/checkpoint` | List checkpoints for the current worktree. |
| `/checkpoint save [label]` | Save a snapshot now. |
| `/checkpoint diff [id]` | Show what changed since a snapshot. |
| `/checkpoint restore [id]` | Rewind; picks from a list when no id is given. |
| `/checkpoint clear` | Delete this worktree's checkpoint refs. |

## Configuration

Merged from `~/.pi/agent/checkpoint.json` (global) and `<root>/.pi/checkpoint.json`
(project); project values win.

```json
{
  "enabled": true,
  "mode": "turn",
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
| `enabled` | Take automatic snapshots at all. Default `true`. |
| `mode` | `"turn"` (first mutating call each turn), `"call"` (every mutating call), or `"off"`. |
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
| `index.ts` | Factory: wire the runtime, tool, command, and turn/auto-snapshot events. |
| `types.ts` | `Checkpoint`, `CheckpointDetails`, `RestoreSummary`, modes/actions. |
| `schema.ts` | TypeBox parameters and pure validation/normalization. |
| `config.ts` | Config defaults and merge/normalize over `_shared/config.ts`. |
| `git.ts` | Git plumbing behind an injectable `RunGit`. |
| `snapshot.ts` | Create a checkpoint (tree from a temporary index → commit → ref). |
| `restore.ts` | Plan and apply a rewind. |
| `store.ts` | Metadata encoding and ref-backed listing/pruning. |
| `policy.ts` | Which tool calls are worth a snapshot. |
| `runtime.ts` | Root/config caches, serialized runner, temp index, status chip. |
| `tools.ts` | `checkpoint` tool registration and rendering. |
| `commands.ts` | `/checkpoint`. |
| `format.ts` | Model-facing and transcript text (pure). |

## How snapshots are stored

Each snapshot is a commit under `refs/pi/checkpoints/<id>` whose body carries a
`pi-checkpoint: {json}` metadata line. A clean working tree still records a
commit (so the metadata always travels with the snapshot); git reuses the
identical tree object, so the only cost is a small commit. These refs are not
branches and are not touched by `git push --all`; remove them with
`/checkpoint clear` or `git update-ref -d <ref>`.
