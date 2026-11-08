# plan — decide before the model writes

Plan mode keeps the session read-only while the model investigates, then hands
you a plan to approve. Nothing lands in your tree until you say yes.

<img src="../../assets/screens/plan.png" alt="The terminal plan review: a Plan Review title rule, a changed-section notice, the plan body with ◼/◻ step boxes, a scroll gauge naming the section and line range, and the Esc/a/r/w, scroll, and section-jump hints" width="100%">

- **Use it for** any change you would want to read before it lands.
- **`/plan <task>`** starts one; `Shift+Tab` toggles plan mode too.
- **Nothing is written** — not a file, not a command — until you approve.

## What you can do

| What you want | What to do |
|---|---|
| Start a task read-only | `/plan add rate limiting to the public API` |
| Switch plan mode on or off | `/plan`, or `Shift+Tab` with bytefly |
| Let the model propose it | it asks first; decline and the session keeps write access |
| Read the plan | the review screen: `n`/`p` between sections, scroll keys for the body |
| Approve and start | `a`, then `y` — steps become your todo list |
| Ask for a change | `r` to refine, or comment in the browser |
| Review with a teammate | `w` for the browser page, then **Share** for a QR or link |
| Leave without approving | `Esc` keeps the plan, `x` leaves plan mode |
| Read an older plan | `/plan list`, then `Enter` |

## Try it

```text
/plan add rate limiting to the public API
```

The model reads the code and the git history, never the write path. When it is
done it saves a plan under `~/.pi/agent/plans/<repo-key>/` and opens the review
screen; `a` approves it, `r` sends it back for a change.

A full walkthrough — refining, commenting, sharing with a teammate — is
[Your first plan](../tutorials/first-plan.md).

## Reference

The `plan` tool has five actions; `/plan` is the command that drives it.

| Action | What it does |
|---|---|
| `enter` | take write access away, after asking you |
| `write` | save the plan file; `plan_path` refines an existing one |
| `exit` | read the plan back and present it for approval |
| `steps` | tick a step in the file and in its todo item, in one call |
| `cancel` | leave plan mode, keeping any saved plan |

**The plan file.** `<agent-dir>/plans/<repo-key>/<date>-<slug>.md`, one store per
repository, shared by its worktrees. A refinement keeps the previous text beside
it as a dotfile, up to five revisions, so two rounds are diffable. The file is
the artifact the model executes; approval records its steps in `todo` and, when
a goal was only drafted, sets the session goal from the plan's `## Goal`.

**Review screen keys.** `a` approve (`y`/`Enter` confirms), `r` refine inline,
`Esc` keep planning, `x` exit without approving, `w` open the browser review,
`n`/`p` jump sections. `Ctrl+C` interrupts without settling the review: plan mode
stays on.

**Browser review.** The page carries the plan's title, the live comment count,
**Approve & run**, **Save feedback**, and **Back to Pi**; a comment-only review
has no approve action. Hover a block for **+ Comment**, or select text to quote
it. **Share** opens the review on this Wi-Fi with a link and QR per teammate (at
most eight), each binding the reviewer's name on its first post; **Revoke** drops
one link. Only the serving machine may approve, cancel, save, or share.

**Read-only means:** readers stay, writers go; `git status`, `diff`, `log`, and
`show` still run through `bash`, and any other command, redirect, or path outside
the project is refused. A delegated agent runs with `readOnly: true`.

## Limits

- Read-only is a guard rail against accidents, not a sandbox — extensions share
  Pi's permissions.
- A plan holds at most 50 steps and 256 KiB; a bigger one is refused rather than
  trimmed.
- Plan mode has no PowerShell on Windows: Git Bash is the shell, and it has to be
  installed.
- The browser review needs `serve` and a local browser; a reviewer's page is only
  reachable while its link is shared.
- The plans directory is the only index — nothing deletes a plan for you.

## Learn more

- [Your first plan](../tutorials/first-plan.md) — the walkthrough.
- [`todo`](../extensions/todo.md) — where the steps land.
- [Security](../security.md) — what a shared review link is.
