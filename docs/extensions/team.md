# team — the lead's round over the board

`board` owns the cards; `team` is how a lead moves them between sessions: hand one
to a peer that is already running, offer one to whoever is free, or ask a peer a
question. Nothing here starts a process — every action is a message, and a peer
listening with `wake` is woken for it ([`session-bus`](session-bus.md) owns that).
A card's own state — `claim`, `reclaim`, the moves, the contract, the two signs — is
[`board`](board.md)'s, and only `board`'s.

<img src="../../assets/screens/team.png" alt="The Team tab as three columns: AGENTS with the lead pinned first and one card per session carrying a monogram, its state, its mail and its missions; ACTIVE WORK with a NEEDS YOU queue in three bands — YOUR SIGNATURE, UNCLAIMED and STALLED — each ask one line with its reason printed under it, over BLOCKED, EXECUTE and PLAN swimlanes; ACTIVITY with WAITING mail and a RECENT rail" width="1280" height="1038">

The board's Team tab is the same round as a page, in three columns that each count themselves and
scroll as one. **AGENTS** holds a card per session, the lead pinned first: a monogram, its state
and age at the edge, `lead` and `you` chips with the mail and needs-you counts, and a mission line
per card. **ACTIVE WORK** is the lead's queue over the `blocked`, `execute` and `plan` swimlanes:
one line per ask, the reason printed rather than hovered, filed by whose move it is into `YOUR
SIGNATURE`, `UNCLAIMED` and `STALLED`, none behind a fold — a column per band on a 2K window, and a
phone gives the title the whole line to wrap. **ACTIVITY** draws unread mail as a block — a fill
and an accent edge — above a flat recent history; reading consumes nothing.

## What you can do

| What you want | What to do |
|---|---|
| Hand a card to a running session | `team assign 4 to billing-core` |
| Offer one to whoever is free | `team offer 5 note "whoever is free"` |
| Take a card back from a quiet owner | `board reclaim 4` |
| Take a card yourself | `board claim 5` |
| Ask a peer a question | `team ask to billing-core question "what is left on #4?"` |
| See the round | `/team` in the terminal, or the board's Team tab |
| Join the team | `/team join billing-core` names yourself, or `/team join` for a name `team.teammates` lists |

## Try it

Two sessions, one repository. In the first:

```text
/board
```

It joins as the lead. In the second, claim a card with `board` — that joins it under its own
name. Then, from the lead:

```text
team assign 4 to billing-core
```

The peer is told at its next turn; the card's owner is `billing-core`, and the
lead's round now shows it as held.

## Reference

**Actions.** Three, and every one of them reaches another session. `assign` (card, `to`, `note?`)
joins, then sends a handoff, then records the owner — read from the team again *after* the message,
so the card names the session that has it and a stopped record cannot become one — and whether the
bus took it: `told` means written, not read, because mail is pruned after a day; `offer` (card,
`note?`) broadcasts the card and records only the moment it was offered, so the first peer to claim
it wins; `ask` (`to`, `question?`) sends one peer a question and writes nothing else: its own ask
id, and the answering session by id, so `re: <id>` matches it.

A card's own verbs are not here: `claim` takes a pool card into `plan`, `reclaim` returns it to
Backlog with its notes and contract (the lead from anyone, a peer only from a stopped owner), and
the lane moves, the contract and the two signs are the rest — all [`board`](board.md)'s, one door.
`/team`'s stalled line names it: `board reclaim 1, 2 — api-core stopped`.

A flat parameter object means an action refuses a field it does not read, naming
the action that takes it — `offer` does not take `to`.

**Who is who.** `/team` lists who is live, who is live but not listening, who has gone
quiet (a heartbeat older than ten minutes), and who is not on the bus at all — an owner a card
names that no record answers. A label nobody answers to cannot be handed a card; the result says
so. A card is named by the record its owner's **id** carries now, so a rename is one row and not
a live one beside a dead label. A handoff the bus could not name records the owner `unresolved`:
mail still goes to the label, but only the lead moves the card. A card a quiet owner holds is
reclaimable; one held by a session with no record is not, because a live session that never
joined looks the same. A message to a quiet or not-listening peer says so: written is not heard.

**Joining.** `/board` joins you as the lead (`team.lead`). Another session joins under its own
name — `/team join <label>`, or a bare one for the first free `team.teammates` name, the id-derived
`team-agent-` name when none is free. The list defaults to five, from `gavin`, so a repository that
states no team still names a session, and `"teammates": []` says nobody. A recordless board session
is named the same way, so its card and its join agree. An assign or an ask joins once, and a
typed label also joins `team.teammates`; a bare join writes nothing and leaves Pi's name alone.

`assign` and `ask` join **before** they send, because the message names this session
as the way back, and send nothing when the join is refused. The reason says what to
do, and the door is not always `/team join`: with no bus loaded it names the
extension to turn on, and with the label held by another record it says whose it is —
joining under another name costs a lead its signature, because the gates compare
`team.lead` by label.

**Plan mode.** Neither `team` nor `session` is read-only, so plan mode refuses both
by name; `board list` still reads. Assign after the plan is approved.

## Limits

- Nothing here starts a peer's process: a peer that never joined cannot be handed a
  card, and one listening with `wake` is woken by its mail.
- A card somebody already holds is not assignable: `board reclaim` it, then assign.
- An offer is advice — a card can stay offered indefinitely, counted as unassigned.
- Ownership does not claim paths: the peer still claims the files it edits through
  `session`.
- The lead's name is a label, not a person: it reaches whoever is serving the page
  just now, and nothing when nobody is.

## Settings

The team is `bytefly.json`'s `team` section — `team.lead`, whose signature the two gates take, and
`team.teammates`, the names a session draws from, five by default
([configuration](../configuration-reference.md#team--the-projects-own-team)). Toggle `team` in
`/bytefly` to switch the extension off; `board` alone still moves cards.

## Learn more

- [Several sessions](../multi-session.md) — the whole round, from the first claim
  to the second signature.
- [`board`](../extensions/board.md) — the cards this round moves.
- [`session-bus`](../extensions/session-bus.md) — the bus every message travels on.
- [Work a board](../tutorials/first-board.md) — one card through both signs.
