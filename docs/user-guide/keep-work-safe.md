# 3. Keep your work safe

The features in this chapter answer three different worries: *I do not want this
experiment in my working copy*, *I want to undo a turn*, and *I do not want to
explain this again next week*. Worktrees isolate a task, rewind and review undo
one, and memory carries a fact across sessions.

**Use this chapter when** a task might leave a half-finished branch, when you are
about to let the assistant edit several files, or when you keep repeating the
same project fact in every new session.

## Working on a branch safely

### What it is

A **worktree** is a second copy of your project on its own git branch, in its own
folder. The assistant works there instead of in your checkout, so a half-finished
experiment never sits in the files you are using. While isolated, the normal file
and shell tools resolve paths inside the worktree, including the tools Pi
provides.

This feature needs `git` on `PATH` and a project folder that git tracks.

### When to use it

- A task is likely to take more than one turn and touch many files.
- You want to review the result before it reaches your main checkout.
- You are reviewing someone else's pull request and want its branch without
  disturbing your own.

For a one-file change, a normal turn plus `/review` is usually enough.

### Walkthrough

1. Start a task in isolation:

   ```text
   /worktree enter dark-mode
   ```

   You are now in `.pi/worktrees/dark-mode` on a branch called
   `worktree-dark-mode`. The footer shows the new branch and folder. A name is
   optional; without one, the extension generates one such as `calm-otter-421`.

2. Work as usual. Reading, editing, searching, and shell commands follow the
   worktree. Nothing you change there touches your main checkout.

3. When you are done, leave:

   ```text
   /worktree exit
   ```

   A clean worktree is removed. One with uncommitted changes or new commits is
   never thrown away silently: you are asked what to do, and the branch is kept
   if it holds work.

4. The exit result includes a handoff: the branch name, how many commits it has
   beyond the base, and the exact `git merge --no-ff` and `gh pr create` commands
   that finish the task. The tool itself never commits, merges, pushes, or opens
   a pull request.

5. See where things stand, or tidy up old worktrees:

   | Command | What it does |
   |---|---|
   | `/worktree` or `/worktree status` | Show the active worktree, isolation gaps, and managed worktrees |
   | `/worktree enter [name]` | Enter a worktree, creating it if needed |
   | `/worktree exit [--keep\|--remove]` | Leave; `--keep` keeps it, `--remove` removes it without asking and may discard uncommitted changes |
   | `/worktree prune` | Remove clean, unused worktrees older than seven days |
   | `pi --worktree <name>` | Start Pi already inside a worktree |

### Good to know

- A name can be a pull-request reference. `pi --worktree '#1234'` or
  `/worktree enter 'https://github.com/owner/repo/pull/1234'` fetches the pull
  request's head and creates `.pi/worktrees/pr-1234`, which makes reviewing a
  change a one-liner.
