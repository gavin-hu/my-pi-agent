# Your first plan

Plan mode keeps the session read-only while the model investigates, then hands
you a plan to approve. This walkthrough takes one change from "start" to
"approved and running".

You need Pi and this package installed — see [Install](../install.md).

## Start with the change

```text
/plan add rate limiting to the public API
```

`/plan` with a line after it enters plan mode and sends that line as the task, so
the first turn already runs read-only. Without bytefly, bare `/plan` toggles the
mode; with bytefly loaded, `Shift+Tab` does the same from the editor.

What "read-only" means while you are here: the model keeps its readers and loses
its writers. `git status`, `diff`, `log`, and `show` still work; a write, an edit,
and a shell redirect are refused. Reads are not confined to the project, and a
delegated agent runs with writing forced off.

## Read the plan

The model investigates, then saves the plan file:

```text
plan write Add rate limiting
✓ Saved plan ~/.pi/agent/repos/a1f9c02b3d4e/plans/2026-10-09-1809-add-rate-limiting.md
```

`plan exit` is what opens the review screen on that file. On the screen: `n`/`p`
jump between sections, the usual scroll keys move through the body, and the footer
lists only the keys that apply. A plan you refined since the last look marks just
the sections that changed.

| Key | What it does |
|---|---|
| `a` | approve: plan mode ends, write access returns, the steps become your todo list |
| `r` | refine: edit the plan inline, then `Enter` sends it back to the model |
| `Esc` | keep planning: nothing is approved, the model is told to keep going |
| `x` | leave plan mode without approving; the plan file stays for later |
| `w` | open the same plan in your browser to comment on it |

## Approve it

`a` asks once, naming what the answer does — plan mode off and how many steps it
seeds into `todo` — and `y` or `Enter` confirms. Your task list gains the plan's
steps in order, appended after anything already on it and with the verification
item last; on an empty list they are the whole list. A session goal you had left
as a draft is finalized from the plan's `## Goal`, without another dialog.

From here the model executes the plan it wrote; `plan steps` ticks a step in the
file and in your todo list together.

## Comment in the browser

`w` opens the review page on `127.0.0.1`. Hover a block and press the `+` in its
margin, or select text first to quote it; **Save feedback** writes the comments
into the plan file and returns them to the model as review notes. A selection
locates the note in this tab: the plan stores the comment beside its block, not
the quoted text, so another reader sees the note without it. The `+` is
announced by its block — *Comment on “Approach”* — and it is drawn only while the
review can still take a comment — a settled review has none.

<img src="../../assets/screens/plan-review.png" alt="The review page in a browser: a plan title bar with the live chip, the shortcut key and the theme toggle; the page's own actions — Approve and run, Save feedback, Share, Back to Pi — in a second header row under it; a rail holding the plan's step progress as eight pips beside its count and the comment total, the Show in the plan caption over the All, Changed and Comments switch, the note under the switch saying there is no earlier review of this plan to compare against, the finish sentence, a seam, the sections list and the shortcut hints; the plan body with two comment threads in their margins, each with Resolve, Edit and Delete; and the plan's checklist drawn as ticked boxes" width="1280" height="2124">

*The review page: the plan's sections in the rail, the comments in the margin,
and the approval at the top.*

A comment being written or edited is this tab's draft: a reload keeps it, and so
does a repaint the page makes on its own. While it is open, Resolve, Edit, Delete
and the switch refuse rather than drop the text. `Esc` closes the edit, then the
composer, then the review, one layer at a time. **Save**, **Post** and **Back to
Pi** ask first while comments are unsaved.

On the owner's page a teammate's note carries Resolve too. Settling it flips the
note's flag and leaves her words as she wrote them; Edit and Delete stay hers.

A change that arrives from the model while a draft is open is held back with "A
change arrived; finish or discard your draft to see it." rather than repainted
under your cursor; it lands on the next frame, or on a reload.

The `?` in the corner opens the keys sheet, whose switch turns the single keys
off for this browser — the buttons, `Esc` and `?` still answer, and a reload
keeps them off. Paper is always the whole plan: with a shorter view the switch
and its count go, and every block returns.

For a teammate, **Share** prints a reviewer link and a QR code a phone can scan —
one per teammate, at most eight. Each person gets a link of their own (**New
link**), a reviewer's first post binds her name to that link, and **Revoke**
drops one link without touching the rest. Only the machine that opened the
review may approve; a reviewer's page reads and comments and draws no
**Approve & run**.

## Read only what changed

The switch at the head of the rail shows **All**, the **Changed** blocks, or the
**Comments**, and the line under it counts what the view hides. **Changed** is
off until this plan has an earlier review to compare against, and the button
says which: a first review has nothing to diff.

## Refine and approve again

If the review changes your mind, `r` refines — the model rewrites the same plan
file, the previous text is kept beside it, and only the sections that moved are
marked on the next review. Approving again replaces the todo items the earlier
approval added that nobody has started, so the list matches the plan you last
approved.

## Read a plan later

```text
/plan list
```

The list shows every saved plan with its title, when it last changed, and its
step progress, newest first; `Enter` opens one in the browser to read. Plans live under
`~/.pi/agent/repos/<repo-id>/plans/`, so every worktree of a repository shares the same
store.

## Where to go next

- [`plan`](../extensions/plan.md) — actions, caps, and the read-only rules.
- [`todo`](../extensions/todo.md) — the list an approval seeds.
- [`goal`](../extensions/goal.md) — the objective an approval can set.
