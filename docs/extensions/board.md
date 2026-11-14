# board — one shared feature board per repository

The board is one list of features for a repository, worked by every session on it. A card
carries what kind of work it is, its owner, its priority, what it waits on, the contract it
promises, and the notes that explain it — and two signatures are needed before it can ship.

<img src="../../assets/screens/board.png" alt="The board page: a toolbar with the repository's name, the live state, theme and keyboard controls; Board and Team tabs, a ten-cell done gauge and a filter; five lane columns with counts and fold controls; and note-shaped cards as tall as they draw, tinted by the lane they sit in and separated by space rather than rules, each carrying its number and kind, its title, its path hints, the state it owes somebody, and on its last line whose it is with its age and history" width="1280" height="467">

- **One board per repository**, one page: the first `/board` serves it, every other session opens it.
- **The page is a view**, and it follows the files: nothing is claimed, moved, or signed from a
  browser, and a card another session writes reaches an open tab as it lands, wearing a mark.
- **Two signatures**: the lead approves a contract before `execute` and spot-checks the work
  before `done`; the person at the keyboard can give either, with `/board approve` and `/board review`.
- **The lane is the record**, and a session is told once which cards are its own, with what each owes.
- **Steps stay out of it** — they live in the owner's plan and `todo`.

## What you can do

| What you want | What to do |
|---|---|
| See the board | `/board` — Board and Team tabs, live |
| Put a feature on it | `board add "<title>" paths ["src/area"]` |
| Say what kind of work it is | `type` on `add` or `edit`: `feature`, `bug`, `refactor`, `docs`, `test`, or `chore` |
| Flag a breaking change | `breaking: true` on `add` or `edit`; `false` clears it |
| Take a card | `board claim 4` — into `plan`, owned by this session; `board reclaim 4` takes one back, from a peer only once that owner's record says it stopped |
| Record what it promises | `board contract 4 path <plan file> goal … acceptance … scopeOut … verify …` — all four lines, and the `verify` command is required |
| Approve the contract | `/board approve 4` as the person, or the lead with the `board` action `approve` |
| Start the work | `board move 4 execute` |
| Park a card | `board move 4 blocked blocker decision blockedBy "waiting on the API owner"` |
| Sign off finished work | `/board review 4`, then `board move 4 done` |
| Explain something | `board note 4 "why the retry is capped at three"` |
| Set finished work aside | `/board archive` |
| Read the round | `board list round: true`, or `/team` — owners, unassigned, unplanned, awaiting approval, awaiting review, blocked, done |

## Try it

```text
Put the billing webhook's order acceptance on the board, under src/billing.
```

The model calls `board({ action: "add", … })` and then, when you say so,
`board({ action: "claim", card: "1" })`. Those are tool actions, not commands:
you type only `/board archive|approve|review|status|stop|team`.

The claim's result names the next step, and `/board approve 1` refuses until the contract
names a plan file in this repository's store. A claim also joins the team ([`team`](team.md)).

A card is as tall as it draws: the line above its last one says what it owes or waits on, and is
blank when it owes nothing. The row and `board list` print that gate in one word.

## Reference

**Lanes.** `backlog` is the pool nobody holds, `plan` is where the card is designed and its
contract signed, `execute` is where the work happens, `blocked` waits on a person, and `done`
is closed. Each move follows the one transition from where the card is; no lane is skipped.

**The page.** A lane's width follows the work it holds; five lanes sit side by side (one below
1180px, via the picker), and a lane of 24 cards folds. The pane is the one scroll box: a lane is as
tall as the board, its head riding its edge. The Team tab draws the board's own card, and above the
work that moves it raises what needs a lead: a band shows five rows and folds the rest behind one
control, pins its head under the pane's, and says a sentence every row shares once.

