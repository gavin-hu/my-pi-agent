# The six classes, and the evidence each needs

A class is a claim about a card. The evidence is what makes the claim one a reviewer can
argue with. Start from the card's own fields — `lane`, `owner`, `priority`, `type`,
`dependsOn`, `paths` — then its record and its notes; a title is not evidence, and a wave is
not a plan.

## In flight

The card is somebody's, and the triage leaves it alone: an owner in `plan` or `execute`, or a
finished card awaiting its review or its approval.

- **Evidence**: the owner on the row, and what the card still owes — no contract, a contract
  nobody approved, a review nobody gave. The round's `unplanned` and `unreviewed` lines name
  most of them already.
- **Why it is a class**: it consumes the slot the first wave has to fit into, and the wave
  arithmetic below already keeps one execute slot free for a card awaiting review. A report
  that drops these rows proposes a wave the board refuses.
- **Write**: none, not even a note. A note is a write, and on a card waiting for its signature
  that write outgrows the sign it was waiting for.

## Duplicate

One root cause, not one file. Two bugs that touch the same module are not duplicates; two
that report the same error from the same function are.

- **Evidence**: the same reproduction, the same error string, or the same function cluster,
  named in the cards or found in the tree. A shared `paths` entry is a hint, not the proof.
  Confirming one is a tree read and a cheap one: the two cards, the function, error string or
  test they name, and nothing else.
- **Survivor**: the card with a complete contract, else the one with the clearest
  acceptance, else the lower id. The survivor takes the folded titles and any notes worth
  keeping before the others are dropped: a dropped card's notes do not come back.
- **Write**: `note` the survivor with the folded ids, then `drop` each other card. A drop is
  refused while another card waits on it, so clear that link first, or leave the card.
- Do not fold a card that is in `execute`, or one with an approval or a review: that is
  someone's work, not a duplicate.

## Stale

The card no longer describes the tree. The bug is fixed, the file is gone, the refactor
landed, or the feature the card names was removed.

- **Evidence**: the commit that did it (`git log -S`, `git log --oneline -- <path>`), the
  card's own last note, or a read of the code that shows the condition cannot happen. Name
  the commit or the file; "old" is not a reason.
- A bug that may no longer reproduce is **read first**, not stale: reproduction is the
  evidence, and the card may still be real.
- **Write**: `note` the evidence on the card, then `drop`. A stale card whose work another
  card waits on cannot be dropped; say so and leave it.

## Decision

A person has to choose: a product answer, a name, a scope, or whether the card is wanted.
The card cannot move until the answer exists.

- **Why it is not `blocked`**: the `blocked` lane needs an owner, and an unowned card cannot
  enter it. A triage must not claim cards to make a queue look better.
- **Evidence**: the card's own note says what is unresolved, or the contract/acceptance
  cannot be written without an answer. Name the question, not the card's title.
- **Write**: none in triage. If the user wants it queued, the handoff is `claim` then
  `move blocked blocker decision blockedBy "<the question>"`, which holds the card and
  spends the session's in-flight slot; say that cost.

## Ready

The work can be planned and contracted without another decision.

- **Evidence**: a title that states the outcome, `paths` that name where it lives (or a
  reason they cannot), no unfinished `dependsOn`, and a narrow command the contract can name
  as `verify` — an existing test, or the one the change will add. Its `priority` decides where
  it sits in the wave, and `type: "refactor"` is what makes it one.
- If a contract is already recorded, say whether it is approved; an approved contract in
  the pool can be executed just-in-time (see below).
- **Write**: the wave proposes `claim`, `contract`, `approve` (the lead or the person), then
  `move execute`; the triage itself stops at the proposal.

## Later

Real work, ordered behind another wave.

- **Evidence**: the area it shares with an earlier card, or the `dependsOn` edge it waits on.
- Say which wave, and why that wave is earlier. A card with no reason to wait is `Ready`,
  not `Later`.

## Wave arithmetic

- Read the limits from `board.wip` in `bytefly.json` — `plan`, `execute`, `perOwner`, each
  clamped 1..20 — and quote the numbers the report used; the defaults plan 3, execute 5, one
  card per session are what a file that states none leaves.
- Inside a wave, `priority` orders the rows, high first: it is the board's own order, so a
  wave that reverses it needs a reason in the report.
- The first wave is at most the `plan` limit; the board is at most the `execute` limit in
  flight; each session holds at most the `perOwner` limit. Keep one execute slot free.
- A refactor goes before the cards whose lines it moves. Two cards that touch the same file
  are one wave, or serialized by `dependsOn`.
- `dependsOn` is a card id, so it cannot express "waiting on a person". A decision is named,
  not linked.

## Pre-approval, when the user wants it

`release` returns a card to the pool with its contract **and** its approval, because the
plan did not change. A wave can therefore be planned and approved in `plan`, released, and
executed just-in-time.

- Keep the pre-approved queue to one wave: the default branch moves, and the triage cannot
  promise a plan stays current.
- A changed contract line drops the approval; a changed plan file does not. Say which one a
  later edit is.

## What not to do

- Do not write a contract for many cards from one plan: the plan artifact proves a file
  exists, not that a card's section does.
- Do not merge or split cards: the board's identity and signatures are per card; fold a
  duplicate with a note and a drop instead.
- Do not raise the limits to fit the queue; name the setting and let the user decide.
- Do not drop a card another card waits on, sign a gate, move a card to `execute`, or close
  one. Those are the board's verbs, and the triage stops before them.
- Do not run the project's full check in triage; name the narrow command the card will use.
- Do not read a refactor from a title, or a priority from a note: `type` and `priority` are
  fields on the card, and a class guessed from prose is the one thing a reviewer cannot check.
- Do not write on a card in flight; its slot and its gate are the report's business, not a
  `note`'s.
