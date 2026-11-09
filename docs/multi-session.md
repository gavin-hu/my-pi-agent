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
| [`team`](./extensions/team.md) | the lead's round over the cards — assign, offer, reclaim, claim, ask |

Nothing in the three starts a process. A message lands in an inbox and is read at
the recipient's next turn, so a session that is not running stays not running.

## A round, in order

1. **Join.** `/board` joins the session that leads as the board's lead; any other
   session joins on its first claim or with `session join`. `/team join <label>`
   is the one door that renames a session.
2. **Put the work on the board.** `board add` lands a card in `backlog`, where
   nobody holds it.
3. **Take one card.** `board claim 4` moves it to `plan` for this session, or the
   lead hands it over with `team assign 4 to billing-core`.
4. **Design, then sign.** The owner records the plan and its contract, and the
   lead signs with `/board approve 4`; a card reaches `execute` only on that
   signature.
5. **Claim the files before editing.** `session claim paths ["docs/"]` is
   all-or-nothing: if one path conflicts, nothing is claimed, and a peer sees what
   is held rather than discovering it in a merge.
6. **Work, and read the mail.** `session inbox` at coordination points — a
   handoff, a question, an event from a peer.
7. **Close it.** The lead's `/board review 4` is the second signature; the card
   then moves to `done`.

## Who holds what, and for how long

| Thing | Held by | Ends when |
|---|---|---|
| a card | one session, as its owner label | released, reclaimed, or closed |
| the two signatures | the lead, never a session holding the card | written on the card |
| a path claim | one session | released, or that session ends |
| a label | one session | its heartbeat stops and ten minutes pass |
| an inbox message | one recipient | read, or after 24 hours |

## What none of them promise

- **No authentication.** The bus is files under
  `~/.pi/agent/session-bus/<repo-key>/`, on this machine, under your OS user: any
  process with your file access can read and write it.
- **No lock.** Ownership is a label, so two sessions can still open one file; a
  path claim is what makes the collision visible before the edit.
- **One machine, one user.** A peer on another host is not on the bus, and
  membership does not survive a resume or a restart — unread mail and the label do.
- **No forced takeover.** Reclaiming a card takes it back to `backlog`; nobody
  takes a path claim from a session that is still running.

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
