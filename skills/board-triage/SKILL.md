---
name: board-triage
description: "Turn a board's open cards into a prioritized wave plan: fold duplicates by root cause, group cards by area, place a refactor before the bugs it moves, surface the cards waiting on your decision, and name the first wave with its evidence. Use when a backlog has many bugs or refactors and the next move is unclear, or when asked to triage the board, plan a wave, or say what to work on first; discovery is read-only and writes nothing."
---

# Triage the board into waves

Goal: a short, prioritized plan for a board with more open cards than one session should
start at once — duplicates folded, cards grouped by the area they touch, a refactor placed
before the bugs it moves, the cards that need a person named, and the first wave with the
evidence for each row. This is a triage: nothing is claimed, moved, signed, or dropped
until the user picks an action.

The project's own rules win over anything here. Read `AGENTS.md`, `CONTRIBUTING.md`, and the
board page before the first row: a project that states its own limits, gates, or commit
rules is not overridden by a default in this skill.

`next` answers what to do next from the conversation; `refactor` audits code for structural
work. This skill is the board-wide sequencing between them: given many open cards, which
order, and what the first wave is.

## Start here

```text
board({ action: "list", round: true })
```

That one call answers the board's lanes, owners, unassigned cards, the lead's queue, and the
counts. Then read the project's board settings in `bytefly.json` for the limits; use the
defaults only when the file states none: **plan 3, execute 5, one card per session**. Do not
read the card store directly — `board list` is the one read this skill needs.

A request after `/skill:board-triage` is the scope: a lane (`backlog`), a path or area
(`@extensions/board`), a card id, or a question. With no request, triage the whole open
board. `board({ action: "list", card: "24" })` is the per-card read; use it for the
first-wave and duplicate candidates, not for every row.

## 1. Classify

Walk the five classes in [references/rules.md](./references/rules.md). Each row needs its
evidence before it earns a class:

- **Duplicate** — one root cause, not one file: the same reproduction, error, or function
  cluster. Keep one card; fold the others into it, then drop them.
- **Stale** — a landed commit, a merged branch, or activity that no longer matches the card.
  A stale card is not a duplicate: it may close without folding.
- **Decision** — a product, naming, or scope choice only a person can make. Unowned cards
  cannot enter `blocked` (the lane needs an owner), so name these in the report; do not
  pretend the board has a queue it does not.
- **Ready** — the work is clear, the paths are disjoint, and a plan and contract can be
  written without another decision.
- **Later** — real work whose area or dependency puts it behind another wave.

A title is not evidence. If a card's root cause, status, or scope cannot be read from its
record and notes, put it in "read first" rather than guessing.

## 2. Group into waves

- **Area first.** Cards whose `paths` share a directory are one wave: one design pass, one
  worktree, one verify command. Do not mix a refactor and the bugs in its files.
- **Refactor before its bugs.** A refactor that moves the lines a bug fixes goes first; the
  bug cards then run against the new code, not the code the refactor rewrites. A refactor is
  one card: never split it by file.
- **Wave size from the limits.** The first wave holds at most the `plan` limit, the board at
  most the `execute` limit in flight, and a session holds the `perOwner` limit. Keep one
  execute slot as headroom so a card awaiting review does not block the next claim.
- **Edges only across waves.** `dependsOn` means "cannot start until finished", which is
  between waves; do not chain cards that can run in parallel.
- **Pre-approval is an option, not a step.** `release` keeps the contract and its approval,
  so a wave can be planned and approved in `plan`, released, then executed just-in-time.
  Keep the pre-approved queue to one wave: a plan drifts from the default branch while it
  waits.

## 3. Report

The reply is a table and a first wave, not a plan file:

| card | why | action | wave |
|---|---|---|---|
| #24 | contract complete, unapproved, in the pool | claim, approve, execute | W1 |
| #31 | the same root cause as #24, one file | note #24, drop #31 | now |
| #40 | refactor moves the lines #44 fixes | execute first, then #44 | W0 |
| #52 | needs a naming decision | leave for the user, or `blocked` if held | — |

Then:

- the first wave, in order, with the evidence for each row and the verify command it will
  likely name;
- the cards left out and why: duplicates, stale, decisions, later waves;
- the exact writes proposed — `note`, `drop`, `edit`, `dependsOn`, `claim` — one line each;
- one sentence saying nothing has been written.

## 4. Hand off

The triage is read-only. When the user picks a row, leave this skill and apply the chosen
actions with `board`, one at a time, reporting each result. Re-read the card before a write
that the report may have made stale. Contract and approval stay the board's gates: this
skill never signs, never moves a card to `execute`, and never closes one.

## Quality gate

- Every row has a card id, a class, an action, and a wave or a "not now" reason.
- Every duplicate and stale row names its evidence; nothing is dropped on a title alone.
- The first wave is at most the `plan` limit; no wave exceeds `execute`; the headroom is
  stated.
- A refactor is one card and sits before the cards whose lines it moves.
- Decision cards are named, with the reason they cannot be `blocked` while unowned.
- No card was written, claimed, moved, or dropped by the skill.
- The report says which limits it read and what it did not read.

## Stop conditions

- No board, or no open cards: say so; there is no wave to plan.
- The `board` tool is not loaded: say so; this skill reads `board list`.
- The request is one card: answer for that card and skip the wave plan.
- Every open card waits on a person: say so; the next move is a decision, not a wave.
- The evidence is missing: read the cards the report depends on, or name what is missing.
