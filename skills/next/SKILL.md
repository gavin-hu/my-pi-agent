---
name: next
description: "Decide what to do next from a project's real state, or from the current conversation: loose work in the tree, commits since the last tag, unreleased changelog entries, roadmap or plan items still open, and the project's check command. Returns a short ranked list with the evidence for each item and the command that starts it; read-only, it never edits, commits, or begins the work. Use when asked what to do next, where to pick up, what is left, or what to work on now."
---

# Decide what to do next

This is a triage, not a work session. The deliverable is a short ranked list with
evidence; do not edit, commit, tag, or start the top item. The skill is
model-invoked when a request matches the description; `/skill:next` is the
explicit fallback. Read the project's own instructions first; where they disagree
with this skill, the project wins.

Two sibling skills own a narrower question: an audit of *where to refactor* is
`refactor`, and *what the last tag owes the changelog* is `changelog`. When the
request is already scoped to one of those, name the skill that answers it and
hand over, instead of returning a generic list.

A next-steps block that the host draws itself is not this skill's output: that is
the reply's suggested follow-up, a turn-level hint. This skill inspects state, so
its list survives the conversation that produced it.

## 1. Read the request

The host appends the text after the command to these instructions as the request.
It is `<prompt>` in `/skill:next <prompt>`, it comes before any reading, and it
carries up to three parts:

```text
/skill:next [session] [what you want] [@path ...]
```

- **`session`, first word** — session mode (section 3). The rest of the prompt
  keeps its own meaning: `/skill:next session what is left?` is session mode with
  a filter, not a filter of `session`.
- **What you want** — a question, a goal, or a topic: "what is left before
  0.17?", "plan file outline". It chooses what the shortlist is about and keeps
  only the sources that can answer it; say which ones you kept. A named release,
  file, or feature is the filter.
- **One or more paths** — `@src`, `src`, `packages/api`, or one inside the
  sentence. Resolve each from the working directory, and take the evidence from
  there: that path's diffs, plan steps, roadmap items, and changelog scope. A path
  that does not exist is reported and asked about, never guessed.
- **Both** — the usual case. `/skill:next plan file outline @extensions/plan/`
  asks what to do next about the plan file outline, with `@extensions/plan/` as
  the evidence, so a roadmap item, a plan step, or a changelog entry outside that
  path is not a candidate.
- **An imperative** — "fix the failing test" names one piece of work, and the
  prompt is not approval for it. Answer with that item alone — evidence, starting
  command, effort — and ask before starting, instead of producing a list.
- **No prompt** — triage of the current project.
- **Anything unreadable** — triage anyway, and say in one clause how you read the
  prompt, so a misreading is visible in the report rather than silently narrowing
  the list.

## 2. Read the project profile

With the request read, find:

- the instruction files, and whether they require isolation (a worktree, a
  branch) or a specific check;
- the check command — the one that proves the tree is green; the triage quotes it
  and never runs it (section 4);
- where work is tracked: a roadmap, an issue tracker, `TODO` docs, a plans
  directory, a changelog;
- the release path: what a tag, a version bump, or an unreleased entry owes;
- the VCS, its branch model, and the last tag if there is one.

State the profile in one or two lines. Do not invent a source the project does
not have; a project with no roadmap is triaged from git and the check alone.

## 3. Choose the mode

- **Triage** — what the tree says. Use git, the changelog, the roadmap or issues,
  and the plans directory. This is the default.
- **Session** — what this conversation left open. Read the conversation's own
  record: the todo list, the goal, the approved plan and its ticked steps, what
  subagents and jobs returned, and the diff this session produced. Then list the
  loose ends it left: uncommitted files, an unapproved plan, a claim that was
  never run, a documented behavior that changed without a doc or changelog edit.
- When both apply, run triage and read the session for context; the tree wins,
  because it is where the work actually is.

Mode and scope are independent: session mode still honours a path, and triage
with a path reads the whole tree's evidence before narrowing. State the mode, the
scope, and the prompt as read, at the top of the report.

## 4. Gather evidence

Read only; nothing in this stage writes. Follow the project's own tool
discipline, and say what you could not read.

