# Work in a worktree

A worktree is a second checkout of the same repository on its own branch. Pi's
own built-in tools keep taking ordinary relative paths — they just resolve inside
the worktree from now on, so a task is isolated without changing how you work.

You need Pi and this package installed — see [Install](../install.md).

## Start one

```text
/worktree enter feature-auth
```

That creates `<repo>/.pi/worktrees/feature-auth` on branch `worktree-feature-auth`,
cut from the remote's default branch, and moves the session into it. To start a
session already isolated:

```bash
pi -e . --worktree feature-auth
```

The first worktree offers to add `.pi/worktrees` to `.gitignore`, so the
checkouts do not show up in `git status`.

## Work as usual

`read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls` all work with relative
paths inside the worktree. What changes is the boundary:

- a write or edit whose path resolves outside the worktree is refused, including
  one that escapes through a symlink;
- `git -C <main repo>`, `GIT_DIR=`, `GIT_WORK_TREE=`, and `cd` outside the
  worktree are refused in `bash`;
- a fetch for the base branch or a pull request runs with prompting off, so a
  missing credential fails fast instead of hanging.

The tool never commits, merges, pushes, or opens a PR — those stay your decisions,
and `exit` prints the commands.

## Check what is open

```text
/worktree
```

The screen lists every managed worktree with its state — current, dirty, ahead,
behind, merged, locked, last used — and the focused one's path, base, and what
isolation does not cover. `j`/`k` move, `Enter` opens the detail, `e` enters, `x`
exits, `p` prunes, `Esc` closes. Outside the terminal the same facts print as
text.

## Leave, with the work safe

```text
/worktree exit
```

A clean worktree this session created is removed. One holding uncommitted changes
or new commits asks first — and in a non-interactive run it is kept rather than
deleted. The result ends with a handoff: the branch, how many commits it holds
beyond the merge target, and the commands that finish it.

```text
Handoff: worktree-feature-auth is 1 commit ahead of main.
  merge:  git switch main && git merge --no-ff worktree-feature-auth
  or PR:  gh pr create --head worktree-feature-auth --fill
```

To clean up after yourself later:

```text
/worktree prune
```

Only clean, unused worktrees older than `pruneAfterDays` (seven by default) go;
each one kept is reported with its reason.

## Bring the files git ignores

`.env`, a local config, a cache — files git ignores are not in a fresh worktree.
List them in a `.worktreeinclude` file at the repository root, or in
`worktree.include`, and each new worktree is seeded with a copy.

## What is not isolated

The guard covers Pi's own tools, not the operating system:

- a shell you run yourself (`!` in the TUI) runs where the TUI was started, not
  in the worktree — the guard covers Pi's tools, not the terminal's own process;
- command substitution, `eval`, and `sh -c` are only covered with
  `guard.blockUnparsableCommands` on;
- Windows' `powershell` is refused while isolated, not parsed.

`/worktree` names those gaps on every status read, so the edge is visible rather
than assumed.

## Where to go next

- [`worktree`](../extensions/worktree.md) — actions, keys, and every setting.
- [`rewind`](../extensions/rewind.md) — snapshot before each prompt's first change.
- [`plan`](../extensions/plan.md) — design a task before you cut a branch.
- [`session-bus`](../extensions/session-bus.md) — several sessions, one repository.
