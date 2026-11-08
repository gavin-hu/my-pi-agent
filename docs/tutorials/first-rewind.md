# Go back to an earlier prompt

`rewind` snapshots your working tree before each prompt's first change, so a turn
that went wrong is one screen away. This walkthrough restores the code, then the
conversation, and then the state the restore itself replaced.

You need Pi and this package installed — see [Install](../install.md).

## Let a prompt change things

```text
Move the uploader to fetch and drop the retry loop.
```

You do nothing to prepare: before the first write of a prompt, a snapshot records
the tree as it was — tracked files plus untracked files git does not ignore. One
snapshot per prompt, so the timeline matches the prompts you remember rather than
every tool call.

## Open the timeline

```text
/rewind
```

Rows are newest first, with a `⬥` beside every prompt that holds a snapshot and a
detail line naming the one the focused row holds. `↑`/`↓` or `j`/`k` move,
`PgUp`/`PgDn`/`Home`/`End` jump, and `Enter` picks the prompt.

## Choose what comes back

After `Enter` the screen asks for a scope:

- **Code only** — the working tree, with `HEAD` and your index left where they
  are. If several paths changed it asks **Everything (N files)** or **Choose
  paths…**, where the checklist takes `Space` per file, `a`/`n` for all or none,
  and `Enter` to confirm.
- **Conversation only** — the session tree moves back to that turn and the prompt
  text returns to your editor, so you can re-send it edited. Nothing on disk
  changes.
- **Both** — the two together, for a turn that went wrong in both directions.

A confirmation with a diff preview is the last step, so you see what a restore
will write before it writes it.

## Undo the undo

The state a code restore replaces is snapshotted first, so a second `/rewind`
brings back what you just discarded. Nothing here is one-way while the ref cap
holds — snapshots live under `refs/pi/rewind` and stay until the oldest is pruned
at `max`, twenty by default.

## When it refuses

- A merge, rebase, cherry-pick, revert, or bisect in progress refuses the
  restore rather than fighting it — finish the operation first.
- Ignored files are not captured, so a `.env` a turn deleted does not come back.
- The path checklist is terminal-only: a print, JSON, or RPC run restores the
  whole tree, with no typed path syntax.

A project that is not a git repository still gets conversation rewinds; only code
snapshots need git.

## Where to go next

- [`rewind`](../extensions/rewind.md) — what a snapshot captures, where the refs
  live, and every setting.
- [`worktree`](../extensions/worktree.md) — isolate a task so a rewind has less
  to restore.
- [`plan`](../extensions/plan.md) — design before writing, so fewer rewinds.