- By default a new worktree starts from the newest remote version of the main
  branch. A setting can start it from your current local commit instead; see
  [Configuration](../configuration.md#worktree--isolated-worktrees).
- A worktree is a fresh checkout, so gitignored files such as `.env` are missing.
  List them in a `.worktreeinclude` file at the repository root, and only files
  that match a pattern *and* are gitignored are copied into each new worktree.
  Without that file, the `include` config list is used.
- A subagent or a `pi` started from a tool inherits the active worktree through
  the environment and binds to the same folder. It cannot enter or exit a
  worktree itself; the parent owns the lifecycle.
- On Windows the PowerShell tool is refused while you are isolated, because it
  cannot be re-rooted and its grammar differs from `bash`. `bash` remains
  available and guarded. A setting can allow PowerShell again, at the cost of
  reporting the gap.
- The guard is best effort, not an OS sandbox. It blocks writes and edits outside
  the worktree, symlink escapes, `git -C`/`GIT_DIR` redirects, and `cd` outside
  it, but a program that computes and writes an absolute path itself can still
  escape. `/worktree` lists the gaps that apply to your session.

## Undoing a turn

### What it is

Before each prompt, **rewind** can record the state of your project. If a turn
makes a mess, `/rewind` restores the code, the conversation, or both, back to the
moment before that prompt.

This feature needs `git`. Snapshots are commits stored as git references under
`refs/pi/rewind`, outside your branches, and are never pushed. The `↺ N` chip
counts the prompts on the active branch; a diamond in the timeline marks the ones
that have a code snapshot.

### When to use it

Use rewind when a turn went in the wrong direction and you want the project or
the conversation back. Use [review](#reviewing-the-last-turn) when you want to
keep most of a turn and discard only some files or hunks.

### Walkthrough

1. Notice the `↺` chip in the footer. The number is how many prompts on this
   branch you can return to.

2. When something goes wrong:

   ```text
   /rewind
   ```

   A timeline opens, newest prompt first. A diamond marks prompts that have a
   code snapshot.

   <img src="../../assets/rewind.png" alt="The /rewind screen: prompts newest first, a diamond marking a code snapshot, and the focused prompt's detail" width="100%">

   *The timeline, newest first; diamonds mark prompts you can restore code from.*

3. Choose the prompt to return to:

   | Key | What it does |
   |---|---|
   | `↑` / `↓` or `j` / `k` | Move the selection |
   | `PgUp` / `PgDn`, `Home` / `End` | Jump a page, or to the ends |
   | `Enter` | Choose the focused prompt |
   | mouse wheel | Scroll |
   | `Esc` | Close without changing anything |

4. Choose what to restore: **Code and conversation**, **Conversation only**, or
   **Code only**.
   - *Conversation* moves the session tree back to that prompt and puts the
     prompt text back in the editor. The abandoned branch stays in the session.
   - *Code* rewrites the working tree to the snapshot.

5. If you chose code, a second step asks **Restore what?**: **Everything (N
   files)** or **Choose paths…**. The checklist groups changed paths by
   directory with `M`, `A`, `D`, or `R` marks. `Space` toggles a file or a
   directory, `a` selects all, `n` selects none, `Enter` restores the selection,
   and `Esc` cancels the whole rewind.

6. Before it writes anything, the current state is snapshotted too, so an undo
   can itself be undone. A confirmation with a diff preview shows what will
   change.

### Good to know

- Twenty snapshot refs are kept per root by default, including the pre-restore
  safety snapshots that make an undo possible. The oldest are pruned; a pruned ref
  is gone rather than hidden. **Snapshots kept** in `/bytefly settings` changes
  the number.
- A read-only prompt captures nothing. A prompt that changes files captures one
  snapshot before its first mutating call.
- Snapshots include tracked files plus untracked, non-ignored files by default.
  Gitignored files are never captured.
- The per-path checklist exists only in the terminal interface. In a session
  without a UI, `/rewind` prints the prompt list without restoring anything; an
  RPC session can choose a point and a scope through forwarded dialogs, but the
  path checklist is not available there either.
- Rewind tracks your project. Files outside it are untouched.
- Snapshots live in the shared git directory, so one taken inside a worktree is
  visible from the main checkout; the timeline filters to the current root by
  default.

### Reviewing the last turn

**What it is.** `/review` shows what the latest turn changed without opening the
rewind timeline. It compares the working tree with the snapshot taken before the
latest prompt on this branch, so you can read the diff and keep or discard each
file or hunk.

1. After a turn, run:

   ```text
   /review
   ```

   A file list opens. Each file is marked `M` (modified), `A` (added), `D`
   (deleted), or `R` (renamed), with added and removed line counts.

   <img src="../../assets/review.png" alt="The /review screen: changed files with M, A, and D marks, line counts, and the focused file's detail" width="100%">

   *The changed files from the latest prompt.*

2. In the list:

   | Key | What it does |
   |---|---|
   | `↑` / `↓`, `j` / `k` | Move the selection |
   | `PgUp` / `PgDn`, `Home` / `End` | Jump a page, or to the ends |
   | `Space` | Select or deselect the focused file |
   | `a` / `n` | Select all or none |
   | `Enter` | Open the focused file's diff |
   | `r` | Revert the selection, or the focused file when nothing is selected |
   | `R` | Revert every changed file |
   | `Esc` | Close without changing anything |

3. In a diff, `j` / `k`, the arrows, `PgUp` / `PgDn`, and `g` / `G` scroll. `r`
   reverts the whole file. `Esc` goes back to the list.

4. In a modified text file's diff, `h` opens the hunk checklist. `Space` ticks a
   hunk, `a` / `n` select all or none, `Enter` reverts the ticked hunks, and `Esc`
   cancels back to the diff. Everything not ticked stays as it is.

5. A revert asks for confirmation and takes one safety snapshot for the whole
   batch, so `/rewind` can undo it.

**Good to know.**

- Hunk selection covers modified text files. Added, deleted, renamed, and binary
  files revert whole. A renamed file is one `R` row; reverting it restores the old
  path and removes the new one together.
- If the working tree matches your last commit, the list says the changes are
  already committed. Reverting then rewrites the working tree but leaves the
  commit in place; the confirmation repeats this.
- Review actions exist only in the terminal interface. In text-only modes
  `/review` prints the changed-path list and says when the changes are committed.
- Plan mode refuses `/review` until the plan is approved, because a revert writes
  the working tree.

## Remembering between sessions

### What it is

**Memory** holds short notes that carry from one session to the next. Notes are
ordinary Markdown with one bullet per note, so you can read and edit them
yourself. Two scopes exist: **project** notes for this repository and **global**
notes for everything you do. Stored notes are injected into each run as a hidden
reminder, up to a size budget.

### When to use it

Use memory for durable facts that are not obvious from the code: a staging server
that must be running, a naming convention, a command that is not in the README.
Do not use it as a scratchpad or a substitute for project documentation.

### Walkthrough: let the assistant remember

1. Ask for something to be remembered:

   ```text
   remember that the API tests need the staging server to be up
   ```

   The note is saved and injected into every later run.

2. Review and tidy the notes:

   ```text
   /memory
   ```

   A picker lists the notes, grouped by scope.

   | Key | What it does |
   |---|---|
   | `Enter` or `e` | Edit the focused note |
   | `a` | Add a note to the active scope |
   | `m` | Mark a note to merge; `m` on a second note in the same scope opens an editor prefilled with both |
   | `p` | Move the note to the other scope |
   | `d` | Delete the focused note, after a yes/no confirmation |
   | `s` or `Tab` | Cycle the scope filter |
   | `r` | Re-read the notes from disk |
   | `Esc` | Cancel the current action, or close the picker |

   <img src="../../assets/memory.png" alt="The /memory picker: a scope summary, notes tagged by scope, and the key hints" width="100%">

   *The picker: filter by scope, then add, edit, merge, move, or delete.*

3. A deleted note is gone; the picker has no undo. Use `d` deliberately.

### Commands

| Command | What it does |
|---|---|
| `/memory list` | Show every stored note and the counts |
| `/memory path` | Show the two file locations and whether the project store is trusted |
| `/memory edit [project\|global]` | Open one store in an editor |
| `/memory reload` | Re-read the files after you change them by hand |
| `/memory doctor` | Report counts, sizes, notes omitted by the size budget, and near-duplicates |
| `/memory clear [project\|global]` | Clear a whole scope after a confirmation |

### Good to know

- A note is a single line of at most 500 characters. That keeps the reminder
  short and the file readable.
- Notes are injected only up to a byte budget (8 KiB by default). `/memory doctor`
  names any note that does not fit.
- The stores are `<repo-root>/.pi/memory.md` for the project and
  `<agent-dir>/memory.md` for global notes. The project store is anchored at the
  repository root, so it is the same when Pi runs from a subdirectory and across
  worktrees.
- Project notes are read and written only when Pi trusts the project. A move into
  an untrusted project is refused rather than silently dropping the note.
- `add` will not store a near-duplicate of an existing note under a conservative
  comparison (case, whitespace, and trailing punctuation do not matter). The
  result names the existing note so the assistant can update it instead.
- A merge is one write, and a move writes the destination before removing the
  source. A failed move can leave the note in both scopes; `/memory doctor`
  reports it, and merging removes the duplicate.

## Related

- [Plan and delegate](./plan-and-delegate.md) — the workflows these safeguards protect.
- [Reference](./reference.md#files-on-disk) — where snapshots, notes, and worktrees live.
- [Security](../security.md) — what the isolation boundary does and does not cover.

---

[← Previous: 2. Plan and delegate](./plan-and-delegate.md) · [Guide home](./README.md) · [Next: 4. Web and files →](./web-and-files.md)
