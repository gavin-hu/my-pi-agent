# Several sessions, one repository

`session-bus` carries the messages, `board` holds the cards, and `team` is how a
lead moves one between sessions. This page is the round they make together — who
holds what, in what order, and what none of the three promises. Each surface's own
page has its commands in full.

## The three surfaces

| Surface | What it is for |
|---|---|
| [`session-bus`](./extensions/session-bus.md) | discovery, mail, and path claims between sessions on one machine |
| [`board`](./extensions/board.md) | the work: one card per feature, and two signatures before it ships |
| [`team`](./extensions/team.md) | the lead's round over the cards — assign, offer, ask |

Nothing in the three starts a process. A message lands in an inbox, so a session
that is not running stays not running — and one listening with `wake` is woken for
it, a handoff and an ask included.

## How the three are wired

No extension imports another's modules; what two of them need lives in `lib/`, and a
test fails a direct import. What is left crosses on one of three channels, each with
one owner:

```text
imports    board, team ───► lib/workflow/*
           board, team ───► lib/session-tool.ts   ◄─── session-bus
           session-bus ───► lib/session-mail.ts · session-roster.ts · session-label.ts
           session-bus ──╳► lib/workflow/*           the bus knows nothing of cards

files      board's Team tab ───► ~/.pi/agent/repos/<repo-id>/session-bus/   ◄── session-bus
           read through lib/session-roster.ts and session-mail.ts, so the page draws
           the queue with the bus extension switched off

requests   board, team ───► lib/session-tool.ts
                              ├─ a tool context: a nested `session` call
                              └─ any other: `pi.events`, bounded by lib/bus-request.ts
           ───► membership-request.ts · claim-request.ts · send-request.ts ───► runtime
```

- **Only the bus writes the bus.** A card's paths, a join, and a handoff all reach
  `session-bus`'s own operations; the board and the lead never touch a record file.
- **Reading is not asking.** The Team tab opens the same files the bus writes, which is
  why `/board` still shows the queue when `session-bus` is off — it loses the sending
  and the waking, not the view.
- **A request always settles.** It is claimed once, a caller with no listener is told the
  bus is not loaded, and a claim that never answers is bounded rather than left waiting.

## A round, in order

1. **Join.** `/board` joins the session that leads as the board's lead; any other
   session joins with `/team join` or `session join`, and its `board` and `team` tools
   arrive at the next turn — a session on no team is offered neither, and its turn names
   the door. `/team join` takes the first name `team.teammates` lists that nobody holds —
   the default five unless the project states its own — and `/team join <label>` is the
   one door that renames a session.
2. **Put the work on the board.** `board add` lands a card in `backlog`, where
   nobody holds it.
3. **Take one card.** `board claim 4` moves it to `plan` for this session, or the
   lead hands it over with `team assign 4 to billing-core`.
4. **Design, then sign.** The owner records the plan and its contract, and the
   lead signs with `/board approve 4`; a card reaches `execute` only on that
   signature. The write that makes the contract whole tells the lead in its
   inbox, so the sign is a wake-up rather than a poll — a board/team join asks for
   `wake`, so that message starts the lead's turn.
5. **Claim the files before editing.** `session claim paths ["docs/"]` is
   all-or-nothing: if one path conflicts, nothing is claimed, and a peer sees what
   is held rather than discovering it in a merge.
6. **Work, and read the mail.** `session inbox` at coordination points — a
   handoff, a question, an event from a peer. To wait on one, arm `join` with
   `wake` and end the turn: a message waits in an inbox until its session runs, so
   an armed watch costs nothing once the turn is over, where a `sleep` sits inside
   a turn that mail cannot reach. While the inbox holds files, every turn starts with
   a one-line `[SESSION BUS]` waiting notice, so the read is prompted by the transcript
   rather than by the person; a board/team join asks for `wake`, so the turn starts on
   its own.
7. **Land, then close.** The lead's `/board review 4` is the second signature,
   taken in the card's tree; the lead merges `--no-ff` and pushes, then the holder
   moves the card to `done`, which records the merge.

## Who holds what, and for how long

A card boundary is a context boundary: a session clears its transcript with `/new` once its card is
closed — never mid-card, where the plan and the diagnosis live only in the transcript — and the
record carries the name, the mail, the watch, the claims and the card across the reset.

