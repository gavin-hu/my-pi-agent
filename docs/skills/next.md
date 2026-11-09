# next — decide what to do next

`next` is a triage, not a work session. It reads what the conversation left open,
or the project itself when the conversation has done nothing, and returns a short
numbered list of next todos, each with `path:line` evidence and the command that
starts it. It is read-only: it never edits, commits, or begins the work.

## What you can do

| What you want | What to do |
|---|---|
| Know what this session left open | `/skill:next` |
| Ask about one release, file, or feature | `/skill:next what is left before 0.26?` |
| Narrow the evidence to a tree | `/skill:next @docs/skills` |
| Get one named piece of work answered, not a list | `/skill:next fix the failing link check` |
| Pick up a project with an empty conversation | `/skill:next`, triaged from git and the tree |

## Try it

```text
/skill:next what is left before the next release? @docs/skills
```

The reply opens with the source, the scope, and how it read the prompt, then the
list — three to five items at most, numbered by priority — then what it rejected
and why, and a question asking which one to start. Nothing on disk changes.

## Reference

**Two sources, and the conversation chooses.** A conversation that has done work —
a todo list, a goal, an approved plan, a subagent result, an edited path — is
triaged from its own record, and the candidates are its loose ends: uncommitted
files, an unapproved plan, a check never run, a documented behaviour that changed
without a doc edit. An empty conversation is triaged from the project: git, the
changelog, the roadmap or board, and the plans directory. The tree is evidence in
both cases, and a conversation that ended cleanly has an empty list rather than a
fallback.

**The request.** `/skill:next [what you want] [@path …]` — a topic keeps only the
sources that can answer it, a path takes the evidence from there, and an imperative
narrows the reply to that one item with its evidence and starting command.

**Evidence read, never produced.** `git status`, `git diff --stat`, commits since
the last tag, unmerged branches and worktrees, the changelog's unreleased section,
the roadmap or issue tracker, the plan files the `plan` tool records under
`~/.pi/agent/plans/<repo-key>`, and the session's todo, goal, job, and subagent
results. The project's check command is quoted with the session's last result, not
run.

**Ranking.** What it would cost to lose the work, cheapest loss first: loose work,
then a broken promise, then an unfinished promise, then new reach. Each item carries
a label — **Do next**, **Worth planning**, or **Later** — and its effort in S, M, or
L; the priority order decides, not the label.

## Limits

- It starts nothing: the reply ends by asking which item to take, and the handoff
  (plan mode, a todo list, the project's check) happens only after you answer.
- A candidate needs one concrete artifact — a path with line numbers, a command's
  output, a diff hunk, or a failing test name — or it is dropped.
- It invents no work; an empty list with what was checked is a valid answer.
- A tree mid-rebase, mid-merge, mid-bisect, or holding a conflict has one candidate
  only: reconciling it.
- A candidate that needs a destructive command to start is named as a decision for
  you, not written as a step.

## Learn more

- [`refactor`](./refactor.md) — the narrower question of where to refactor; `next`
  hands a scoped request over to it.
- [`board`](../extensions/board.md) — the shared feature list `next` reads.
- [`plan`](../extensions/plan.md) — approved plans and their remaining steps.
- [`goal`](../extensions/goal.md) and [`todo`](../extensions/todo.md) — the
  session's own record of what it promised.
