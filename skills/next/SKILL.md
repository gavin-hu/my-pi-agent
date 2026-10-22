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

There are two modes. **Triage** (the default) reads the project. **Session** reads
what this conversation left open. `/skill:next session` names it; with no mode,
triage.

A next-steps block that the host draws itself is not this skill's output: that is
the reply's suggested follow-up, a turn-level hint. This skill inspects state, so
its list survives the conversation that produced it.

## 1. Read the project profile

Before suggesting anything, find:

- the instruction files, and whether they require isolation (a worktree, a
  branch) or a specific check;
- the check command, and whether the host forbids running it while writing is
  off;
- where work is tracked: a roadmap, an issue tracker, `TODO` docs, a plans
  directory, a changelog;
- the release path: what a tag, a version bump, or an unreleased entry owes;
- the VCS and its branch model.

State the profile in one or two lines. Do not invent a source the project does
not have; a project with no roadmap is triaged from git and the check alone.

## 2. Choose the mode

- **Triage** — what the tree says. Use git, the changelog, the roadmap or issues,
  the plans directory, and the check. This is the default.
- **Session** — what this conversation left open. Read the conversation's own
  record: the todo list, the goal, the approved plan and its ticked steps, what
  subagents and jobs returned, and the diff this session produced. Then list the
  loose ends it left: uncommitted files, an unapproved plan, a claim that was
  never run, a documented behavior that changed without a doc or changelog edit.
- When both apply, run triage and read the session for context; the tree wins,
  because it is where the work actually is.

## 3. Gather evidence

Run only what the project documents or what git provides, and say what you could
not read.

| Source | What it proves |
|---|---|
| `git status --short`, `git diff --stat` | Work in flight, and whose it is |
| `git log --oneline <last-tag>..HEAD` | What has landed unreleased |
| `git worktree list`, `git branch --no-merged` | An isolated tree left behind, a branch never merged |
| The changelog's `[Unreleased]` | Whether a landed change is recorded, and whether the window is empty |
| The roadmap, issue tracker, or `TODO` docs | The project's stated priorities, and which are already done |
| The plans directory (`.pi/plans` or the project's equivalent) | An approved plan whose steps remain |
| The todo list, the goal, job and subagent results | What the session promised and did not finish |
| The check command | Whether the tree is green; run it only when documented, and report instead of running it when the host forbids writes |

A roadmap, a changelog, and a plan all lag the tree. Verify a candidate against
the code before recommending it, and drop one that is already done.

## 4. Classify by cost of loss

Rank what the evidence proves, not what sounds interesting. The order is the
order of loss:

- **Loose work** — a dirty tree, an unapproved plan, a failing check, an unmerged
  branch, a worktree left behind, a stopped job. Cheapest to lose, so first.
- **A broken promise** — a README, roadmap, or doc claim the code no longer
  meets, a released behavior with no test.
- **An unfinished promise** — a stated roadmap item, the remaining steps of an
  approved plan, a documented limitation with no item, an unreleased change with
  no changelog entry.
- **New reach** — a capability nobody has asked for comes last, and only when the
  three above are empty.

## 5. Verify and filter

A candidate is not a suggestion until it has one concrete artifact: a path with
line numbers, a command's output, a diff hunk, or a failing test name. If you
cannot point at it, drop it.

- Reject anything already done, already documented as a deliberate non-goal, or
  blocked on a decision the user has not made — say which, and ask if it matters.
- Keep a bug separate from a preference, and a refactor separate from a fix.
- Prefer the candidate with a fast verification command.
- Never invent work to fill the list. An empty list is a valid answer.

## 6. Rank and cap

Use three tiers:

- **Do next** — cheap, safe, and unblocks the rest.
- **Worth planning** — high value, but it spans files, changes a public surface,
  or needs a decision first.
- **Later** — real, but not now.

Cap the list at three to five items. A roadmap restated as ten suggestions is not
a triage. Within a tier, order by cost of loss first, then cost of the work. Do
not invent a numeric score; the reason must be readable.

## 7. Report

- **State** — one paragraph: the mode, the branch or worktree, what is dirty,
  what is unreleased, and whether the check passes. Name anything you could not
  read.
- **The shortlist** — each item with its tier, the action, the evidence at
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
