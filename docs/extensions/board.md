# board — one shared feature board per repository

The board is one list of features for a repository, worked by every session on it. A card
carries what kind of work it is, its owner, its priority, what it waits on, the contract it
promises, and the notes that explain it — and two signatures are needed before it can ship.

<img src="../../assets/screens/board.png" alt="The board page: a toolbar with the repository's name, the live state, theme and keyboard controls; Board and Team tabs, a ten-cell done gauge and a filter; five lane columns with counts and fold controls; and note-shaped cards as tall as they draw, tinted by the lane they sit in and separated by space rather than rules, each carrying its number and kind, its title, its path hints, the state it owes somebody, and on its last line whose it is with its age and history" width="1280" height="480">

- **One board per repository**, one page: the first `/board` serves it, every other session opens it.
- **The page is a view**: it follows the files, and nothing is claimed, moved, or signed from a browser.
- **Two signatures**: the lead signs both gates — a contract before `execute`, the work before
  `done` — with `board` or `/board`, and `/board` also takes the seat that refuses code (below).
- **The lane is the record**, and a session is told once which cards are its own, with what each owes.
- **Steps stay out of it** — they live in the owner's plan and `todo`.

## What you can do

| What you want | What to do |
|---|---|
| See the board | `/board` — Board and Team tabs, live |
| Take the seat | `/board` in the session that serves the page: code edits are refused until `/board stop`, which ends the page with the seat |
| Put a feature on it | `board({ action: "add", title, paths })` — a call, because `add` takes a title rather than a card id |
| Say what kind of work it is | `type` on `add` or `edit`: `feature`, `bug`, `refactor`, `docs`, `test`, or `chore` |
| Flag a breaking change | `breaking: true` on `add` or `edit`; `false` clears it |
| Take a card | `board claim 4` — into `plan`, owned by this session; `board reclaim 4` takes one back — the lead from anyone, a peer only once that owner's record says it stopped. The claims it took stay with the session that took them: only that session's `session release` frees them, or its stopping, and a release inside `execute` waits only for the next turn, so `paths: []` and the lane are the exits that last |
| Record what it promises | `board contract 4 path <plan file> goal … acceptance … scopeOut … verify …` — all four lines, and the `verify` command is required |
| Approve the contract | `/board approve 4` in the lead's session, or the lead with the `board` action `approve` |
| Start the work | `board move 4 execute` |
| Park a card | `board move 4 blocked blocker decision blockedBy "waiting on the API owner"` |
| Sign off finished work | `/board review 4` in the lead's session, then `board move 4 done` |
| Explain something | `board note 4 "why the retry is capped at three"` |
| Set finished work aside | `/board archive` in the lead's session, or the `board` action `archive` from any session |
| Read the round | `board list round: true`, or `/team` — owners, unassigned, unplanned, awaiting approval, awaiting review, untold, blocked, done |

## Try it

```text
Put the billing webhook's order acceptance on the board, under src/billing.
```

The model calls `board({ action: "add", … })` and then, when you say so, `board({ action: "claim", card: "1" })`.
Those are tool actions, not commands: `Reference` lists every `/board` word and who may run one. The claim names
the next step, and `/board approve 1` refuses until the contract names a plan file in this repository's store.

A card is as tall as it draws: the line above its last one says what it owes, and is blank when it owes
nothing. The row and `board list` print that gate in one word, and a narrow transcript row draws it on the next line.

## Reference

**Lanes.** `backlog` is the pool nobody holds, `plan` is where the card is designed and its
contract signed, `execute` is where the work happens, `blocked` waits on a person, and `done`
is closed. Each move follows the one transition from where the card is; no lane is skipped.

**The page.** A lane's width follows its work; five sit side by side (one below 1180px, via the picker) and a
lane of 24 folds. The pane is the one scroll box: a lane is as tall as the board, its head riding its edge. The
Team tab raises what needs a lead: a band shows five rows, folds the rest, pins its head, and lets each row say why.

**Actions.** One tool, shaped by action: `list`, `add`, `claim`, `release`, `reclaim`, `move`, `note`, `contract`, `approve`,
`review`, `edit`, `archive`, `drop`. `claim` and `move` are refused while a lane is full; `assign` is `team`'s verb under that
rule, and one session holds one card in flight by default (`board.wip.perOwner`). `reclaim` takes a card back: the person and
the lead always, a peer only while its owner is quiet or gone. `move` into `execute` or `done` re-reads the plan and refuses a
card whose plan is gone. An `execute` card claims the `paths` nobody else holds; `edit` claims added paths and releases removed
ones, claiming first so a conflict releases nothing. A contract names a `verify` command — the card's own check, not the
repository's gate, [as the walkthrough writes one](../tutorials/first-board.md) — and `review` runs the module and suite size gates first, then the command, in the tree `root` names, refusing the sign when either gate is red; a tree that keeps neither gate file skips them, and the sign records the skip so a reader can tell "they held" from "they were not there".
`done` refuses a sign with no result or one older than the card's state, and resolves the landing: an older tree, a tip
declaring another card, or a squashed branch its subject names. A reviewed merge is its own landing
only while it is the tip; `done` records the merge, `landed: <sha>` names it, and `override` reads "by instruction".
A folded card names that merge in `landed`; the argument is checked at or below its spot-check, never above it.

