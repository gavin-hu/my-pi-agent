# board — one shared feature board per repository

Every Pi session on a repository works the same cards through the tools, and a repository
has **one** page that shows them: the session that starts it serves it under the seat —
the board's lead, `board.lead`, `lead` by default — and every other session opens that same
page instead of a second one. The
page is a **view** — it cannot change a card — so what a browser shows and what the
terminal holds cannot disagree. A card is one **feature**: its outcome, who holds it,
where the work happens, the contract it promises, the plan it is executed against, how
urgent it is, what it waits for, and the notes that explain how it got there.

A card moves through **five lanes**, and the flow is a pull one: `backlog` is the pool
nobody holds, `plan` is where the plan is designed and the contract written and signed,
`execute` is where the work happens, `blocked` is a card waiting on a person, and `done` is
closed. The order is the board's, and each call can only follow the one before it:

```
board claim 4            the card is yours, in plan
/plan (plan mode on)     design it, plan write saves the artifact
plan exit                the user approves the plan
board contract 4 path …  goal, acceptance, scopeOut, and that file — it must exist
board approve 4          or /board approve 4 as the person; the holder may never sign
board move 4 execute     the plan is re-checked, then the work starts
board review 4           or /board review 4, before it can be called done
board move 4 done
```

Two gates are humans'. A card cannot enter `execute` until **the lead** — `board.lead` in
`bytefly.json`, `lead` by default — has approved the contract, and cannot be
finished until the lead has spot-checked the work. The lead is a team name, so it signs as a session that
joined under it, and never while holding the card: a lead releases a card before signing it.
The person at the keyboard is the other way in — `/board approve` and `/board review` write
as `you` — which is what makes a one-session flow possible, and the reason a repository
nobody configured can still finish work. A
card cannot skip the artifact either: `contract` requires the plan file `plan` action `write`
returned, inside this repository's plan store, and a move to `execute` or `done` re-checks
that the file is still there. `plan` and `execute` are held to a WIP limit, so the board
says "make room" instead of quietly accumulating work nobody is reviewing.

The steps of the work are deliberately *not* on the board. They live in the
owner's plan and in `todo`; the board answers who is holding what, and what needs a
decision.

The board is **opt-in**. Its tool, its command, and its page belong to a workflow a
session either runs or does not, so nothing is registered until the session asks for
it:

```bash
PI_ENABLED_EXTENSIONS=board pi
```

`team` — the lead's half of the same workflow, and the only extension that can hand a
card to a peer — is opt-in beside it, so a lead names both:
`PI_ENABLED_EXTENSIONS=board,team`. They stay independent: one name never loads the
other.

The extension is still declared in the package manifest, so Pi discovers it and
documents its surface with the rest; the gate is the variable, in `lib/env.ts` beside
`PI_DISABLED_EXTENSIONS`, which still wins when it names `board`. `doctor` reports the
row as an opt-in extension and names the switch.

<img src="../../assets/screens/board.png" alt="The board page: a toolbar with the repository's name and a live badge, Board and Team tabs, done-of-total progress, a filter, the keys button and a theme toggle; five lane trays, each with a dot, a count and a fold control; and cards carrying an owner chip, a note count and its age, path hints, and a reason line naming what the card waits for and what it holds up, with no button on any of them" width="100%">

*`/board`: the five lanes, with the round one tab away and every card opened by its title.*

<img src="../../assets/screens/card-dialog.png" alt="The card dialog on one executing card: the id and title, the owner as a chip, the lane as a dot, a word and its age, then three labelled sections — contract, holding the goal, acceptance, scope out and the approval; to start, holding the plan file and the path hints; and record, holding when and who last touched it — above a Notes section whose newest sentence comes first, each attributed under it" width="100%">

*The card dialog: the record of one card — the head it shares with the card face, the
sections a reader acts on, then its notes newest first (`screenshot:board --dialog card`).*

## Capabilities

| Capability | How | What you get |
|---|---|---|
| A shared feature list for one repository | `board` action `list` | Every open card in lane order — `backlog`, `plan`, `execute`, `blocked` — or one card, or one lane; the `done` cards are left out with a count of how many, and `lane: "done"` reads them |
| The lead's rollup | `board` action `list` with `round: true` | Every owner with its live cards and, beside the count, what it has finished — an owner whose last card is done stays listed, and the owners a bus has no record of and that hold nothing are one line, `18 owners with no record · 76 done` — then unassigned (the pool), unplanned (a contract still missing a line, or a plan never recorded — either one refuses `execute`), awaiting approval, awaiting review (every card in `execute` until the lead has spot-checked it, so the second gate is detected from the moment the lane is entered rather than after a card has sat untouched for half an hour), blocked, idle, and done |
| Publish a feature | `board` action `add` | A `backlog` card with path hints and a first note (one line, at most 1000 characters) |
| Take a feature | `board` action `claim` | The card is pulled into `plan` and owned by this session — or refused, naming the count, when `plan` is full. The result names the next step, because the claim is what commits the session to a plan |
| Hand it back | `board` action `release` | The card is back in `backlog` with no owner; the contract and its approval stay, because the plan did not change |
| Write the contract | `board` action `contract` | The plan file and the three lines the card promises — `goal`, `acceptance`, `scopeOut` — written in one call; `path` is required, and it must be the plan `plan` action `write` saved in this repository's plan store, so a contract cannot name a file that does not exist. Any change to a line or to the file drops the approval, because the sign named both |
| Approve the contract | `board` action `approve`, or `/board approve <id>` | The lead records that the wording is right — a session that joined under `board.lead`, and never the holder — or the person at the keyboard signs; only then may the card enter `execute`. `text` adds a note, recorded with the sign, because a signer is exactly the session `note` refuses on a held card. The card's owner is sent the sign over the bus, so the session that can make the next move is told rather than left to poll |
| Spot-check the work | `board` action `review`, or `/board review <id>` | The lead records that they looked at the finished work in `execute` — never the holder — or the person does; only then may the card be finished. `text` adds a note, recorded with the sign, so "checked, and this is still wrong" is one call. The owner is told the same way, with `done` named |
| Change lane | `board` action `move` | Wherever the board allows from where the card is: `plan` to `execute` (no unfinished dependency, a complete contract, a plan that is still in the store, an approval by somebody other than the holder) or `blocked`, `execute` to `plan` (re-plan), `blocked`, or `done` (no unfinished dependency, spot-checked, the same plan check), `blocked` back to `plan` when that lane has room, or to `execute` once its contract is approved and its plan is there |
| Record what happened | `board` action `note` | A note appended to the card's history, attributed and stamped — one line, at most 1000 characters; its holder writes it, or anyone while nobody holds the card, the way `edit` works |
| Fix what a card says | `board` action `edit` | A new title, path hints, priority, or the cards it waits for — by its holder, or by anyone while nobody holds it |
| Say how urgent it is | `board` action `add` or `edit` with `priority` | `high` sorts first inside its lane, and the card says so |
| Record what a card waits for | `board` action `edit` with `dependsOn` | An unfinished dependency refuses a claim and a move to `execute` or `done`, and the reason line names it; the card it waits on answers the other half — `list` on it names the cards waiting on it, and its dialog row `waited on by` says the same |
| Hand a card to a teammate | `team` action `assign` | The owner is recorded **and** a handoff is sent to that session's inbox; a pool card comes with `plan`, and a card somebody already holds is refused — `reclaim` it, then assign. The page cannot do this: a browser has no way to message a peer, so a page assignment that recorded an owner and told nobody is gone with the write path |
| Take a card back from the tool | `board` action `reclaim` | The owner clears and the card returns to `backlog`, without the page and without `team` |
| Find a card without reading every lane | `board` action `list` with `query` | The cards whose title, holder, path hint, plan, or note text matches — the same rule the page's filter uses, from one body (`MATCHES_QUERY_JS`) |
| See the work you hold | `board` action `list` with `mine` | The cards this session holds, by the same rule a claim is checked against |
| Set a finished card aside | `board` action `archive` | A `done` card's file moves into an `archive/` pile beside the board with its notes, plan, contract, owner, and landed commit still readable, and the board stops reading it: the card named by `card`, or every finished card when none is named. A card that already names it keeps that link — it is inert, because a finished dependency stops blocking — though a new link has to name a card on the board. It is a decision a person makes, never a threshold in the background, and nothing un-archives |
| Delete a card | `board` action `drop` | The card and its notes are gone, and its id is spent: a record of the title, the lane, who ended it, and when stays in `ended/`, so a note or a handoff that names that id cannot come to mean a different feature. A `backlog` or `done` card is anyone's to drop, an archived one included, one in `plan`, `execute`, or `blocked` only its holder's, and one that a card waits on cannot leave at all |
| One page per repository | `/board` | Serves a loopback page as the board's lead with a **Board** and a **Team** tab, following the store live; a page already served is opened instead |
| Watch somebody else's page | `/board` on a session that is not serving | The same page, because there is one: every page is a read view, so a second session gets exactly what the first one sees instead of a writable rival. It joins the team under its own name, so a handoff can still reach it |
| Read a board at its real size | the `Done` fold, an empty lane's rail, the Team tab's own folds | `Done` starts folded at six cards or more, its count in the head, and a reader's toggle decides from then on. A lane holding no cards narrows to its head, word, and count, and a lane of finished cards stops widening at three, so the lanes carrying work keep the width. On the Team tab the queue and the roster share one cap, so both stay on one screen, and the ids past the strip's sixth fold behind its count |
| Open a card | the card, or `Enter` on a focused one | The whole card is the door — its title stays the focusable button — and it opens the dialog holding the card whole: its lane, its owner, its paths, what it waits for, its plan, and every note. A drag across a card's prose selects it instead of opening it |
| See the lead's round at a glance | `/board team`, or `/team` with no browser | A queue of cards that need a decision, each with the reason and its way out, then who is on the team and what they hold |
| Join the team | `/board`, or the first card you claim | Opening the page joins this session to the team — as the lead's name when it serves the page, under the name it already holds when it opens one somebody else serves — and so does the first card it claims, so nothing has to be armed by hand. Joining never renames Pi's session: the footer keeps the name you gave it, and a `/team join` name is kept rather than replaced by the id-derived one. `/board status` reports the team this session is on, whichever door it used |
| See who is around | `/board team` | The Teammates list: every session this repository's bus has recorded, plus every owner a card names, each stating `live`, `quiet`, `no record`, or `—` when no bus is loaded. An owner the bus has no record of and that holds nothing is one row stating how many there are and what they finished, unfolded by a click — the list only grows, because a label that ever claimed a card stays an owner — while one that still holds a card keeps its own row |

