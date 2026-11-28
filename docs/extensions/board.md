# board — one shared feature board per repository

The board is one list of features for a repository, worked by every session on it. A card
carries what kind of work it is, its owner, its priority, what it waits on, the contract it
promises, and the notes that explain it — and two signatures are needed before it can ship.

<img src="../../assets/screens/board.png" alt="The board page: a toolbar with the repository's name, the live state, theme and keyboard controls; Board and Team tabs, a ten-cell done gauge and a filter; five lane columns with counts and fold controls; and note-shaped cards as tall as they draw, tinted by the lane they sit in and separated by space rather than rules, each carrying its number and kind, its title, its path hints, the state it owes somebody, and on its last line whose it is with its age and history" width="1280" height="480">

- **One board per repository**, one page: the first `/board` serves it, every other session opens it.
- **The page is a view**: it follows the files, and nothing is claimed, moved, or signed from a browser.
- **Two signatures**: the lead signs both gates — a contract before `execute`, the work before
  `done` — with `board` or `/board`, and `/board` also takes the seat that refuses code (below).
- **The lane is the record**: told once which cards are its own and what each owes, and again after a `/tree` or a `/compact`.
- **Steps stay out of it** — they live in the owner's plan and `todo`.

## What you can do

| What you want | What to do |
|---|---|
| See the board | `/board` — Board and Team tabs, live |
| Take the seat | `/board` in the session that serves the page: code edits are refused until `/board exit`, which ends the page with the seat |
| Put a feature on it | `board({ action: "add", title, paths })` — a call, because `add` takes a title rather than a card id |
| Say what kind of work it is | `type` on `add` or `edit`: `feature`, `bug`, `refactor`, `docs`, `test`, or `chore` |
| Flag a breaking change | `breaking: true` on `add` or `edit`; `false` clears it |
| Take a card | `board claim 4` — into `plan`, owned by this session, and only while the bus holds a live record of it; `board reclaim 4` takes one back — the lead from anyone, a peer only once that owner's record says it stopped. The claims it took stay with the session that took them: only that session's `session release` frees them, or its stopping, and a release inside `execute` waits only for the next turn, so `paths: []` and the lane are the exits that last |
| Record what it promises | `board contract 4 path <plan file> goal … acceptance … scopeOut … verify …` — all four lines, and the `verify` command is required |
| Approve the contract | `/board approve 4` in the lead's session, or the lead with the `board` action `approve` |
| Start the work | `board move 4 execute` |
| Block a card | `board move 4 blocked blocker decision blockedBy "waiting on the API owner"` |
| Set a card aside | `board shelve 4 note "waiting on the API owner" until 30d` — it stays in the pool, and `board unshelve 4`, or a claim, puts it back |
| Sign off finished work | `/board review 4` in the lead's session, then `board move 4 done`, and `/board next` starts the next session — once nothing of yours is in `plan` or `execute`; the page and its seat end with it, the record does not |
| Explain something | `board note 4 "why the retry is capped at three"` |
| Set finished work aside | `/board archive` in the lead's session, or the `board` action `archive` from any session |
| Read the round | `board list round: true`, or `/team` — owners, features, unassigned, shelved, unplanned, awaiting approval, awaiting review, untold, blocked, unwritten, done, and `, N archivable` when a sweep has something to take |

## Try it

```text
Put the billing webhook's order acceptance on the board, under src/billing.
```

The model calls `board({ action: "add", … })` and then, when you say so, `board({ action: "claim", card: "1" })`.
Those are tool actions, not commands: `Reference` lists every `/board` word and who may run one. The claim names
the next step, and `/board approve 1` refuses until the contract names a plan file in this repository's store.

A card is as tall as it draws: the line above its last one says what decides what happens next — a
dependency it waits on, one it has met, a gate it owes, or what a parked card waits on — and the row
prints that gate in one word, `untold` for a sign nobody heard, which a narrow terminal folds down.

A `round` read answers before the board: its collapsed line counts what needs a signature, the expanded block
names those cards by id above the board drawn once — each section counted, one past eight rows naming the rest.

## Reference

**Lanes.** `backlog` is the pool nobody holds, `plan` is where the card is designed and its
contract signed, `execute` is where the work happens, `blocked` waits on a person, and `done`
is closed. Each move follows the one transition from where the card is; no lane is skipped.

**The page.** A lane's width follows its work; five sit side by side (one below 1180px, via the picker) and a
lane of 24 folds. The pane is the one scroll box: a lane is as tall as the board, its head riding its edge. The
Team tab raises what needs the seat: one list of the moves only it can finish — sign a contract nobody read, send a notice that never landed, free a card whose owner is gone, chase one nobody has written to — each a two-line row that says its own reason, folded at five. Under it, `The board · N open` counts the four lanes it draws: `blocked`, `execute`, `plan`, and `backlog`, whose cards appear while the pool is small and become one line and a door past twelve. The terminal's rollup keeps its own counts (`9 unassigned · 5 unplanned`), because it answers what the board holds rather than what the seat owes — and its block's line carries the counts a card waits on somebody for, in the words that line prints. An owner's line counts the cards it holds — `mike (0 cards, 55 done)` — so `/team`'s `N of M sessions live` stays the only line in the round that speaks about liveness.