**Commands.** `/board` serves or opens the page (add `team` for the Team tab; `serve.autoOpen` off prints
the URL, and a remote turn says the browser needs this machine); `/board approve <id>` and `review <id>
[--root <tree>]` sign, `archive` sweeps, `status` prints the seat, repository, port, and tabs, and `stop`
ends the page and the seat together: leaving the seat costs the live round, and `/board` re-takes both.

**Who signs.** The lead is `team.lead` in `bytefly.json` (default `gavin`), and the page serves as that name; an
empty lead lets only the person sign and serves no page. A session signs only while it is the lead, never while
it holds the card, and the `/board` words gate on that label. The sign says who heard it — quiet, not listening,
or not told — and an untold one is sent again.

**Lead mode.** Serving the page is the seat: `/board` turns the mode on in that session and the bar draws `⬢ lead`. While it holds the seat keeps a closed
allow-list — the readers `read`, `grep`, `find`, `ls`, `read_doc`, `run_doctor`; the board's verbs (`board`, `team`, `session`, `plan`, `todo`, `goal`,
`question`, `subagent`); `web_search`, `web_fetch`, `bash` for read-only git — a retargeting `-C` or `cd` is refused with the by-revision forms to use instead (`git show <sha>:<path>`, `git log <branch>`) — and every other tool is refused by a sentence naming `/board stop`. A tool's
own `readOnlyHint` does not admit it, so an MCP reader is refused while the seat is held. `subagent` stays read-only, `plan` keeps `write` and `steps`
while `enter` refuses, and each turn carries one `[LEAD MODE]` line: the seat's unread mail, what is yours to sign, each parked card's decision,
the pool's three ids and a count, who is listening. A seated session lands a reviewed card with `board land`, which refuses anyone else, so the seat stays on.

**Where it lives.** `~/.pi/agent/repos/<repo-id>/board/` — a card per file under `cards/`, with `archive/` and `ended/` beside it. The archive holds more than one record shape: a file written before the lanes says `status` and no `lane`, and the reader maps that word (`todo` → `backlog`, `doing` → `execute`, `done` and `blocked` as themselves), so nothing is rewritten. A card records its plan by the **name** it holds in this repository's plan store, not this host's path, so two machines sharing a store resolve it on either — and a card holding an older absolute path still executes. A shared store is compared on every write, so it converges rather than serializing — [two machines, one store](../multi-session.md#two-machines-one-store).

## Limits

- `done` is terminal: a card finished by mistake is dropped and re-added at a new number. Nothing prunes
  itself: `archive` takes a card nothing waits on, and `--older-than 30d` bounds it, naming what it kept.
- The lead is a name, not an authority: any session can join it, and a lead holding a card can release it, sign it and
  claim it again. A lead holding no card may still move it `plan` → `execute`, or close a signed card whose holder the
  bus lost — a close, not a signature; every other verb is the holder's. A gate is a reading.
- Settle title, paths and contract before the sign: a write after the spot-check stops it speaking, and a branch is proved against `main` as cut. Restart when board code lands — a `/reload` keeps a `lib/` module another extension loaded.
- Ownership is a session id, not a lock — only `session-bus` path claims are. A card in `execute` holds its `paths`, and a lane change frees only the writer's. A card whose owner's record reads `gone` is pooled by the next start's sweep, but only when the card names that owner by **id**: a label is how a seat is handed over, so a card naming only a name is left alone and the sweep says which record it declined to read — it waits for a person, which is the price of not guessing. A sweep also keeps the spot-check it finds: holding the seat is not withdrawing a judgement, so only the signer's own reclaim takes a sign back.
- The page asks the bus for a stamp every second — mail waiting, a peer's state, a turn starting — and sweeps every five for what no file announces; a page with no watch scans every second. The reader is the stream, not the tab: while one is open the tick reads, and with none it reads nothing at all — no stamp, no frame — and no timer waits for a closed tab to come back, so the session outlives its page.

## Settings

| Key | Default | What it does |
|---|---|---|
| `wip.plan` | `3` | Cards a repository may hold in `plan` at once (1–20). |
| `wip.execute` | `5` | Cards a repository may hold in `execute` at once (1–20). |
| `team.lead` | `"gavin"` | The team name whose signature the two gates take. A stated empty lead is no lead: only the person signs, and `/board` will not serve. |
| `team.teammates` | `["gavin","tom","jack","mike","sam"]` | Who is on the team: labels, at most 20 of them. A session the bus has not recorded takes the first free one as the name it writes — `team-agent-<id>` once every one is held — and the footer draws a name only when it is one of these, so a stated empty list draws no chip. |

The limits live in `board` and the names in `team`, both edited by `/bytefly settings`
([configuration](../configuration-reference.md#team--the-projects-own-team)); toggle `board` to switch it off.

## Learn more

- [Your first board](../tutorials/first-board.md) — one feature through both gates.
- [Several sessions](../multi-session.md) — the round the cards, the bus, and the lead make together.
- [`team`](../extensions/team.md) — handing a card to a peer.
- [`session-bus`](../extensions/session-bus.md) — the bus the signs travel on.
- [`plan`](../extensions/plan.md) — the plan a contract points at.
- [Troubleshooting](../troubleshooting.md) — when a gate refuses the session that holds the card.