## Quickstart

```
you:  publish two features for the billing work
      → board add "Billing webhook accepts orders" paths ["src/billing"]
      → board add "Retry branches merge cleanly"
lead: board edit 2 dependsOn ["1"] priority "high"
      → #2 waits on #1 (backlog), and sorts first in Backlog
peer: pull the first, design it, then write down what it promises
      → board claim 1
      → next: design it in plan mode, `plan` action `write`, then `contract` with the path it returned
      → /plan … plan write … plan exit   (the user reads the plan and approves it)
      → board contract 1 path <the file `plan` action `write` returned> goal … acceptance … scopeOut …
      → board move 1 execute  — refused: the contract is not approved yet
lead: board approve 1                       (/team join lead first; else /board approve 1)
      → tells #1's owner over the bus: an event naming the lead and the lane `execute`
peer: board move 1 execute → board note 1 …
lead: board review 1                        (or the person: /board review 1)
      → tells #1's owner again: `done` is open
peer: board move 1 done
      → board claim 2 — refused while #1 is unfinished, allowed once it is done
lead: board list round: true
      → 1 owner · 2 features · 0 unassigned · 0 unplanned · 0 awaiting approval · 1 awaiting review
```

## Commands

| Command | Who | Effect |
|---|---|---|
| `/board` | the lead | Serves the page as the board's lead (`board.lead`, `lead` by default), or opens the one another session already serves — and opens it again when it is already up, so a closed tab is one command away. The line it prints names the repository and the address |
| `/board team` | lead | The same, opened on the Team tab |
| `/board approve <id>` | the person | Signs the card's contract as `you`, the other actor the gate takes: a session must be the lead (`board.lead`), and the holder may sign nothing at all. Only a card in `plan` with a complete contract can be signed, and the refusal is the tool's own sentence |
| `/board review <id>` | the person | Records the spot-check of finished work as `you`; only a card in `execute` can be signed |
| `/board status` | both | One line: the seat, the repository, the port, how many tabs are watching, the store's path, and the team the last `/board` joined — or the page being watched, and whether the note behind it still answers |
| `/board stop` | lead | Stops the page this session serves; a watched page that has stopped answering is dropped instead, and a watched page that is alive is its owner's to stop |
| `/team` | both | The round in the terminal: the rollup, the work a dead owner left behind, then who is live, who has gone quiet, and who is gone |

**Who serves the page.** The first `/board` in a repository serves it; after that the
page is found by the note it leaves beside the cards (`page.json`, in the board's own
directory), so a second session opens the same page rather than a rival one. That holds
while a page answers; if nobody is serving, the next `/board` serves — the seat's name
does not change, so a card a browser claimed is still the seat's. A note a session left
behind when it died is not a dead end either: `/board` says which page it named — with its
URL — takes the note over, and serves. A clean exit is not that case: `/board stop` and a
session shut down normally both take their note with them, so the note that survives is
one a crash left. `/board status` probes the note it is watching, and names one that
answers nobody; `/board stop` then drops it (a token-safe clear, so a page that came back
keeps its own note) instead of waiting for the next `/board` to trip over it.

**Who signs.** The two gates take the lead's signature and nothing else: `approve` and
`review` accept a session only while its team name is `board.lead`, and never while that
session holds the card — a lead releases a card before signing it, so the gate is never its
own. **The page serves as `board.lead`** (`lead` by default), so the session that opens
`/board` takes that name and can sign — the shipped board has a signer without being
configured. A repository that wants its own name sets `{"board": {"lead": "gavin"}}`, and the
page, the roster, and the gate follow it. It is a label check and nothing more, which is the
half of "somebody read this" a file can hold. What the bus adds is that the name cannot be
taken while it still has a record: a label is held against every record the bus keeps, not
only a live one, so a lead whose process crashed keeps `board.lead` until its heartbeat ages
out and a read prunes the record — a peer cannot join first and sign for a peer. Past that
ten minutes the name is free again, and nothing behind it is an identity: the signer is
whoever holds the name.

**The person's door.** A repository worked by one session would otherwise never get a card
past `plan` or `execute`, so `/board approve` and `/board review` write the same two signs as
`you` — a label, with no session id — whatever the lead is called and whether or not the
session typing it holds the card. The card says who signed, and the two read differently
because they are different: `you` is the person who read the plan, the lead is a second pair
of eyes.

**The sign tells the other side.** `approve` and `review` write the card and then send it to
the card's owner: an event in that session's inbox naming the signer and the lane the sign
opened, which is the same `session send` a handoff is — it waits, and starts no turn. A
repeated sign writes nothing, so it sends nothing, and a bus that cannot answer costs a line
on the result (`told api-core`, or `api-core was not told (…)`) and never the signature,
which is already on the card. The way to ask travels the same channel: the refusal for either
gate names ``ask <lead> with `session send` ``, from the one phrase in `lib/board/lead.ts` that
`team`'s handoff prints too. `/board approve` is the exception on purpose — a command context
has no way to reach a peer, so the person's sign is the one that tells nobody, and the owner
reads it on its next `list`.

