# todo — keep the task list in view

The model keeps a task list for whatever it is working on, and you can see it
above the editor at any moment.

<img src="../../assets/screens/todo.png" alt="The /todos screen: a Todos title rule, a 3/7 completed summary, and the list with check, spinner, and circle glyphs" width="100%">

- **Use it for** work longer than a couple of steps.
- **You don't drive it** — the model rewrites the list; ask for a change in words.
- **`/todos`** shows the whole list whenever you want to look.

## What you can do

| What you want | What to do |
|---|---|
| See how far the work has got | the line above the editor: `Todos · 1/3 · Writing the tests` |
| Read the plan the model is following | `/todos` |
| Change the plan | say so in your next message; the model rewrites the list |
| Keep the list across `/resume` and `/tree` | nothing — it follows the session branch |
| Clear the rail once everything is done | nothing — it hides itself |

## Try it

Ask for a job with steps, then watch the rail:

```text
Refactor the uploader to retry three times, and add tests.
```

```text
/todos
```

`↑`/`↓` or `j`/`k` scroll the screen, `PgUp`/`PgDn` page, `g`/`G` jump to the
ends, and `Esc` closes it. A whole job is walked through in
[Track your first task](../tutorials/first-task.md).

## Reference

The model calls one tool, `todo`, with the complete list; an empty list clears
it. A call that breaks a rule is refused with the previous list intact, so the
model retries rather than half-applying:

- one item `in_progress` at a time, with a present-continuous label;
- at most 50 items, at most 500 characters each;
- non-empty, unique text;
- every row is collapsed to one terminal-safe line before it is stored.

The list is session state, not a file: a new session starts empty, and
`/resume` or `/tree` restores the list for that point in history. The rail and
the `/todos` screen need interactive mode; RPC and print runs get the tool
result only.

## Limits

- No priorities, due dates, dependencies, or per-item edit command.
- The list is not shared between sessions or machines.
- A finished list stays readable in `/todos` until the model changes it.

## Settings

| Key | Default | What it does |
|---|---|---|
| `hideWhenComplete` | `true` | Hide the rail once every item is completed. |

It lives in the `todo` section of `bytefly.json`; the resolution rules are in
[configuration](../configuration.md#todo--the-todo-widget).

## Learn more

- [Track your first task](../tutorials/first-task.md) — the walkthrough.
- [`goal`](../extensions/goal.md) — the other line above the editor.
- [`plan`](../extensions/plan.md) — a plan you approve before work starts.
