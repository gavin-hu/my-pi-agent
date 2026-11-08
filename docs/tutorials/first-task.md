# Track your first task

This walkthrough shows the task list working on a real job: what the model
keeps, what you see, and how to change the plan without touching it yourself.

You need Pi and this package installed — see [Install](../install.md).

## Give it something with steps

Ask for work that takes more than one move:

```text
Refactor the uploader to retry three times, and add tests.
```

As soon as the model starts, a one-line rail appears above your editor:

```text
Todos · 1/3 · Writing the retry tests
```

That is the whole status: how many items are done, and the one in progress. When
the last item is done the rail reads `Todos · 3/3 completed`, and it leaves your
screen when the list is cleared, so a finished job ends clean.

## Read the whole plan

Type `/todos`:

```text
/todos
```

The list opens in the order the model wrote it, so it reads as the plan rather
than as history. `↑`/`↓` or `j`/`k` scroll one row, `PgUp`/`PgDn` page, `g`/`G`
jump to the ends, and `Esc` closes it.

Left open, the screen follows the live list: an item the model completes while
you are reading is ticked in front of you.

## Change the plan in words

You never edit the list. Drop a step the way you would say it in a review:

```text
Drop the migration; keep the retry tests and the changelog entry.
```

The model rewrites the list in one call and the rail updates. Because the whole
list is replaced each time, there is no half-edited item and no id to quote.

## What happens on a long job

- **A stale list gets one nudge.** When substantial work lands and the list has
  not moved, the extension asks the model to update it — once per turn. You can
  also say "update the todos" at any point.
- **The list belongs to the session.** It survives `/resume` and `/tree`, and
  each branch restores the list that belongs to it; a new session starts empty.
- **The rail shares the editor with `goal`.** The goal line sits above the task
  list, and both step aside while a full screen is open.

## Where to go next

- [Give the session a goal](./first-goal.md) — the other rail, and why `/goal
  done` reads this list.
- [`todo`](../extensions/todo.md) — the command, the rules the model works
  under, and the one setting.
- [`goal`](../extensions/goal.md) — a single objective kept in view.
- [`plan`](../extensions/plan.md) — when the job deserves a plan you approve
  before anything is written.