**Joining.** One thing, done for you: `/board` puts this session on the team — as
the lead's name when it serves the page, under its own name when it watches one — and so does
the first card it claims. A read, a new card, a note, a plan, or an edit enlists nobody: a
teammate is a session that holds work. The join is also the listening: mail is reported at
that session's next turn, and no turn is raised, so being on the team never spends a turn.
A session that has neither opened the board nor claimed a card is not on it.

**The two names.** A session's team name is the seat — the board's lead — while it serves the
page, which is also what makes it the lead unless `board.lead` names someone else; otherwise
it is the name the session already holds: `/team join billing-core` names
it, and the cards it claims, the notes it writes, and the join a claim makes all say
`billing-core` rather than a name derived past it. A session the bus has no record of
takes a preset teammate name — `tom`, `lily`, `ben` — drawn from its id and walked past the
names live teammates hold, so `billing-core` before it names itself is `lily` to the team;
once every preset name is held it is `team-agent-` plus the last six characters of its id
(`team-agent-9f21ac`). Until it joins, that name is only a draw: a live peer that takes it
moves the session on to the next free one, and a card written before then keeps the name it
was written with. The name is never Pi's session name, which means a rename cannot strand a
card and the bus will not let two live sessions settle on one name, while nothing here ever
renames your session: `/team join <label>` is the one door that does. Ownership is the id,
so a name that changes leaves the card where it was. A card records the name as its owner,
so the chip, the roster, and the bus record are one word — and `/board status` says it
whichever door put this session on the team, including a claim made with no page open.

The page still serves as a seat: `/board status` names the lead, the Team tab marks that
row `you`, and a card a browser claimed **before** the page stopped writing still names
`board:<lead>` as its owner — `reclaim` is how a lead takes that back from the terminal. The toolbar does not print the seat: a board's subject is its repository, so the
name there is the project's, and the seat is read off the roster where it belongs.

## Tool

`board` is one action-shaped tool. `readOnlyHint: false`, `destructiveHint: true`,
`openWorldHint: false`, `executionMode: "sequential"`.