| Thing | Held by | Ends when |
|---|---|---|
| a card | one session, by its id | released, reclaimed, or closed |
| the two signatures | the lead, never a session holding the card | written on the card |
| a path claim | one session | released, or that session ends — and, for a claim from another machine, when that machine's heartbeat stops |
| a label | one session | its heartbeat stops and ten minutes pass |
| an inbox message | one recipient | read, or after 24 hours |

## A stopped owner

A session that stops leaves its path claims behind, and the board says so rather than implying a free
slot: over a card whose owner stopped, it prints `9 paths stay held by jack until it stops`. **A card
whose owner has stopped is not a card whose paths are free** — a peer reaching for one is refused by a
conflict naming that owner, and before this door the seat could only describe the state.

A claim ends on its owner's heartbeat, too: ten minutes past it the prune takes the paths, and the
session that ran the prune leaves the owner one notice in its inbox naming them. So a session that
slept through the window reads what it lost instead of editing a path a peer may now hold — the row
and the mail it also lost come back on their own, and the claim is the one that does not.

`session release paths [...] holder tom`, from the seat, moves those claims to the seat in one store
call: they change hands rather than being dropped, so nothing is free in between for a third session
to take, and `tom`'s own next claim is refused with a conflict naming the seat. A forgotten transfer
blocks that peer as firmly as a deletion did; only the refusal says whose claims they are. A caller
with no seat is refused, and `/board` starts a session attached to a board, which holds no seat.

## What none of them promise

- **No authentication.** The bus is files under
  `~/.pi/agent/repos/<repo-id>/session-bus/`, on this machine, under your OS user: any
  process with your file access can read and write it.
- **No lock.** Ownership is a session id, so two sessions can still open one file; a
  path claim is what makes the collision visible before the edit.
- **One user, and one machine per session.** A session's process is on the machine
  that wrote its record, so another machine's session is read by its heartbeat and
  never by its pid — and mailed from here it will not read it. A `/new` keeps the
  record, so a reset costs the transcript and nothing else; a quit ends the
  membership, and the label and the inbox with it.
- **No forced takeover.** Reclaiming a card takes it back to `backlog`; nobody
  takes a path claim from a session that is still running.

## Two machines, one store

A board directory can live in a folder a sync client replicates, and then two sessions are not
the only writers: the other machine's copy can land at any moment. The store is built for that
rather than around it.

**A write is verified, not assumed.** After writing a card the store reads it back and compares
the bytes, because the file can be replaced in that window; a file that is not the one this pass
wrote is a rival revision, so the operation is replayed onto what is there. A card that keeps
being replaced is refused by number with both revisions named, never forced over. That is what
makes the board **converge** — no operation is lost silently — and it is not linearizability: a
copy the client delivers after the read-back is caught by the next write on either machine.

**The bus joins the same directory.** A replicated store means `session-bus/` is shared too, so a
record names the machine that wrote it and a claim names the machine that made it. Two rules follow
from what a peer can actually see: a record from another machine is judged by its heartbeat alone
(its pid here is a local process by coincidence), and its claim lapses on *that machine's*
heartbeat, read from `session-bus/hosts/<host>.json`. Each machine's identity lives in
`~/.pi/agent/presence/host.json` — outside the store, because a client would replicate it and the
other machine would then claim this one's name. The Team tab draws those machines: a row per
machine saying when it was last seen, and the machine's name on a session that is not here.

**Ids** come from `next-id.json` beside the cards, read as the maximum of the counter and the
piles, so a stale copy cannot unspend one; the exclusive create still decides when two machines
pick the same number. **The write lock** lives in `~/.pi/agent/presence/<repo-key>/`, outside the
store, because a lock a client replicated would name a process that is not on this machine — a
`.lock-board` inside the board directory is ignored. And a name that is not a card id, such as a
client's `0042 (conflicted copy).json`, is reported as a file this build cannot read, with the
reason, rather than parsed.

## Turning it on, and off

`/board` joins the leading session, and `session status` reads the bus without
joining it. To stop coordinating, toggle `session-bus` in `/bytefly`: the team goes,
and the cards stay workable without it. What that costs, and what the other
extensions cost while they run, is [A minimal install](./minimal-install.md).

## Learn more

- [Work a board](./tutorials/first-board.md) — one card through both signs.
- [`board`](./extensions/board.md) — lanes, the per-lane limits, and the store.
- [`team`](./extensions/team.md) — the round, and who answers a label.
- [`session-bus`](./extensions/session-bus.md) — labels, mail, claims, and TTLs.
- [Security](./security.md) — the trust boundary the bus sits behind.
