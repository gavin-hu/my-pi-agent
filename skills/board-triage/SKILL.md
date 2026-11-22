---
name: board-triage
description: "Turn a board's open cards into a prioritized wave plan: fold duplicates by root cause, group cards by area, place a refactor before the bugs it moves, surface the cards waiting on your decision, and name the first wave with its evidence. Use when a backlog has many bugs or refactors and the next move is unclear, or when asked to triage the board, plan a wave, or say what to work on first; discovery is read-only and writes nothing."
---

# Triage the board into waves

Goal: a short, prioritized plan for a board with more open cards than one session should
start at once — duplicates folded, cards grouped by the area they touch, a refactor placed
before the bugs it moves, what is already in flight and which slot it holds, the cards that
need a person named, and the first wave with the evidence for each row. This is a triage:
nothing is claimed, moved, signed, or dropped until the user picks an action.

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
counts — never the limits. Those are `board.wip` in `bytefly.json`: `plan`, `execute` and
`perOwner`, each clamped 1..20, the project's file under `.pi/` over the global one. Read them,
quote the numbers the report used, and fall back on **plan 3, execute 5, one card per session**
only where the file states none.

Two reads are out of bounds: never read the card store's own file, and never run the project's
full check. The tree is readable, and a row claiming a root cause or a fix owes it — bounded
per candidate to the two cards and the one symbol, error string, or test they name.

A request after `/skill:board-triage` is the scope: a lane (`backlog`), a path or area
(`@extensions/board`), a card id, or a question. With no request, triage the whole open
board. `board({ action: "list", card: "24" })` is the per-card read; use it for the
first-wave and duplicate candidates, not for every row.

## 1. Classify

Read a card in two layers, fields first: `lane`, `owner`, `priority`, `type`, `dependsOn` and
`paths` are the board's own words and the cheap half. `priority` is the order the board already
draws a lane in, so a wave that ignores it can contradict the report above it, and
`type: "refactor"` is what makes a card a refactor, whatever its title says. The title and the
notes are the second layer: they are what a row's evidence quotes, not what a class is guessed
from.

Then walk the six classes in [references/rules.md](./references/rules.md). Each row needs its
evidence before it earns a class:

- **In flight** — the card is somebody's: an owner in `plan` or `execute`, or a finished card
  awaiting its review or its approval. Who holds it and what it still owes are on the row, and
  that is the evidence. Leave it: the slot it holds is what the first wave has to fit behind.
- **Duplicate** — one root cause, not one file: the same reproduction, error, or function
  cluster. Keep one card; fold the others into it, then drop them.
- **Stale** — a landed commit, a merged branch, or activity that no longer matches the card.
  A stale card is not a duplicate: it may close without folding.
- **Decision** — a product, naming, or scope choice only a person can make. Unowned cards
  cannot enter `blocked` (the lane needs an owner), so name these in the report; do not
  pretend the board has a queue it does not.
- **Ready** — the work is clear, the paths are disjoint, and a plan and contract can be
  written without another decision. Its `priority` is where it sits inside the wave.
- **Later** — real work whose area or dependency puts it behind another wave.

A title is not evidence. If a card's root cause, status, or scope cannot be read from its
record and notes, put it in "read first" rather than guessing.

## 2. Group into waves

- **Area first.** Cards whose `paths` share a directory are one wave: one design pass, one
  worktree, one verify command. Do not mix a refactor and the bugs in its files.
- **Then `priority`, high first**, because that is the order the board already draws them in. A
  wave that reverses it owes the reader the reason.
- **Refactor before its bugs.** A refactor that moves the lines a bug fixes goes first; the
  bug cards then run against the new code, not the code the refactor rewrites. A refactor is
  one card: never split it by file, and take the word `refactor` from `type`, not the title.
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
| #12 | in `execute`, awaiting its review; holds one of five | leave it; the lead owes the sign | — |
| #24 | contract complete, unapproved, in the pool | claim; the lead approves, then execute | W1 |
| #31 | the same root cause as #24, one file | note #24, drop #31 | now |
| #40 | refactor moves the lines #44 fixes | execute first, then #44 | W0 |
| #52 | needs a naming decision | leave for the user, or `blocked` if held | — |

Then:

- the first wave, in order, with the evidence for each row and the verify command it will
  likely name — and the head row this session takes, since `perOwner` is 1 by default; the rest
  wait for their own slot, or for the team;
- the cards left out and why: in flight, duplicates, stale, decisions, later waves;
- the exact writes proposed — `note`, `drop`, `edit`, `dependsOn`, `claim` — one line each;
- one sentence saying nothing has been written.

## 4. Hand off

The triage is read-only. When the user picks a row, leave this skill and apply the chosen
actions with `board`, one at a time, reporting each result. Re-read the card before a write
that the report may have made stale. Contract and approval stay the board's gates: this
skill never signs, never moves a card to `execute`, and never closes one. `approve` is the
lead's, on a card they do not hold, so a row that needs a signature names who owes it instead
of folding it into this session's sequence.

## Quality gate

- Every row has a card id, a class, an action, and a wave or a "not now" reason.
- Every card in flight is a row naming the gate it waits on, and none is proposed for a write.
- `priority` orders the rows inside a wave, and a refactor is one by `type`, never by its title.
- Every duplicate and stale row names its evidence; nothing is dropped on a title alone.
- The first wave is at most the `plan` limit; no wave exceeds `execute`; the headroom is
  stated.
- A refactor is one card and sits before the cards whose lines it moves.
- Decision cards are named, with the reason they cannot be `blocked` while unowned.
- No card was written, claimed, moved, or dropped by the skill.
- The report says which limits it read, `board.wip` by its numbers, and what it did not read.

## Stop conditions

- No board, or no open cards: say so; there is no wave to plan.
- The `board` tool is not loaded: say so; this skill reads `board list`.
- The request is one card: answer for that card and skip the wave plan.
- Every open card is either in flight or waiting on a person: say so, name the gate each
  holds, and stop; the next move is a review, a landing, or a decision, not a wave.
- Every slot is taken — `plan` at its limit and `execute` with no headroom: say which card
  clears one, and do not plan a wave that cannot start.
- The evidence is missing: read the cards the report depends on, or name what is missing.