| Action | Parameters | Result |
|---|---|---|
| `list` | `lane?`, `mine?`, `card?`, `query?`, `round?`, `archived?` | the cards in lane order, one card, or what a query or `mine` matches — a query reads a card's title, holder, path hints, plan, and the text of its notes; a listing that names no lane leaves out the `done` cards and says how many, since a finished card is history rather than work; `round: true` adds the rollup, which always covers the whole board; `archived: true` reads the archive instead of the board, with `query` and `mine` narrowing it and `lane`/`round` refused |
| `add` | `title`, `paths?`, `priority?`, `note?` | the new `backlog` card |
| `claim` | `card` | the card, pulled into `plan` and owned by this session — refused, naming the count, when `plan` is at its limit (the limit counts the whole board, not one session's cards); the result ends with the next step, which is plan mode. `team`'s `claim` writes the same operation for a lead taking work from its round |
| `release` | `card` | the card, back in `backlog` with no owner; the contract and its approval stay |
| `reclaim` | `card` | the card, back in `backlog`, whoever held it |
| `move` | `card`, `lane`, `blockedBy?`, `blocker?` | the card in its new lane, through the one transition the board allows from where it is; `blocker` (`contract`, `dependency`, or `decision`) is required for `blocked` and is recorded with `blockedBy` (one line, ≤200 characters) as the card's one `blocked` record — sent with any other lane it is refused, and it cannot change while the card is parked, because a reason is what the card was parked on; a re-plan from `execute` or a resume from `blocked` is an entry into `plan` and so is held to that lane's limit. A move to `execute` or `done` re-checks the plan the card recorded — a deleted file, or one outside the store, is refused with `contract` as the way out — and a move to `done` records the commit `HEAD` resolved to, when the directory is a repository |
| `note` | `card`, `text` | the card with the note appended |
| `contract` | `card`, `path`, `goal?`, `acceptance?`, `scopeOut?` | the card with its plan file and its contract recorded, and any approval dropped: a changed line is an unapproved one. `path` is required and must resolve inside this repository's plan store (a bare name is read there, `~/…` is accepted) and exist; a path outside it is refused with the store named |
| `approve` | `card`, `text?` | the card with its contract approved, by the lead and not by its holder — the gate in front of `execute` (see **Who signs**); `text` is a note recorded in the same write. The person signs the same gate with `/board approve <id>` |
| `review` | `card`, `text?` | the card with a spot-check recorded, by the lead and not by its holder — the gate in front of `done`; `text` is a note recorded in the same write. The person signs with `/board review <id>` |
| `edit` | `card`, `title?`, `paths?`, `priority?`, `dependsOn?` | the card with what it says corrected; an omitted field is left alone, and `dependsOn: []` removes every link |
| `archive` | `card?` | the ids set aside — one finished card, or every finished card when no card is named; a card still in flight is refused |
| `drop` | `card` | the id that was dropped, whose number is now spent |

`card` takes `4` or `#4`. A refused call is an error result that still carries the
card, so the next attempt starts from the truth. A `list` that names a card refuses the
fields that only narrow a listing — `lane`, `query`, `mine`, and `round` — because its
answer is that one card; `archived` is kept, because it decides which pile the card is
read from.

The parameters are one flat object, so a field is published to every action at once.
An action reads only the fields in its row above, and a call carrying one that its
action does not read is **refused**, naming the action that takes it — not ignored.
`add` with `dependsOn` used to create the card and drop the link, so a caller could
not tell a recorded link from an ignored one:

```
add does not act on dependsOn: `edit` takes it.
```

To link a new card, add it and then edit it. `ACTION_FIELDS` in `types.ts` is the
table that answers this, and a test holds every published parameter to an action that
acts on it.

## Routes

Every route but two needs the token, and there is exactly one: 128 random bits minted
when the page starts, compared in constant time, in the URL the browser was opened at.
The two that do not are the page's own furniture — `/theme.js` and `/app.js` are the same
bytes to every reader and can neither read nor change a card, so refusing them to a fetch
that has no token would only break the page. Everything below a
token is a **read**: the method list is `GET` and `HEAD`, so a `POST` or a `DELETE` is
refused by the envelope — `405`, `Allow: GET, HEAD` — before the token is even read.

The tab's icon is not a route: the document head links the mark as an SVG data URI, so
a browser fetches the icon out of the page it already has, and `/favicon.ico` is one more
path the board does not serve.

```
GET    /theme.js             the theme script — no token
GET    /app.js               the client script — no token
GET    /                     the document (?view=board|team), whose tab reads
                             board · <repo> · <N> open
GET    /index.html           the same document, for a link that names it
GET    /api/ping             whether the page answers, and nothing else: a session
                             deciding whether to attach reads this, not the snapshot
GET    /api/board            the snapshot
GET    /events               the live frame stream
```

`/api/ping` exists so a probe cannot be queued behind the page's own work: the snapshot
is a store read and a roster read on the same event loop, and a page that is busy
answering its browser would otherwise be declared dead and taken over.

## Layout

One page, two tabs, one lifecycle. The kit shell keeps the toolbar and the footer
pinned and makes the main pane the only scroll box; the page adds no second one. The
toolbar leads with the repository the page is a board of, as a quiet chip named the way the
directory holding it is, with the root's whole path on its hover — the name fits the line,
and the path is what tells two clones of one repository apart. That name arrives in the
document, so a slow frame does not leave the toolbar unnamed. The tab carries the same name
for the same reason: a store key is a hash, and no reader can say it out loud. The footer
is the board's own account: the store's path, the count of cards, and the size they occupy
— plus how many card files this build could not read, named with the store's own reason on
the hover (`0099.json (not a card record)`), so a board that is not readable never reads as
a board that is empty.

| Band | What it holds |
|---|---|
| Toolbar | the mark, the repository's name as a quiet chip with the root's whole path on hover, a live badge (`connecting…`, `live` or `live · 3m`, `reconnecting…`), then one group: the Board\|Team switch, done-of-total progress (from three cards up, and only above 1180px), a filter, the keys button, and the theme toggle |
| Lanes | trays, not a bare list: one column per lane, sized by the work it holds — a lane with two cards is wider than one with a single card, and one holding no cards, or folded, narrows to a rail of dot, word, and count — except `done`, which draws as if it held three cards however much history it has, because the lanes still being worked are the ones a reader is working in. One row of five above 1180px, two per row at 1180px or narrower, one lane plus the lane switch at 860px or narrower — where it opens on the first lane that holds a card, and the switch is a group of pressed buttons rather than a second set of tabs, because there is no tabpanel behind it. A filter that matches nothing replaces the lanes with one sentence — `No card matches “x”` — and a `Clear filter` button, so five trays of `no match` never read as a board with no work. Each head sticks to the pane's own top edge while the pane scrolls, carries its count as a pill — `2/3` on `Plan` and `1/5` on `Execute`, the limit and the count in one fact — names itself from the same numbers for a screen reader (`Plan, 1 of 3`, `Backlog, 2 cards`, `Backlog, 1 of 2` under a filter), and folds its cards away: `Done` starts folded at six cards or more, since finished work is history, and a reader's toggle decides from then on |
| Cards | the id in the lane's own colour and a two-line title (the page's loudest text, and the focusable half of its door: the whole card opens it), an owner pill and an age whose hover says which fact it is (`updated 2d ago`), a priority word beside the owner when it is not `normal`, so a person and an urgency are two shapes rather than two pills, `2 notes` when it carries any history — the count, with the last note's age beside it only when that age reads differently from the card's own updated stamp, since a note is itself a write and the same moment printed twice is two bare numbers nobody can tell apart, and a card with ten notes and one with none used to draw the same face — path hints in the mono face, and one reason line in one voice, from `lib/board/reason.ts`: what a card waits for, named by title as well as id (`waits on #31 (execute) The page's roster key…`), a blocked card's recorded reason or else its last note (or `blocked, with nothing recorded`), `no contract yet — missing …`, `contract ready — needs approval`, `contract approved by <who>`, `executing — no spot-check yet`, `spot-checked by <who>`, `offered 2h ago — nobody took it`, and `✓ done by <owner>` with the commit it landed as — up to two lines at the Team tab's size, with the whole sentence as its tooltip, because the reason is the reason to act on the card. A card holding others up says so on that same line, after a middot — `executing — no spot-check yet · holds up #79 (backlog) The page's roster key…` — because it is the same edge read from the other end, and a second paragraph spent a row on it. A title and a path hint elide **inside** the card: a chip is one line by design, so a path or a label longer than the card is clipped rather than crossing into the lane beside it, and its whole value is the hover title. The hints past the third are counted by a `+N` chip whose hover lists them one per line, and which are in the list again as text a screen reader reads. What a card cannot show — the reason, the holds-up line, the hints behind a `+N` chip — is named by the title button's `aria-describedby`, so the keyboard that reaches the card by `j`/`k` reads the same sentences a pointer gets on hover. A card draws **no button**: claiming, moving, editing, and annotating are the tools' work, and a face that offered them would be offering a refusal. A hovered card only strengthens its edge, because the page cannot move a card and a card that rises reads as one you can pick up; a finished one recedes, title and owner chip muted; the card the reader is on wears an accent edge and the ones they have opened keep a quiet one, so walking a lane and coming back does not look like arriving for the first time |
| Team | two panels and a strip. **Needs a decision** is one row per card — a card that is both idle and unreviewed arrives once, keeping its strongest reason — laid out as two lines: the id, title and owner chip on the first, the reason on the second — a blocked card's recorded `blockedBy`, else its last note, and `offered 2h ago — nobody took it` for a card whose offer went unanswered — with the whole sentence as its tooltip, and its kind as a left edge, in the tone `lib/board/tone.ts` gives that kind (`--danger` blocked, and `gone` — an owner whose process is not running, ranked above a card merely sitting still; `--warn` approval, review, and idle; `--dim` unplanned or waiting, the same `--dim` dashed for nobody's). A card in `execute` is a row from the minute it enters the lane — the whole lane, work in flight included, because the board cannot tell finished work from work in progress and the spot-check `done` requires is owed either way: the queue is read off the cards, not off a timer. The tone is read from one table, so the row's rank and its colour cannot disagree, and a danger row is the only one whose reason sentence is coloured with its edge. The row is a reason to pick the card up in the terminal, and it draws no button: claiming and reclaiming are the tools' work. An unassigned card that waits on unfinished work is a row of its own kind, ranked just under a blocker. Above 1180px the queue stops at one screen's height and scrolls inside its panel, so the roster and the Done strip stay on the same page as its top. **Teammates** is one row per person — a state dot, the label, a `you` chip, a `not listening` chip on a live peer whose inbox watch is off, a mail badge, then `live · 3 held · 1 done · oldest 21m` (a quiet session reads `quiet for 2h`, because a word without an age is no reason to reclaim) — sorted you, live, quiet, no record, and an owner whose label nothing answers to keeps its row. Done is one quiet strip whose ids open their cards. Both panels honour the toolbar's filter, and their headings read `shown/total` the way a lane head does. Below 1180px the queue comes first and the roster follows |
| Card dialog | the record of one card, in the order a reader acts on it. The head carries the id and the title, who holds it as the same neutral chip the card face wears, its priority as a word when it is not `normal`, and the lane as a dot and a word with the age that says how long the card has held it — read from the card's transitions rather than from `updatedAt`, which a note or an edit moves, and left out for a card whose history does not say. **Contract** is what the card is judged against — goal, acceptance, scope out — and `approved`, who signed that wording and when. **To start** is the plan file on one line that elides with the whole path on the hover title, and the path hints as mono chips. **Links** says what the card waits for and what leaving it undone holds up, `#2 (execute) <title>` — the lane that makes the id a decision and the card it names. **Record** is `updated` as one rung carrying both halves — `7m by billing-core`, one moment rather than two rows — then the commit a finished card landed as and who spot-checked it. A row with nothing to say takes its label with it, and a section whose every row is empty takes its heading with it, so a card still in the pool opens on its links and its notes rather than on four empty tables. **Notes · N** is the cargo at body size on a 68ch measure, newest first, because the note somebody just filed is usually why the card was opened, each sentence with its attribution under it and a rule between notes; a note's prose is inline Markdown read by the kit's one renderer — `code`, **bold**, *italic*, and a link to an `http`, `https`, or `mailto` target become atoms, and any other target stays the text it was, so a note can never become markup — `M earlier notes dropped` sits at the end of the list where the dropped ones would have been, and a card with none says `no notes yet` in one line instead of drawing an empty list. The body is the only scroll, so the head and `Close` stay put. Nothing in it writes, every field is a set as `textContent` — a note's prose is the page's one exception, handed to the kit's inline renderer, which appends text and four atoms and never parses markup — and the card underneath every title is the way in. `j`/`k` walk to the next or previous card without closing it, and an `sr-only` live region announces `card 2 of 3: <title>` — a title that changes inside an open modal is not announced on its own |
Colour is a role, one per lane, read from `LANE_RULES`: `--muted` for `backlog`,
`--warn` for `plan`, `--accent` for `execute`, `--danger` for `blocked` and destructive
choices, `--success` for `done`. The Team tab's decision
rows sit on the kit's `--raised`, the one step above `--surface` that lets a block read
as a plane instead of an outline; every lane, `Done` included, keeps that `--surface`
tray, so a finished card still sits on something and history recedes through its muted
title and chip instead of through a hole in the row. A card takes its lane's colour on the head's
dot and the dialog's state, and its reason line takes the tone of the reason's kind — `--danger`
for a block, `--warn` for a contract, an approval, or a spot-check somebody still owes, `--muted`
for what is merely true of the card. The rule behind those words: **warn is a person who must act
next, danger is a refusal or a loss, and anything else is quiet**. One table in
`lib/board/tone.ts` answers for all of it, and the terminal reads the same table through
`extensions/board/tone.ts`, so a lane is one colour on both surfaces. The page states a lane with
`data-lane` and a decision row's tone with `data-tone`, so a theme change repaints either without
a rule of its own.