**Actions.** One tool, shaped by action: `list`, `add`, `claim`, `release`, `reclaim`, `move`, `note`, `contract`, `approve`,
`review`, `edit`, `shelve`, `unshelve`, `archive`, `drop`. `claim` and `move` are refused while a lane is full; `claim` is also refused while the bus
holds no live record of this session — the fact that decides whether the tool is offered at all — so it wrote nothing and names `/team join` or `/board`, while a run with no bus claims as it always has. `assign` is `team`'s verb under that rule, and one session holds one card in flight by default (`board.wip.perOwner`). `move` into `execute` or `done` re-reads the plan and refuses a
card whose plan is gone. An `execute` card claims the `paths` nobody else holds; `edit` claims added paths and releases removed
ones, claiming first so a conflict releases nothing. A contract names a `verify` command — the card's own suites, and then
the repository's gate, `bun run check`, [as the walkthrough writes one](../tutorials/first-board.md) — and `review` runs the module and suite size gates first, then the command, in the tree `root` names, refusing the sign when either gate is red; a tree that carries no commit past the base branch is refused before either gate starts, naming the tree and pointing at `root` for the card's worktree; a tree that keeps neither gate file skips them, and the sign records the skip so a reader can tell "they held" from "they were not there". The result then names the base branch when it has moved past that tree — `origin/main moved to 20fdf9c7: sync before the merge, or the sign names a tree the landing will not reproduce` — because the sign names a tree and the landing merges it into a base that may have moved since; it refuses nothing, since a lead may sign and land in one pass while the base is steady, which is the clean form.
`done` refuses a sign with no result or one older than the card's state, and resolves the landing: an older tree, a tip
declaring another card, or a squashed branch its subject names. A reviewed merge is its own landing
only while it is the tip; `done` records the merge, `landed: <sha>` names it, and `override` reads "by instruction".
A folded card names that merge in `landed`; the argument is checked at or below its spot-check, never above it. A close
the caller resolved no landing for at all is refused as unchecked, while a spot-check that named no commit closes
with nothing to prove.

**Commands.** `/board` serves or opens the page (add `team` for the Team tab; `serve.autoOpen` off prints the URL);
`/board next` starts a new session at a boundary; `/board approve <id>` and `review <id> [--root <tree>]` sign,
`archive` sweeps, `status` prints the seat, repository, port, and tabs, and `exit` ends the page and the seat together,
which costs the live round. A word refuses a flag it does not declare or a word it does not take, naming the ones it has.

**Who signs.** The lead is `team.lead` in `bytefly.json` (default `gavin`), and the page serves as that name; an
empty lead lets only the person sign and serves no page. A session signs only while it is the lead, never while
it holds the card, and the `/board` words gate on that label. The sign says who heard it — quiet, not listening,
or not told — and an untold one is sent again.

**Lead mode.** Serving the page is the seat: `/board` turns the mode on in that session and the bar draws `⚑ lead`. While it holds the seat keeps a closed
allow-list — the readers `read`, `grep`, `find`, `ls`, `read_doc`, `run_doctor`; the board's verbs (`board`, `team`, `session`, `plan`, `todo`, `goal`,
`question`, `subagent`); `web_search`, `web_fetch`, `bash` for read-only git — a retargeting `-C` or `cd` is refused with the by-revision forms to use instead (`git show <sha>:<path>`, `git log <branch>`) — and every other tool is refused by a sentence naming `/board exit`. A tool's
own `readOnlyHint` does not admit it, so an MCP reader is refused while the seat is held. `subagent` stays read-only, `plan` keeps `write` and `steps`
while `enter` refuses, and each turn carries one `[LEAD MODE]` line: the seat's unread mail, what is yours to sign, each parked card's decision,
the pool's three ids and a count, who is listening. A seated session lands a reviewed card with `board land`, which refuses anyone else, so the seat stays on. Its subject is derived, never supplied: the one extension its paths name, unless the paths naming another extension or an area other than `lib` outnumber it (a tie stays with the extension); then the title's `scope:` prefix; then the area of the first path that names one — any top-level directory but `extensions`, or a root documentation file, while `extensions/…`, `package.json` and `CHANGELOG.md` name none; then `board`. So a card whose paths name two extensions and whose title carries no scope lands `merge(board)`; the surface belongs in the title (`session-bus: …`), which lands as that scope. The merge that follows tells the holder it is theirs to close, naming the sha `done` resolves against. The bullet is the landing's too: the same subject's scope and title and the card's id, filed under the heading its `type` earns, so a branch never edits `CHANGELOG.md` — one that does is refused before the merge, and the landed tree is the signed one plus that line, a version cut's foot references being the one edit a branch may make. Its proof refuses a merge whose changelog is anything else; in `test/suite-manifest.ts` it refuses a declaration unless the merge no longer carries the suite it named — a suite's removal deletes its declaration, while a declaration whose suite survives is a rewritten record.

