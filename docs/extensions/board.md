# board — one shared feature board per repository

The board is one list of features for a repository, worked by every session on it. A card
carries what kind of work it is, its owner, its priority, what it waits on, the contract it
promises, and the notes that explain it — and two signatures are needed before it can ship.

<img src="../../assets/screens/board.png" alt="The board page: a toolbar with the repository's name, the live state, theme and keyboard controls; Board and Team tabs, a ten-cell done gauge and a filter; five lane columns with counts and fold controls; and note-shaped cards of one height, tinted by the lane they sit in and separated by space rather than rules, each carrying its number and kind, its title, its path hints, and on its last line whose it is with its age and history" width="1280" height="446">

- **One board per repository**, and one page: the first `/board` serves it, every
  other session opens that same page.
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
| Record what it promises | `board contract 4 path <plan file> goal … acceptance … scopeOut … verify …` |
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

Every card's last line is its hover and the title button's description, so a lane stays an index:
`contract ready — needs approval`, `executing — no spot-check yet`, `offered 2h ago`.

## Reference

**Lanes.** `backlog` is the pool nobody holds, `plan` is where the card is designed and its
contract signed, `execute` is where the work happens, `blocked` waits on a person, and `done`
is closed. Each move follows the one transition from where the card is; no lane is skipped.

**The page.** A lane's width follows the work it holds; five lanes sit side by side (one below
1180px, via the picker), a lane of 24 cards folds, and a card is a one-height note with no edge.
The Team tab draws that same card, with no rule between two of them.

**Actions.** One tool, shaped by action: `list`, `add`, `claim`, `release`,
`reclaim`, `move`, `note`, `contract`, `approve`, `review`, `edit`, `archive`,
`drop`. `claim`, `move` and `assign` are refused while `plan` or `execute` is full, naming the
ways out. `reclaim` takes a card back to `backlog` from its holder, the person and the lead
always, and from a peer only while that owner's record says quiet or gone. `move` into
`execute` or `done` re-reads the plan where the write lands: a plan that is gone refuses the
move, and the face says `its plan is gone`. A sign nobody heard reads `· not told` on a live
card; saying it again sends it. A contract may name a `verify` command: `review` runs
it in the board's tree (the worktree you entered), recording the exit, commit, and tree;
`done` refuses a sign with no result, or one older than the card's write. `review` takes
an `override` — one line saying why — for a close outside the gate: `closed by instruction`.

**Commands.** `/board` serves or opens the page (add `team` for the Team tab);
`/board approve <id>` and `/board review <id>` sign as the person; `/board archive` runs the sweep;
`/board status` prints the seat, repository, port, and tabs; `/board stop` ends the page.

**Who signs.** The lead is `board.lead` in `bytefly.json` (`lead` by default), and the page serves
as that name. A session signs only while it is the lead and never while it holds the card;
`/board approve` and `/board review` sign as the person, marked `person: true`. The sign says who
heard it — quiet, not listening, or not told — and an untold one is sent again by its signer.

**Where it lives.** `~/.pi/agent/board/<repo-key>/` — one card per file under
`cards/`, with `archive/` and `ended/` beside it.

## Limits

- `done` is terminal: a card finished by mistake is dropped and re-added at a new number.
- Nothing prunes itself: `done` cards cost a read until `archive` takes them, which it only
  does for a card nothing open waits on — and an archived record is closed but for `drop`.
- The lead is a name, not an authority: any session can join it, and a lead holding a card
  can release it, sign it, and claim it again. A gate is a reading, not a permission.
- Ownership is a session id, not a lock: only `session-bus` path claims are. A card in `execute`
  holds its `paths`, and a lane change releases only the writer's — so a `reclaim` from a peer
  names what stays held; a card whose owner's session ended is released at the next start.
- A card keeps eight lane transitions; an unreadable card file is skipped, and named in the listing.
- The page sweeps every five seconds for the facts no card file announces — a card gone
  unwritten, a peer quiet or gone, a plan removed — and scans every second with no watch.

## Settings

| Key | Default | What it does |
|---|---|---|
| `lead` | `"lead"` | The team name whose signature the two gates take. |
| `wip.plan` | `3` | Cards a repository may hold in `plan` at once (1–20). |
| `wip.execute` | `5` | Cards a repository may hold in `execute` at once (1–20). |

They live in the `board` section of `bytefly.json`; `/bytefly settings` edits all
three ([configuration](../configuration-reference.md#board--the-shared-feature-board)). To
switch the extension off entirely, toggle `board` in `/bytefly`.

## Learn more

- [Your first board](../tutorials/first-board.md) — one feature through both gates.
- [Several sessions](../multi-session.md) — the round the cards, the bus, and the lead make together.
- [`team`](../extensions/team.md) — handing a card to a peer.
- [`session-bus`](../extensions/session-bus.md) — the bus the signs travel on.
- [`plan`](../extensions/plan.md) — the plan a contract points at.
- [Troubleshooting](../troubleshooting.md) — when a gate refuses the session that holds the card.