The board as a posting card — the same rules, drawn to be read at half width:

<img src="../../assets/cards/board.png" alt="One board, every session: the page's repository name and live badge; five lane trays — Backlog, Plan, Execute, Blocked, Done — each with a dot, a count pill and a fold; one card carrying an id, a title, an owner chip, a priority chip, its age, a path chip and one reason line, with no action on it; and the lead's round with two owner lines — each dot in the colour of the state it reports, success for live and warn for quiet — and the counts unassigned, unplanned, awaiting approval, awaiting review, blocked, idle and done" width="100%">

*`board`: the lanes, one card's atoms, and the lead's round — three readings of one board, drawn by `screenshot:cards board`.*

<img src="../../assets/cards/board-team.png" alt="The three team verbs as three bands: assign sends a handoff to a named peer and writes the card into plan, owned by that peer, before the peer reads the mail; offer broadcasts an event to every other live session without recording an owner, so the first claim wins; reclaim returns the card to Backlog with its notes kept and no handoff sent" width="100%">

*`board-team`: `assign`, `offer`, and `reclaim` — the two that reach the bus, and the one that writes the card alone (`screenshot:cards team`).*

<img src="../../assets/cards/board-parallel.png" alt="Two lanes of three rows each. In the plan lane, #4 billing-core, #5 api-core, and #6 web-core each carry a contract node reading contract, 契约, and plan file, side by side, with goal, acceptance, and scope out named under them; every row crosses one vertical approve line, a signature only the lead may give and never while holding the card. In the execute lane the same three run at once under their owners, each row crossing a vertical review spot-check line into done. Each lane's floor states its count — 3/3 contracts, 3/5 owners executing — and the round beneath counts 0 unplanned, 1 awaiting approval, and 2 done; the foot says execute opens only on the lead's approval and that assign and offer hand a card over without starting a turn" width="100%">

*`board-parallel`: plan three at once, then execute three at once — `approve` is the lead's signature on the contract, `review` the lead's look before `done`, and both are lines every row crosses (`screenshot:cards parallel`).*

## Keys

| Key | What it does |
|---|---|
| `/` | Filter the cards by title, holder, path hint, plan, or the text of a note |
| `j` / `k` | Next or previous card — or, with a card open, the next or previous card in the dialog |
| `Enter` | Open the focused card |
| `t` | Switch Board and Team |
| `Esc` | Close a dialog, or clear the filter |
| `?` | The keyboard sheet |

A dialog traps `Tab` in both directions, closes on `Esc` or a backdrop click, and returns
focus to whatever opened it — the kit's `dialogScript`, shared with the review and browse
pages. A field keeps its keys: `/` inside the filter box types a slash. A card dialog keeps
the page's keys too: `/`, `t`, and `?` do nothing while it is open, and `j`, `k`, `Enter`,
and `Esc` are the ones still read at it — the sheet says so in a line under its table. A
kit dialog whose focusable elements are two or more cycles between them; one with a single
button stays on that button.

## Security

- The page binds loopback only, answers only its own host names, and has no
  state-changing request to refuse.
- One credential, 128 random bits minted when the page starts and compared in constant
  time, in the URL and never a cookie, with no CORS. The note beside the cards
  (`page.json`, owner-only) carries it, so a second session can attach — and because the
  page cannot change a card, pasting that URL hands out nothing but a view.
- The page reads only: the board store under the agent directory, and the session bus's
  own records read-only — labels, modes, heartbeats, message counts, and whether each is
  listening — to draw the Teammates list. It never writes your repository.

## Limitations

- **Ownership is advisory.** Two sessions can still edit the same file; only
  `session-bus`'s path claims are a lock.
- **A listing is bounded, the rollup is not.** Nothing prunes a finished card by itself, so
  the cards accumulate — most of this repository's own board was finished cards — and
  reading them on every call is a cost that grows with the history rather than with the
  work. A `list` that names no lane therefore leaves `done` out and prints the count, which
  is what keeps the omission from reading as a smaller board; `lane: "done"` reads them,
  and `round` counts every card, because a rollup that hid half the board would not be one.
  The page bounds its own View the same way, folding a long `done` lane. `archive` is how a
  board stops paying for its history at all: the card leaves the board and its read.
- **A card planned before the plan was required must record one.** `contract` now demands
  the file `plan` action `write` saved, and a move to `execute` or `done` re-checks it, so a card
  whose contract names a path outside this repository's plan store — or no plan at all —
  cannot move until its owner calls `contract` again with a real one. That is the fix, not a
  migration: the refusal names `contract`, the plan tool is where the file comes from, and
  nothing is rewritten behind a read. A card already in `execute` is held to the same check
  on its way to `done`.
- **A finished card stays finished.** `done` is terminal — claim, assign, release,
  reclaim, move, contract, approve, review, and offer all refuse it — so a card a
  dependency was recorded against cannot un-finish and reopen the order after the fact,
  and `archive` does not change that: it moves a `done` card's file, and never its lane.
  The one exception is `edit`: a title, path hints, priority, or `dependsOn` can still be
  corrected by whoever holds it, or by anyone while nobody does, because a title is what a
  reader reads and a finished feature whose title is wrong would stay wrong for as long as
  the board keeps history. A card finished by mistake is dropped and added again: the new
  card takes a new number, and the dropped one's title and lane stay in `ended/` under the
  id nothing will use again. Its notes do not come with it.
- **A card file this build cannot read is reported, not skipped.** A file written by a
  newer build, a half-written one, or a record moved under another name is named by
  `list` with the reason and counted in the page's footer beside the store's size, so a
  board that is not readable never reads as a board that is empty. The record is version
  `2`; a version `1` file — the shape before the lane and the block were named — is read by
  mapping it and is rewritten as `2` on its next write, so nothing is lost and nothing is
  migrated behind a read. A version above this build's is named by number rather than
  guessed at. `done` stays terminal until a `reopen` is designed.
- **Links are recorded by the tool.** A link names an id, so the page shows what a
  card waits for but does not edit it; `board edit` records it while the card is being
  planned, and `board drop` refuses to strand one.
- **The board knows when a process is gone, not when work is stuck.** The Teammates
  list reads the bus's records, where `live` is a heartbeat inside ten minutes,
  `quiet` is a heartbeat that has aged, `gone` is a record whose process is no longer
  running, and `no record` means only that the bus holds no record of that label. A
  `gone` owner's cards join **Needs a decision** with the reason that they are free, and a
  *hung* session reads `live`, so "idle" still means what a card can know — nobody has
  touched it for 30 minutes — rather than that its owner is stuck. The spot-check the
  lead owes is not read off that clock either: every card in `execute` is in the round's
  `awaiting review` group, so work that finished ten minutes ago is in the queue instead
  of being invisible until it looks idle. With `session-bus`
  unloaded, or before any session has joined here, every state reads `—` and the board
  works exactly as before.
- **The page is read-only, deliberately.** A browser is not an identity: every page write
  was made as the seat, and a page `assign` had to record that no handoff was sent. Rather
  than duplicate the card rules in the client — which had already drifted from
  `lib/board/rules.ts` — the write path is gone. What a reader loses is editing from the
  browser; what the product keeps is every one of those verbs as a tool. The one capability
  with no tool-side twin is assigning **without** messaging the peer: `team`'s `assign`
  sends a handoff, and nothing else records an owner silently.
- **A seat can outlive its writes.** A card claimed from the page before this change still
  names `board:<lead>` as its owner, and `reclaim` is how a lead takes it back.