**Where it lives.** `~/.pi/agent/repos/<repo-id>/board/` — a card per file under `cards/`, with `archive/` and `ended/` beside it. The archive holds more than one record shape: a file written before the lanes says `status` and no `lane`, and the reader maps that word (`todo` → `backlog`, `doing` → `execute`, `done` and `blocked` as themselves), so nothing is rewritten. A card records its plan by the **name** it holds in this repository's plan store, not this host's path, so two machines sharing a store resolve it on either — and a card holding an older absolute path still executes. A shared store is compared on every write, so it converges rather than serializing — [two machines, one store](../multi-session.md#two-machines-one-store). A plan file is one card's: a `contract` naming a name another card records is refused, naming that card, because the file is what a sign covers and a re-plan elsewhere would rewrite it.

## Limits

- `done` is terminal: a card finished by mistake is dropped and re-added at a new number. Nothing prunes itself: `archive` takes a card nothing waits on, and `--older-than 30d` bounds it, naming what it kept.
- The lead is a name, not an authority: any session can join it, and a lead holding a card can release it, sign it and
  claim it again. A lead holding no card may still move it `plan` → `execute`, or close a signed card whose holder the
  bus lost — a close, not a signature; every other verb is the holder's. A gate is a reading.
- Settle title, paths and contract before the sign: a write after the spot-check stops it speaking, and a branch is proved against `main` as cut — the spot-check's own result says so when the base has moved, so the sync is a step the holder takes before asking for the sign rather than a merge and a re-sign after it. `board land` keeps three copies of its own rule apart — the process's, the checkout's disk, and the tree the spot-check signed. It refuses a process older than the disk, naming `lib/workflow/land.ts` and the reader `lib/workflow/suite-declarations.ts`: `/new`, `/board next` and `/reload` all keep a `lib/` module another extension already loaded, so a restart is what fixes it. And it refuses a signed tree that carries a different verb, naming the exact changelog line to commit — that commit is a new tip, so the same branch needs a second spot-check before it lands, and the restart is owed after rather than before.
- A contract's `verify` names the card's own suites, and then `bun run check` — the gate that proves the tree — because the spot-check
  runs the command and nothing else, so format, `tsc`, the size gates and the sweeps are otherwise a claim the holder ran by hand.
  A card that changes no code names `bun run check` alone, because it has no suite to lead with.
- The same failure appears when a card claims a sentence is tested: a green run that reddened nothing is not coverage, so the
  detail line's `waits on: #1` says nothing about the listing's `waits on #2, #3`, and a case that never failed is a rule nobody
  knows holds. Neither is a gate: a card lives outside this repository, so the sign is what reads them.
- Ownership is a session id, not a lock: a card in `execute` holds its `paths` as the bus's claims and as the tree's write boundary, and a lane change frees only the writer's. While the session's only card sits in `plan`, `blocked`, or the pool, `write`, `edit`, and every shell but a read-only git command are refused, naming `board move <id> execute` — or `board release <id>`, for work that is not the card's. The `paths` bound the two file tools, the shell is judged by lane and not by path, and a hint is a prefix for both readers: the gate refuses a write outside it, and the bus's claim covers what lies under it. So a card whose work grows widens them with `board edit <id> paths [...]` up to twelve, and past twelve names the directory its files share (`lib/workflow/`), one hint where five files would have been; the refusal names that door, which is how the file list keeps up with the work. A session holding no card writes as it always did, and a card a page moves mid-turn is read again by the next `board` call rather than by the write it interrupts. A card whose owner's record reads `gone` is pooled by the next start's sweep, whatever the card calls that owner: the sweep reads the id `holds` compares, never the name, so nothing on the board is re-owned by a name — a pruned record waits for a person, because no record is not a session that stopped. A sweep also keeps the spot-check it finds: holding the seat is not withdrawing a judgement, so only the signer's own reclaim takes a sign back.
- Plan mode is a card's own step, so the model's `plan` `enter` is refused while this session holds no
  card, naming `claim` (`board add` opens one) so the plan has a card to record it against; a session on
  a bus is offered `/team exit` beside it, and one the board's tool is withheld from is not gated at all.
  The person's `/plan` and Shift+Tab raise no tool call, so they stay their own doors.
- The two tools that run what they are told are judged by their action, the way the shell is judged by its
  grammar: `job start`/`send` and `watch add` need the card in `execute`, while `job list`/`status`/`logs`/`wait`
  and `watch list`/`status`/`matches`/`logs` are reads. `kill`, `stop` and `clear` are allowed in any lane too,
  because they clean up a process the card does not own and write no tree.
- The `board` tool is also the seat's signing surface, so it goes with the team: `/team exit` refuses while the seat is served, and a record that goes without a leave takes the tool at the next turn — and that turn's seat line carries the door with it, so losing the tool is a fact with a way back rather than a silence.
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