**Actions.** One tool, shaped by action: `list`, `add`, `claim`, `release`, `reclaim`, `move`,
`note`, `contract`, `approve`, `review`, `edit`, `archive`, `drop`. `claim`, `move` and `assign` are refused while
`plan` or `execute` is full, naming the ways out. `reclaim` takes a card back from its holder: the person and the
lead always, a peer only while that owner's record says quiet or gone. `move` into `execute` or `done` re-reads
the plan where the write lands, and a plan that is gone refuses it. A contract names a `verify` command — required
— and `review` runs it in the tree you review in, recording the exit, the branch and the commit. `done` refuses a
sign with no result or one older than the card's write, and resolves the merge that carried the review — not the
tip, so a card still closes after others landed — refusing one that moved its paths. `landed: <sha>` answers which
commit a finished card is, and is absent on a card closed before the rule or by an older build: its review's sha is
the evidence it has. An `override` reads `closed by instruction`.

**Commands.** `/board` serves or opens the page (add `team` for the Team tab);
`/board approve <id>` and `/board review <id>` sign as the person; `/board archive` runs the sweep;
`/board status` prints the seat, repository, port, and tabs; `/board stop` ends the page.

**Who signs.** The lead is `team.lead` in `bytefly.json`, and the page serves as that name. A
project names its own; one that names none lets only the person sign, and `/board` serves no page
it would seat as nobody. A session signs only while it is the lead and never while it holds the
card; `/board approve` and `/board review` sign as the person, marked `person: true`. The sign
says who heard it — quiet, not listening, or not told — and an untold one is sent again.

**Where it lives.** `~/.pi/agent/board/<repo-key>/` — a card per file under `cards/`, with `archive/` and `ended/` beside it. The archive holds more than one record shape: a file written before the lanes says `status` and no `lane`, and the reader maps that word (`todo` → `backlog`, `doing` → `execute`, `done` and `blocked` as themselves), so a card set aside reads `done` like the rest and no file is ever rewritten.

## Limits

- `done` is terminal: a card finished by mistake is dropped and re-added at a new number. Nothing prunes
  itself: `archive` takes a card nothing waits on, and `--older-than 30d` bounds it, naming what it kept.
- The lead is a name, not an authority: any session can join it, and a lead holding a card can release it,
  sign it and claim it again. A lead holding no card may still move it `plan` → `execute`, the lane its
  approval opened; every other verb is the holder's. A gate is a reading, not a permission.
- Settle a card's title, paths and contract before asking for its sign: any write after the spot-check
  makes that run stop speaking for the card, and a branch is proved against `main` as it was cut.
- Ownership is a session id, not a lock: only `session-bus` path claims are. A card in `execute` holds its
  `paths`, and a lane change releases only the writer's; a card whose owner ended is released by a start,
  or re-seated to the session wearing that name. Eight transitions are kept; an unreadable file is skipped.
- The page sweeps every five seconds for what no card file announces, and scans every second with no watch.

## Settings

| Key | Default | What it does |
|---|---|---|
| `wip.plan` | `3` | Cards a repository may hold in `plan` at once (1–20). |
| `wip.execute` | `5` | Cards a repository may hold in `execute` at once (1–20). |
| `team.lead` | `""` | The team name whose signature the two gates take. Empty is no lead: only the person signs, and `/board` will not serve. |
| `team.teammates` | `[]` | Who is on the team: labels, at most 20 of them. A session the bus has not recorded takes the first free one as the name it writes; the footer draws a name only when it is one of these, so an empty list draws no chip. |

The limits live in `board` and the names in `team`, both edited by `/bytefly settings`
([configuration](../configuration-reference.md#team--the-projects-own-team)); toggle `board` to switch it off.

## Learn more

- [Your first board](../tutorials/first-board.md) — one feature through both gates.
- [Several sessions](../multi-session.md) — the round the cards, the bus, and the lead make together.
- [`team`](../extensions/team.md) — handing a card to a peer.
- [`session-bus`](../extensions/session-bus.md) — the bus the signs travel on.
- [`plan`](../extensions/plan.md) — the plan a contract points at.
- [Troubleshooting](../troubleshooting.md) — when a gate refuses the session that holds the card.