- **A lane history is short, and it starts when the field did.** A card keeps the last
eight lane transitions, dropping the oldest and counting what it dropped, so the record
is bounded at write time rather than by a janitor — nothing prunes a board. A card
written before the log existed has no age beside its lane, and `updatedAt` keeps meaning what
it always meant: when the card was last touched, which is not when it last changed lane.
- **Nothing prunes itself.** A `done` card stays until someone sets it aside or drops it,
  an archived card stays until someone drops it, and a dropped card leaves its record
  behind for the same reason; the page shows how many bytes the board occupies and how
  many files it could not read, and neither it nor the round counts the archive. Setting
  history aside is a `board` call, not a threshold nobody stated, so what a read returns
  never depends on how much has accumulated.
- **A page claim is a claim nobody cleans up.** A card a page claimed before this change
  is the seat's until a tool reclaims it; the page itself can no longer add to that pile.
- **The page stops a minute after its last tab leaves, or two minutes after it starts
  with no tab at all.** Closing the tab to run a command and coming back is fine, and a
  teammate's watching tab counts as one. The second grace covers the page a browser never
  opened — `openInBrowser` swallows a failure, and a prefix held by a page nobody saw is a
  prefix held for the session. Either way `/board` starts it again, on the session's port,
  and prints the address it reopened.
- **The prefix is `/board` on the session's one server.** The port belongs to `serve`, so
  `/board`, `/browse`, and a browser plan review answer on one origin; that port is the
  project's own number, and `serve.port` in `bytefly.json` pins another, so a bookmarked
  URL survives a restart. A live note still
  wins: one repository has one page, so this session attaches to the page that note names
  rather than serving a second one — and a session that attaches binds nothing at all.
- **The note is believed only while it answers.** A page that crashed leaves its note
  behind; the next `/board` probes it, takes it over when nothing replies, and attaches to
  the page that won when two sessions start in the same instant. A clean exit — `/board
  stop`, or a session shut down normally — clears its own note, so the one that survives
  is the one a crash left. A note it cannot read at
  all is named with its path — "another session is serving" is only said of a page that was
  seen answering.
- **A page that cannot read the board says so once.** A snapshot is built on every tick, and
  a read can fail under a running page — the board's directory removed, or replaced by
  something that is not one. The frame is dropped rather than raised, the session is told
  once, and the next tick tries again, so a board that comes back is followed again without
  a second `/board`; a notice per tick would be a transcript nobody reads.

## Pi integration

- **`session-bus`**: a card's owner is the session's team name, so a card names a session a
  peer can be addressed by. The board calls one thing on it — the join, through
  `lib/session-tool.ts`, because a command context cannot call a tool and the request
  therefore travels on `pi.events` — and reads its records otherwise, which is why the
  page works with the bus disabled. The join asks for the name the board already writes
  and never renames the session, so the footer stays the user's. A failed join is a clause
  on the `/board` line, not a failed page. The seat is the name the page is served and
  reported under, and `/board status` says which session is on the team through it.
