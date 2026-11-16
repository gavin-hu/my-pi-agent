# triage-board — turn a board into waves

`triage-board` reads a repository's board and returns a prioritized wave plan: duplicates
folded by root cause, cards grouped by the area they touch, a refactor placed before the
bugs it moves, the cards waiting on your decision named, and the first wave with its
evidence. Discovery is read-only; the writes it proposes are applied with `board` after you
pick.

## What you can do

| What you want | What to do |
|---|---|
| Triage the whole open board | `/skill:triage-board` |
| Triage one lane | `/skill:triage-board backlog` |
| Triage one area | `/skill:triage-board @extensions/board` |
| Ask about one card | `/skill:triage-board card 24` |
| Turn a large backlog into a first wave | `/skill:triage-board` |
| Apply a row's writes | name the row; the skill hands off to `board` |

## Try it

```text
/skill:triage-board
```

The reply opens with the board's size, lanes and limits, then a table — one row per card,
with its class, the action proposed and the wave — then the first wave in order with its
evidence and the verify command each card will name, what was left out and why, and the
writes it would make. Nothing is written until you pick a row.

## Reference

**Five classes.** A **duplicate** is one root cause, not one file: the survivor keeps the
folded notes, the others are dropped. **Stale** means a landed commit or a file that no
longer matches the card; a bug that may no longer reproduce is "read first", not stale. A
**decision** is a question for a person; an unowned card cannot enter `blocked`, so it is
named rather than queued. **Ready** means the work can be contracted without another
answer. **Later** is real work behind another wave.

**Waves.** The first wave is at most the project's `plan` limit, the board is at most its
`execute` limit in flight, and a session holds its `perOwner` limit; one execute slot stays
free. A refactor goes before the bugs whose lines it moves, and `dependsOn` is used only
between waves.

**The read.** `board list` with the round, then one per-card read for the candidates that
need paths, notes or dependencies. The board's settings in `bytefly.json` supply the limits;
the defaults are plan 3, execute 5, one card per session. The triage never reads the card
store directly.

**The handoff.** Nothing is claimed, moved, signed or dropped by the triage. When you pick a
row, the chosen `board` writes are applied one at a time, with the result of each. Contract
and approval remain the board's gates.

**Pre-approval.** `release` keeps a contract and its approval, so a wave can be approved in
`plan`, released, and executed just-in-time. Keep that queue to one wave: the default branch
moves while it waits.

## Limits

- It is read-only: it reports and asks, and the writes are a separate step after you pick.
- It needs the `board` tool; without it there is no board to read.
- It does not decide a product question, and it does not sign, move or close a card.
- An unowned card waiting on a decision has no board queue; the report names it instead.
- A pre-approved plan drifts from the default branch; the triage keeps the queue to one wave
  and does not promise the plan stays current.
- It names a narrow verify command; it does not run the project's full check.

## Learn more

- [`next`](./next.md) — what to do next from the conversation, or from the tree.
- [`refactor`](./refactor.md) — the code-structure audit a triage can hand a card to.
- [`board`](../extensions/board.md) — the cards, the lanes, the two gates and the verbs.
- [`plan`](../extensions/plan.md) — the plan a contract names.
