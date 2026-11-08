# goal — one objective, kept in view

The session pursues one high-level objective, shown above the editor and restated
to the model before every turn. The goal is the *what*; the [`todo`](../extensions/todo.md)
list is the *how*.

- **One objective at a time**, replaced whole rather than edited.
- **`planning`, `active`, or `achieved`** — a draft becomes active when you leave
  plan mode without approving, or takes the plan's own `Goal` when you approve.
- **It survives `/resume` and `/tree`**, because it belongs to the session branch.
- **Completed means read off the list**: `/goal done` names the todo items still
  open, so the goal cannot claim more than the work shows.

## What you can do

| What you want | What to do |
|---|---|
| Give the session an objective | `/goal ship the retry path this week` |
| Record it exactly as written | `/goal raw <text>` |
| See it | the `Goal · active · …` line above the editor |
| Finish it | `/goal done` — and read the open items it names |
| Change it | `/goal <new objective>`, or `/goal edit` |
| Clear it | `/goal clear` |
| Learn the verbs | `/goal help` |

## Try it

```text
/goal make the uploader retry-safe, with tests, before Friday
```

The goal is restated and, if it is unclear, asked about before it is recorded.
The rail then stays above the editor while it is pursued.
[Give the session a goal](../tutorials/first-goal.md) walks the restatement, the
planning question, and the completion that reads the task list.

## Reference

**The tool.** `goal` records, updates, and completes the objective; the model can
use it in plan mode too, which is how a plan's `Goal` section becomes the
session's.

**Phases.** `planning` is a draft the plan workflow opened, `active` is being
pursued, and `achieved` is done. Only the workflow opens a draft, and approving a
plan finalizes it from the plan's own `Goal` — there is no second dialog.

**Restatement.** The objective is injected as a `[SESSION GOAL]` bullet before
each turn; it does not enter the transcript.

**State.** The goal lives in the tool result and a session entry, so it follows
`/resume` and `/tree` and an abandoned branch never leaks in.

## Limits

- One goal: a new objective replaces the old one rather than adding to it.
- There are no sub-goals or priorities — that is what `todo` is for.
- An achieved goal is hidden by default; `goal.achieved: "show"` keeps the dimmed
  line.
- The rail shares the editor with the todo list and both step aside while a full
  screen is open.

## Settings

| Key | Default | What it does |
|---|---|---|
| `achieved` | `"hide"` | How an achieved goal renders: `show` keeps the dimmed line, `hide` removes it. |

It is a `bytefly.json` edit ([configuration](../configuration.md#goal--the-goal-widget)).
To switch the extension off, toggle `goal` in `/bytefly`.

## Learn more

- [Give the session a goal](../tutorials/first-goal.md) — the walkthrough.
- [`todo`](../extensions/todo.md) — the steps under the objective.
- [`plan`](../extensions/plan.md) — where a draft goal is finalized.