- **`plan`**: `board contract` records the file `plan` action `write` saved; the plan extension owns
  it, and `lib/plans/paths.ts` is the one statement of where it lives — the board reads the
  same module, so the two cannot disagree about what a plan path is. The board stays
  available while planning, and only the reads in `lib/board/actions.ts` work: the same tool
  writes, so its read-only hint cannot say that, and plan mode reads the action in the call
  instead (`lib/policy.ts`'s `isBoardRead`). Every other verb is refused with the board's own
  sentence, which names the order — claim before you plan, record the plan once it is
  approved — so a model that tries to claim mid-plan is told what to do instead. The contract
  is recorded **after** the plan is approved, when the writing verbs work again.
- **`bytefly`**: the board's own section of the shared document, in one place:
  `{"board": {"wip": {"plan": 3, "execute": 5}, "lead": "gavin"}}`. Each number is clamped to
  `1..20` and the page's heads show the numbers the store read once; `lead` is the team name the
  two signatures must carry **and** the name the page serves as, so setting it renames the lead
  everywhere at once. The project file overrides the global one. Every key falls
  back on its own, so setting one leaves the others alone. `/bytefly settings` carries all
  three as rows — `Plan limit`, `Execute limit`, and `Lead` — and a change lands in the file at
  once and in the board at the next session, because the section is read when the store
  opens.
- **`todo`**: the approved plan's steps are seeded into `todo`. Steps never become
  cards. A `list` call is a read for the lag reminder too, so reading the board never
  forces a todo update, while `add` or `claim` counts as work like any other write.
- **`worktree`**: the store is keyed by the repository's common git directory, so
  every worktree shares one board.
- **`serve`**: the page mounts `/board` on the session's one server, which draws the
  single `◉ <port>` chip. **`bytefly`**: the bar shows that chip, and `doctor` reports
  nothing new — the board needs no binary and no per-machine setup.

## Design notes

- **One JSON file per card**, in `<agent-dir>/board/<repo-key>/cards/`, one per ended
  card in `ended/`, and one per archived card in `archive/`. The listing is the index, so
  a reader needs no cache and no daemon.
- **The plan is proved, not asserted.** `contract` requires the path `plan` action `write` returned,
  `lib/board/artifact.ts` resolves it and checks that it is a markdown file inside this
  repository's plan store, and a move to `execute` or `done` re-checks that the file is still
  there. The board still never reads a plan — a `stat` is the whole check — but a card can no
  longer be executed against a path to nothing, which is what "the plan it is executed
  against" had been claiming while `execute` asked no question at all. The proof is a fact
  the tool hands the state machine, so `rules.ts` stays pure and a surface added later cannot
  pass the gate by forgetting it; the stored path is the resolved one, so a card reads the
  same absolute file from every session.
- **An id is never reused.** The next id is the highest in `cards/`, `archive/` *or*
  `ended/` plus one, so a number cannot be handed to a second feature — which is the only
  thing that lets a note, a handoff, or a link name a card and still mean it. A record
  is written before its card is removed: a crash between the two leaves a card that
  still exists with a record explaining it, never a card that is gone unexplained.
- **An archive is a second pile, not a second state.** `archive` renames a finished
  card's file into `archive/` and touches nothing inside it, so there is no new field, no
  schema version, and no lane transition: the record is exactly what it was, and the
  directory it lies in is the whole fact. That is why `ended/` keeps its one reason — a
  drop still leaves a record because the card is gone, while an archived card is not gone
  at all — and why a read by id looks in both piles: a card is where it lies. The
  decision is explicit because nothing in this board prunes by itself, and because an
  automatic sweep would make `lane: "done"` return something different past a threshold
  nobody could see. The board, the rollup, and the page read `cards/` alone — the only
  look at the archive is the directory listing a lane-less `list` counts, so the omission
  cannot pass for a deleted history — and an archive therefore lowers the board's size
  and the cost of every read. The ids stay spent because the file name is the id.
- **Create is exclusive**, by hard-linking a temporary file onto the target name,
  so two adds cannot share an id. **Update** re-reads, re-checks the operation's
  own preconditions, then renames over the old file: an operation means "apply when
  this holds", never "force this state".
- **The page is a dumb renderer** over one snapshot built on the server, pushed
  only when a card's revision, or a teammate's state, mail, or listening flag, moves: a
  heartbeat every ten seconds is not news, and a frame nobody needs costs the page a
  parse. The snapshot carries the lanes rather than a count beside them — each with its
  key, label, empty word, colour role, limit (where it has one), and count — plus `total`,
  the rollup, the store's size and path, the files it could not read, and the repository's
  name and root. There is no `counts` object to disagree with the trays, and no lane table
  in the browser.
- **A query reads what a card says, not just what it is called.** A card's reasoning lives
  in its notes and in the plan it is executing, so leaving both out of the search made the
  two fields that hold the argument the two a reader could not find. The order is the
  answer's weight — title, holder, path hints, plan, notes — and it is one body spliced
  into the page from `lib/board/card.ts`, so the filter box and `board list query:` cannot
  disagree about which card a word names.
- **The record is a ladder, not a paragraph run.** A card's facts are one per row so each
  can be read and copied alone: the meta line it replaces merged id, updated, and who into
  one sentence, and named the last writer as though it were the author. The one row that
  carries two halves is `updated` — the stamp and the label of whoever wrote it are one
  moment, and reading them apart was how the same fact came to be printed twice. The notes
  are the cargo — they read at body size on a measure, with their attribution under them,
  and the latest first, because a note is usually why the card was opened — and the
  dialog's body is the only scroll, because a second scrollbar inside a 70vh panel hid most
  of what a reader opened it for. A long plan path elides on one line with the whole value
  on its hover title: the plan is the reason to open a card, and it used to shred across
  three lines of `--dim`.
- **The walk is over the board as drawn.** `j`/`k` step through the cards the page has
  boxes for, so a folded Done lane and a filter are both respected; opening a card does not
  take the keyboard away, it points it at the next record. The position is announced
  because a title that changes inside an open modal is not.
- **A class is a symbol, not a string.** The document and the bundle cannot import from
  each other, so both read `view/names.ts` — the only place a `board-*` class is spelled.
  A name assembled from a prefix is what made the old contract untestable: it passed on
  the prefix and could not see the whole name, so a rule with nothing behind it (or a
  name with no rule) survived until a capture showed it.
- **The page is given what it prints.** A card arrives with the priority it acts on and
  the unfinished dependencies that block it (`waits`, as `#2 (execute) Patch the gateway`),
  and a lane arrives
  with its words, colour, limit, and count, so the client holds no copy of a rule
  `lib/board` owns — the copies it did hold had already drifted from the tool's. What cannot
  cross as data crosses as source, because either it needs the reader's clock or it must be
  the same sentence on both surfaces: `plural` (one wording for `1 card`), `matchesQuery`
  (a filter that finds the card the tool would), `reasonFor` (one reason line, whose
  `offered … ago` has to tick rather than freeze at snapshot time), `formatAge`, the tab
  title, and the placeholder lane count. Each is a `*_JS` string spliced into the bundle by
  `view/client.ts`, and `extensions/board/view/pages.test.ts` holds the splices in place.
- **An offer is a record, not a reservation.** `team offer` broadcasts a card and then
  writes `offeredAt` — the moment, and nothing else — because an event leaves nothing
  behind and a card three sessions ignored read exactly like one nobody had looked at.
  Every answer clears it: a claim, an assignment, and a release each delete the field, so
  its presence means the offer is still open. The page reads it in two places — the card
  face and the Team tab's row — and both print the one sentence `lib/board/reason.ts`
  builds, `offered 1m ago — nobody took it`; `list <card>` says `offered: 1m ago, and
  nobody took it`, because the transcript has no reason slot to share. The age itself is
  `lib/format.ts`'s one rule, handed to the page's bundle as source.
- **`waits on` answers two questions, on purpose.** The page names the *unfinished*
  dependencies in one line — "why can I not start" — and `board`'s result names every
  dependency with its lane, including finished ones — "what is this card tied to". Both
  read `links.ts`, so neither can invent a blocker; the difference is the question, not
  a drift.
- **A link is stored once, and read both ways.** `dependsOn` lives on the waiting card
  alone, so nothing on disk says what a card is holding up; `openDependentsOf` answers
  it over the board, `list <card>` prints `waited on by N cards: #2 (backlog)`, the page's
  card face says `holds up #2 (backlog) <title>`, and the
  dialog has the rung the card's own row cannot. Both skip a finished card, unlike the
  drop refusal, which keeps every edge: "what is held up" is about work, and "would this
  drop strand a link" is about the file.
- **One page is found, not configured.** A note beside the cards carries the port, the
  seat, and the token; it is created exclusively, so two sessions starting at
  once cannot both serve, and the loser attaches to the winner. The alternative —
  a setting that named the page's address — was rejected: the role moves, the seat's name
  does not, and a second session has to find the page rather than pick one. (The lead is a
  different question, and it *is* a setting: see **Who signs**.) The port in the note is the
  session's, never a number this page chose.
- **The page is a view because a browser is not an identity.** Every page write was made
  as the seat, so a page `assign` had to write down that nobody had been told, and the
  client's copy of the card rules drifted from `lib/board/rules.ts` — it offered a drop
  the server refused. The write path was deleted rather than hidden behind a flag: a
  disabled verb is still a verb the page has to decide. Deleting it took the composer's
  dialog, the confirm dialog, the note field, and 60-odd buttons with it.
- **One edge, stored once.** A link is one id in the waiting card's file and the
  reverse edge is computed over the board, because a copy of the same edge on the card
  being waited for is a copy that drifts; the cycle check and the drop rule are what
  keep the graph whole instead.
- **A priority is a field, not a lane.** Urgency is not a stage of the work, so it stays
  a field: inside a lane, priority then the id the card was given is the order — never the
  moment it was last touched, so a note or a claim cannot move a card out from under a reader
  working down the lane — and a card says its priority only when it is not the ordinary one.
  The lanes are the flow's stages, which is why a fifth one had to be argued for in the note
  below rather than added as "urgent".
- **`edit` leaves an omitted field alone.** It is the one action whose job is "make it
  say this", so an absent field must mean "not this field" — a caller that sends only a
  title must not clear the path hints and links it never mentioned.
- **A lane change is recorded where every transition ends.** `steps.ts` decides each
  transition, but `write()` in `rules.ts` is the one place all of them pass through, so
  the log is appended there rather than from thirteen operations that would each have to
  remember it. A write that leaves the lane alone — a note, a contract, an edit, a claim by
  the holder — appends nothing, because the question the log answers is "how long has this
  been blocked", and `updatedAt` cannot answer it: filing a note against a blocked card
  moves that stamp without moving the card.
- **Five lanes, and the gates are why.** This board used to say the four lanes were its
  whole vocabulary and a fifth would double the counts and the heads. The flow changed
  that: a card now moves `backlog → plan → execute → done`, and `blocked` is the pool a
  decision parks in. Two of those lanes exist because an agent is a poor judge of itself —
  `plan` holds a contract until the lead, who is not its holder, approves it, and `done` is
  refused until the lead has spot-checked the work — and a WIP limit on `plan` and
  `execute`, counted over the whole board because a repository has one, is what keeps a
  review queue from turning into a shelf. The cost is real (one more tray, one more head)
  and is paid once, in `lib/board/lanes.ts`: the label, the empty word, the colour, the
  ownership rule, and the limit are that table's, and the page receives them in its
  snapshot instead of keeping a copy.
- **The gates are a label check, and say so.** `approve` and `review` take the lead's name —
  `board.lead`, the page's seat by default — and refuse the card's own holder even when that holder is
  the lead, which is the half of "somebody read this" a file can hold; the board cannot tell a
  person from a session, and does not pretend it can. The name is a team name rather than a
  session, because that is what a pure rule can be handed and what a card file can record: a
  session signs by joining under it, and `board.lead` moving is the board saying who is
  accountable now. The person gets a door of their own — `/board approve` and `/board review`
  write as `you`, a label with no session id — because one session alone would otherwise hold
  a card it could never sign, and because a repository should not need a second process to
  finish its work. The two read differently on the card, which is the honest way to say it:
  `you` is the person who read the plan, the lead is a second pair of eyes. Either sign takes an
  optional `text` note, written with the sign: the signer is the session `note` refuses on a
  held card, so without it a caveat has nowhere to go on the card. The contract is
  three one-line fields written by `contract`, and a changed line or a different plan file
  drops the sign, because the sign named both the wording and the artifact — so a re-worded
  card is signed again, by the lead that signed the last one. A card too small to state an
  acceptance does not belong on the board — it belongs in `todo` — which is the honest answer
  to "this is ceremony for a typo fix".
- **`status` became `lane` because a card now has two states.** The field, the parameter, and
  the page's attribute were renamed in one step with no behaviour change: once a card can be
  approved and reviewed, "status" answers more than one question, and the docs had always
  said *lane*. `readCard` maps an older file's `status` and `plan` onto `lane` and
  `planPath`, so a published board keeps reading until each card is written again. The log
  needed the same map twice over: a file from before the rename spells a lane `status`, and
  a file from before the *lanes* says `todo` or `doing` — the four-lane board's pool and its
  work in hand — which read as `backlog` and `execute`. A word that is neither a lane nor one
  of those two refuses the record, because a lane guessed from it would put the card
  somewhere its own history disagrees with.
- **Rejected:** steps as cards (they flood the board), a shared database (a file per
  card needs no dependency and no lock), an index file (every write maintains it,
  every read can find it stale), drag-and-drop (a lane change is a named `move`), a
  reverse link field (two copies of one edge), a separate review lane (a review is a fact
  about a card, not a place), deriving the contract from the plan file (the board never
  reads a plan), and an automatic archive past some number of finished cards (a threshold
  nobody stated would decide what a read returns, and nothing else here prunes).
- **A block says why, and a finished card says with what.** `blocked` exists to ask a
  person for a decision, so the move into it records one record — `blocked: { kind, note }`
  — rather than two sibling keys: the kind (`contract`, `dependency`, or `decision`, and
  required by the move) and the sentence a person reads, which is optional. The kind is the
  errand, not the route: where a blocked card may go is decided by what it has, so `blocked`
  offers `plan` whenever that lane has room and `execute` only with the same contract and
  approval the other door asks for. A park frees a slot rather than reserving one, which is
  why a resume can be refused: the lane may have refilled while the card waited, and the
  refusal says so — `wait for a slot, or release it back to the pool` — rather than naming
  the `finish` and `block` exits a parked card does not have. A card parked while it was still being planned comes back to `plan`; one parked
  mid-flight carries both and resumes. A block record is a fact about the `blocked` lane and
  nothing else, so the board's one write deletes it the moment the card is somewhere else — a
  release, a reclaim, and a claim cannot carry a sentence into a lane it was not written for
  — **but the lane log keeps it**: the transition that parked the card carries the same
  `block`, so "why did this sit for two days" outlives the resume. A spot-check is cleared
  only when the card leaves `execute` for `blocked` or `plan` — a park is somebody deciding
  the work is not finished, and re-planning changes what was agreed — so a card that was
  blocked and resumed needs another look before `done`, while a card that lands keeps the
  sign that let it through.
  `landed` is the commit `HEAD` resolved to at the move to `done`, recorded because
  `done` is terminal and nothing later can say which change closed the card. Of the three
  the move writes, only the blocker is required — a card cannot be parked without saying
  what kind of block it is, because a block is what a person is asked to answer. The
  sentence is optional (the page says `blocked, with nothing recorded`), and a card
  finished before the field, or outside a repository, has no commit to record — finishing
  never depends on a git read.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | The factory: gate on the opt-in switch (`PI_ENABLED_EXTENSIONS`) and `PI_DISABLED_EXTENSIONS`, build the runtime and the lazy page, register both, close on shutdown |
| `schema.ts` | The tool's parameters |
| `types.ts` | The shapes the tool registers and reports — the actions and the fields each acts on, the card an action produced, the cards a list read, the rollup when it was asked for, and the card a refusal carries |
| `tools.ts` | Action dispatch and the refusal shape |
| `input.ts` | A card body as the tool reads it: the `add` fields normalized in one place |
| `format.ts` | The model-facing text |
| `rows.ts` | The transcript row grammar: one card as a line, its lane and its facts painted in the tones `lib/board/tone.ts` gives them, and the accent on the holder's own rows in a `mine` listing |
| `result.ts` | The transcript block: the collapsed line, and the rows a `list` expands to |
| `tone.ts` | The terminal's word for a board tone: `TONE_ROLE`, because the page wears a tone as a CSS property and the terminal's roles are its own five words |
| `lazy-page.ts` | The page behind `lib/lazy`: the command paths load `page.ts` once, and `closeAll` closes only a page that was already opened, so a session that never touches the board imports none of the server |
| `page.ts` | The page's lifecycle: the `/board` prefix it holds on the session's server, the three closes (`/board stop`, the idle grace, and shutdown — each taking the note with it), and the probe behind `/board status` |
| `snapshot.ts` | The page's snapshot: the cards, the bus's records, the store's size and path, and the repository's own name, handed to `buildView` |
| `commands.ts` | `/board`, its three words and their refusals, and the one line `/board status` prints |
| `join.ts` | The board's side of the team: when it asks (the page, or the first claimed card), the name it asks for, and how the outcome reads on a `/board` line |
| `announce.ts` | The message a sign sends: the card's owner, told who signed and the lane the sign opened, over the same `session send` a handoff uses — and the line the result carries when the bus cannot answer, which never undoes the sign |
| `transport/router.ts` | The five reads — the document, the client script, the theme script, the snapshot, and the frame stream — with the token gate and the guards in front of them |
| `transport/server.ts` | The loopback listener, the frame push — one read of the board per frame, and a failed read reported rather than thrown — and the close |
| `view/page.ts` | The document: an inert shell the client fills, named after the repository it is a board of so the toolbar is not blank before the first frame, with no form on it |
| `view/styles.ts` | The page's `board-*` layout rules |
| `view/render.ts` | The client's snapshot → DOM renderer: the toolbar, the lanes, and the frame that keeps the dialog current |
| `view/card.ts` | The client's card face: one card's title and facts, the path hints behind `+N`, the note count, what it holds up, and the read/current marks |
| `view/names.ts` | The page's class vocabulary: one table the document and the bundle both read, so what the page wears and what its stylesheet draws can be compared |
| `view/team.ts` | The client's round: the two tables and the Done line |
| `view/empty.ts` | The client's two empty states: no cards at all, and a filter that matches none — one sentence, and the way back |
| `view/dialog.ts` | The client's card dialog: fill one card's record (a note through the kit's inline Markdown renderer), keep an open one current across frames, record it as read, close it, and forget it when the kit closes it |
| `view/keys.ts` | The key table, and the bindings that make it true — including `j`/`k` walking the open dialog through the drawn cards |
| `view/live.ts` | The client's tabs, filter, and frame stream |
| `view/client.ts` | The one script served at `/app.js` |

The lanes, the contract, the limits, the reason rule, the steps, the store, the rollup, and
the snapshot, and the rule that a plan path is a plan file are `lib/board/` — see
[`lib/README.md`](../../lib/README.md).

## Testing

`test/suite-manifest.ts` declares the suites:
`lib/board/{artifact,card,contract,lanes,limits,links,page-pointer,read,reason,round,round-text,rules,session,skipped,store,view}`
for the plan a card is executed against, the record, the reader that maps a v1 file onto it, the contract and its boundary, the
lane table and its transition matrix, the WIP limits and their config, the dependency graph,
the note a page leaves, the one reason rule, the rollup and its text, the sentence for a
refused file, the card's transitions, the store a call opens and the identity it writes as,
the files that store keeps, and the snapshot, and
`extensions/board/{input,seat,tools,page,commands,extension,transport/router,view/pages,view/dialog,view/behaviour}`
for the card body, the seat, every action, the page's lifecycle over a real socket (a page
served, attached to, and taken over, a board that stops being readable, and a write refused
on the wire), the command, the
factory, the routes, the page's document and client bundle, the card dialog's own, and the
page driven in a browser — a card opened from its title or anywhere on it, the filter and
the no-match state, the fold, the lane switch, a live frame, the dialog's sections, and the
keyboard a dialog keeps.