| Source | What it proves |
|---|---|
| `git status --short`, `git diff --stat` | Work in flight, and whose it is |
| `git log --oneline <last-tag>..HEAD` | What has landed unreleased |
| `git worktree list`, `git branch --no-merged` | An isolated tree left behind, a branch never merged |
| The changelog's `[Unreleased]` | Whether a landed change is recorded, and whether the window is empty |
| The roadmap, issue tracker, or `TODO` docs | The project's stated priorities, and which are already done |
| The plans directory (`~/.pi/agent/plans/<repo-key>`) | An approved plan whose steps remain |
| The todo list, the goal, job and subagent results | What the session promised and did not finish |
| The check command | Whether the tree is green — cite the last known result, and make running it the item's starting command rather than running it here |

A roadmap, a changelog, and a plan all lag the tree. Verify a candidate against
the code before recommending it, and drop one that is already done.

## 5. Verify and filter

A candidate is not a suggestion until it has one concrete artifact: a path with
line numbers, a command's output, a diff hunk, or a failing test name. If you
cannot point at it, drop it.

- Reject anything already done, already documented as a deliberate non-goal, or
  blocked on a decision the user has not made — say which, and ask if it matters.
- Keep a bug separate from a preference, and a refactor separate from a fix.
- Prefer the candidate with a fast verification command.
- Never invent work to fill the list. An empty list is a valid answer.

## 6. Rank by cost of loss

Order by what it would cost to lose, cheapest loss first:

- **Loose work** — a dirty tree, an unapproved plan, a check that has not been
  run, an unmerged branch, a worktree left behind, a stopped job.
- **A broken promise** — a README, roadmap, or doc claim the code no longer
  meets, a released behavior with no test.
- **An unfinished promise** — a stated roadmap item, the remaining steps of an
  approved plan, a documented limitation with no item, an unreleased change with
  no changelog entry.
- **New reach** — a capability nobody has asked for comes last, and only when the
  three above are empty.

Label each item with the ceremony it needs. The label is not a second ordering:
cost of loss decides the order, and the label says how much work the item takes.

- **Do next** — cheap, safe, and unblocks the rest.
- **Worth planning** — high value, but it spans files, changes a public surface,
  or needs a decision first.
- **Later** — real, but not now.

Cap the list at three to five items, and let a tier be empty. A roadmap restated
as ten suggestions is not a triage. Do not invent a numeric score; the reason
must be readable.

## 7. Report

- **State** — one paragraph: the mode, the scope and how the prompt was read,
  the branch or worktree, what is dirty, what is unreleased, and whether the
  check passes. Name anything you could not read.
- **The shortlist** — each item with its label, the action, the evidence at
  `path:line` or the command output that proves it, the command that starts it,
  and effort (S/M/L). Link the file the item lives in.
- **Rejected or stale** — one line each, with the reason the roadmap, changelog,
  or plan entry no longer applies.
- **Next step** — ask which item to start. Do not start it, and do not open with
  an edit.

If the host expects a closing next-steps block, keep it to the top two or three
choices as one line each; the evidence stays in the list above, never repeated
there.

## 8. Handoff

When the user picks an item, the audit is over:

- Restate the chosen item as a task with its acceptance test.
- Enter plan mode when the host provides it and the item spans files, changes a
  public surface, or has an unknown step list. Track a small one in a todo list.
- Run the project's check first for a baseline, and finish with the full check.
- Do not commit unless the user asks.

## 9. Stop conditions

- Nothing worth doing: say so, with what was checked, instead of inventing work.
- The tree is mid-rebase, mid-merge, mid-bisect, or has a conflict: reconciling it
  is the only next item; nothing else is safe to suggest.
- The project has no work tracking: say the list is derived from git and the check
  only, and suggest recording the plan or roadmap the project is missing.
- A candidate needs a destructive command (a branch delete, a worktree prune, a
  history rewrite) to start: name it as a decision for the user, not as a step.

The triage is done when the mode is stated, every item has evidence and a
starting command, the list is capped, rejected candidates are explained, and no
file was modified.
