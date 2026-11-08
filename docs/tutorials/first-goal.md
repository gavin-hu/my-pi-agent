# Give the session a goal

A goal is the session's one objective — the *what*, where `todo` keeps the *how*.
It sits above the editor and is restated to the model before every turn, so it
holds a long session together. This walkthrough sets one, answers the question it
asks, changes it without starting work, and finishes it against the task list.

You need Pi and this package installed — see [Install](../install.md).

## Set it in words

```text
/goal make the uploader retry-safe, with tests, before Friday
```

Nothing is recorded until you have seen how it was understood. If the goal leaves
something open, the model asks its questions first; then a **Confirm the goal**
editor holds its restatement of what you typed. The answers sit under a
`--- notes (not saved) ---` line, which is dropped on save — so you correct the
objective itself, not the notes about it. `Enter` records it, `Esc` cancels the
whole command.

Then it asks once:

```text
Plan first?
```

Yes turns plan mode on and keeps the goal as a draft while the plan is designed;
no records it as active. Either way the objective is sent as the turn that starts
the work, so you do not type it twice. When a goal is already being pursued, a
free-form `/goal` asks before replacing it — a stray line cannot silently drop
the objective.

## Read the rail

```text
Goal · active · make the uploader retry-safe, with tests, before Friday
```

That is the whole widget: the phase, then the objective, clipped to the width.
The model gets the same words as a `[SESSION GOAL]` bullet before each turn,
which is why the goal does not need repeating in every prompt — and why it stays
out of the transcript.

A draft reads `Goal · planning` while the plan is being written. Approving a plan
finalizes it from the plan's own `## Goal`, with no second dialog; leaving plan
mode without approving promotes the draft to the objective, because you chose to
act on it. [`plan`](../extensions/plan.md) walks that review.

## Skip the restatement

```text
/goal raw ship the retry path this week
```

These words are recorded exactly as typed, with no restatement and no editor. The
planning question still comes; this only skips the comprehension step. Use it
when the wording is the point — a version, a deadline, a phrase you will grep
for.

## Change it without starting work

- `/goal set <text>` records the new wording and starts nothing;
- `/goal edit` opens the current objective in an editor — `Enter` saves, `Esc`
  keeps the old one;
- `/goal edit <text>` records the new wording and starts nothing either.

None of the three asks the planning question, because no work begins.

## See it, and finish it

```text
/goal
```

prints the current goal as a notice, with the phase and, for a draft, how the
phase ends. Complete it when the work is:

```text
/goal done
```

```text
Goal achieved: make the uploader retry-safe, with tests, before Friday
3 todo items are still open; close or clear the list if that work is done.
```

That note is the point of the pairing: completing the *what* reads the *how* off
the list rather than trusting the claim, and the same line comes back when the
model marks the goal achieved with its own tool. `/goal done` again on an
achieved goal says so instead of writing anything. `/goal clear` removes it, and
an achieved goal is hidden by default — `goal.achieved: "show"` keeps the dimmed
line.

## What survives

The goal is written to the tool result and a session entry, so `/resume` and
`/tree` restore the goal that belongs to the branch you land on; a branch you
abandon takes its goal with it. One goal at a time: a new objective replaces the
old one whole, and there are no sub-goals — that is what the task list is for.

## Where to go next

- [`goal`](../extensions/goal.md) — the verbs, the phases, and the one setting.
- [`todo`](../extensions/todo.md) — the steps under the objective.
- [Track your first task](./first-task.md) — the list the goal's last line reads.
