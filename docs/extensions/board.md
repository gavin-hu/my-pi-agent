# board — one shared feature board per repository

Every Pi session on a repository reads and writes the same cards, and a repository
has **one** page: the session that starts it serves it under the seat `team-lead`, and
every other session opens that page read-only instead of a second one. A card is one
**feature**: its outcome, who holds it, where the work happens, the plan it is
executing, how urgent it is, what it waits for, and the notes that explain how it got
there.

The steps of the work are deliberately *not* on the board. They live in the
owner's plan and in `todo`; the board answers who is doing what, and what needs a
decision.

<img src="../../assets/screens/board.png" alt="The board page: a toolbar with the seat the page writes as, a live badge, Board and Team tabs, done-of-total progress, a filter and a New card button; four lane trays, each with a dot, a count and a fold control; and cards carrying an owner chip, path hints, a reason line and their actions" width="100%">

*`/board`: the four lanes, with a new card one keystroke from its dialog and the round one tab away.*

## Capabilities

| Capability | How | What you get |
|---|---|---|
| A shared feature list for one repository | `board` action `list` | Every card in lane order — `todo`, `doing`, `blocked`, `done` — or one card, or one lane |
| The lead's rollup | `board` action `list` with `round: true` | Every owner with its live cards and, beside the count, what it has finished — an owner whose last card is done stays listed — then unassigned, unplanned, blocked, idle, and done |
| Publish a feature | `board` action `add` | A `todo` card with path hints and a first note |
| Take a feature | `board` action `claim` | The card is `doing` and owned by this session |
| Hand it back | `board` action `release` | The card is `todo` again, with no owner |
| Change lane | `board` action `move` | Wherever the owner moves it: `doing`, `blocked`, `done` |
| Record what happened | `board` action `note` | A note appended to the card's history, attributed and stamped |
| Record the plan | `board` action `plan` | The plan file the card is executing, so "unplanned" work is visible |
| Fix what a card says | `board` action `edit` | A new title, path hints, priority, or the cards it waits for — by its holder, or by anyone while nobody holds it |
| Say how urgent it is | `board` action `add` or `edit` with `priority` | `high` sorts first inside its lane, and the card says so |
| Record what a card waits for | `board` action `edit` with `dependsOn` | An unfinished dependency refuses a claim and a move to `doing` or `done`, and the reason line names it |
| Hand a card to a teammate | `Assign to` in the card dialog | The owner is recorded and the card's history says no handoff was sent — `team`'s `assign` is the one that messages a peer |
| Take a card back from the tool | `board` action `reclaim` | The owner clears and the card returns to To do, without the page and without `team` |
| Find a card without reading every lane | `board` action `list` with `query` | The cards whose title, path hint, or holder matches — the same rule the page's filter uses |
| See the work you hold | `board` action `list` with `mine` | The cards this session holds, by the same rule a claim is checked against |
| Delete a card | `board` action `drop` | The card and its notes are gone; nothing else ever deletes one, and one that a card waits on cannot leave |
| One page per repository | `/board` | Serves a loopback page as `team-lead` with a **Board** and a **Team** tab, following the store live; a page already served is opened instead |
| Watch somebody else's page | `/board` on a session that is not serving | The same page, **read-only**: no **+ New card**, no `Claim`, `Move`, `Edit`, `Drop` or note field, because the note a viewer reads carries a credential that may only read. The viewer joins the team under its own label, so a handoff can still reach it |
| See the lead's round at a glance | `/board team`, or `/team` with no browser | A queue of cards that need a decision, each with the reason and its way out, then who is on the team and what they hold |
| Join the team | `/board`, or any card you work | Opening the page joins this session to the team — as `team-lead` when it serves the page, under its own name when it watches one — and the first card write joins it too, so nothing has to be armed by hand. `/board status` says which team you are on |
| See who is around | `/board team` | The Teammates list: every session this repository's bus has recorded, plus every owner a card names, each stating `live`, `quiet`, `no record`, or `—` when no bus is loaded |

## Quickstart

```
you:  publish two features for the billing work
      → board add "Billing webhook accepts orders" paths ["src/billing"]
      → board add "Retry branches merge cleanly"
lead: board edit 2 dependsOn ["1"] priority "high"
      → #2 waits on #1 (todo), and sorts first in To do
peer: claim the first, plan it, note the phases, finish it
      → board claim 1 → /plan → board plan 1 <plan file> → board note 1 … → board move 1 done
      → board claim 2 — refused while #1 is unfinished, allowed once it is done
lead: board list --round
      → 1 owner · 2 features · 0 unassigned · 1 unplanned
```

## Commands

| Command | Who | Effect |
|---|---|---|
| `/board` | lead | Serves the page as `team-lead`, or opens the one another session already serves |
| `/board team` | lead | The same, opened on the Team tab |
| `/board status` | both | One line: the seat, the port, how many tabs are watching, the store, and the team this session is on — or the page being watched |
| `/board stop` | lead | Stops the page this session serves; on a watching session it says who serves it |
| `/team` | both | The round in the terminal: the rollup, then who is live and who has gone quiet |

**Who serves the page.** The first `/board` in a repository serves it; after that the
page is found by the note it leaves beside the cards (`page.json`, in the board's own
directory), so a second session opens the same page rather than a rival one. That holds
while a page answers; if nobody is serving, the next `/board` serves — the seat's name
does not change, so a card a browser claimed is still the seat's. A note a session left
behind when it died is not a dead end either: `/board` says which page it named — with its
URL — takes the note over, and serves.

**Joining.** One thing, done for you: `/board` puts this session on the team — as
`team-lead` when it serves the page, under its own name when it watches one — and so does
the first card you work. The join is also the listening: mail is reported at that
session's next turn, and no turn is raised, so being on the team never spends a turn. A
session that has neither opened the board nor touched a card is not on it, and `/board
status` says which team this session is on and why not when it is on none.

The page is still a seat: it writes as `team-lead` with an id of its own, so a card it
claimed comes back with `reclaim` rather than a `release` from the terminal.

## Tool

`board` is one action-shaped tool. `readOnlyHint: false`, `destructiveHint: true`,
`openWorldHint: false`, `executionMode: "sequential"`.

| Action | Parameters | Result |
|---|---|---|
| `list` | `status?`, `mine?`, `card?`, `query?`, `round?` | the cards in lane order, one card, or what a query or `mine` matches; `round: true` adds the rollup, which always covers the whole board |
| `add` | `title`, `paths?`, `priority?`, `note?` | the new `todo` card |
| `claim` | `card` | the card, now `doing` and owned by this session |
| `release` | `card` | the card, back in `todo` |
| `reclaim` | `card` | the card, back in `todo`, whoever held it |
| `move` | `card`, `status` | the card in its new lane |
| `note` | `card`, `text` | the card with the note appended |
| `plan` | `card`, `path` | the card with its plan recorded |
| `edit` | `card`, `title?`, `paths?`, `priority?`, `dependsOn?` | the card with what it says corrected; an omitted field is left alone, and `dependsOn: []` removes every link |
| `drop` | `card` | the id that was dropped |

`card` takes `4` or `#4`. A refused call is an error result that still carries the
card, so the next attempt starts from the truth.

## Routes

Every route needs a token, and which one it is decides what it may do: the lead's
satisfies every route and is in the URL its browser was opened at; the one the note
carries satisfies the reads and gets a 403 on every write. A write is made as the page's
seat — `team-lead` — not as the session that opened it.

```
GET    /                     the document (?view=board|team&card=4)
GET    /app.js               the client script
GET    /api/board            the snapshot
GET    /events               the live frame stream
POST   /api/cards            add a card
POST   /api/cards/:id/…      claim, release, reclaim, assign, move, note, plan, edit
DELETE /api/cards/:id        drop a card
```

## Layout

One page, two tabs, one lifecycle. The kit shell keeps the toolbar and the footer
pinned and makes the main pane the only scroll box; the page adds no second one.

| Band | What it holds |
|---|---|
| Toolbar | the mark, the seat the page writes as, as a chip, a live badge (`connecting`, `live · 3m`, `reconnecting`), then one group: the Board\|Team switch, done-of-total progress, a filter, **+ New card**, the keys button, and the theme toggle |
| New card dialog | the modal the toolbar's button (or `n`) opens: **Title** on its own line, the loudest field on the page, with a `n/120` count once you type; **Paths** under it, space-separated hints; **Priority** as a three-word list; the hint line; and one closer, `Cancel`, beside **Add card**. The title is focused on open, the dialog stays open after an add so a lead can publish several cards, and a draft survives `Esc`, the backdrop, and `Cancel` is the only thing that discards it. The same dialog is the card dialog's **Edit**: prefilled, headed `Edit card #4`, with **Save** in place of Add — and leaving that mode throws its text away, because that text was the card's, not a draft |
| Lanes | trays, not a bare list: four columns at ≥1180, two rows at 1000, one lane plus the lane switch at ≤860 — where it opens on the first lane that holds a card. Each head sticks while the pane scrolls, carries its count as a pill, and folds its cards away |
| Cards | the id and a two-line title (the page's loudest text), an owner chip and an age, a muted priority chip when it is not `normal`, path chips, one reason line in one voice — what a card waits for, a blocked card's last note, `no plan recorded`, or `planned` — clamped, with the whole sentence as its tooltip, and at most three actions — `Claim` or `Move` bordered, then `Note` and `Open`. A card that waits offers neither `Claim` nor `Move`: the reason line is what it says instead. A viewer's page draws `Open` alone, and no **+ New card**: the document says `data-writes="0"` and every affordance reads it. A hovered card lifts a pixel; a finished one recedes, title and owner chip muted |
| Team | two panels and a strip. **Needs a decision** is one row per card — a card that is both idle and unplanned arrives once, keeping its strongest reason — laid out as two lines: the id, title, owner chip and `Reclaim` (or `Claim` when nobody holds it) on the first, the reason on the second with the whole sentence as its tooltip, and its kind as a left edge (`--danger` blocked, `--warn` idle, `--muted` unplanned or waiting, a dashed grey edge for nobody's). A card that waits on unfinished work is a row of its own kind and offers no action: the claim the rules would refuse is not on the row at all. Above 1180px the queue stops at one screen's height and scrolls inside its panel, so the roster and the Done strip stay on the same page as its top. **Teammates** is one row per person — a state dot, the label, a `you` chip, a `not listening` chip on a live peer whose inbox watch is off, a mail badge, then `live · 3 held · 1 done · oldest 21m` (a quiet session reads `quiet for 2h`, because a word without an age is no reason to reclaim) — sorted you, live, quiet, no record, and an owner whose label nothing answers to keeps its row. Done is one quiet strip whose ids open their cards. Both panels honour the toolbar's filter, and their headings read `shown/total` the way a lane head does. Below 1180px the queue comes first and the roster follows |
| Card dialog | the lane as a dot and a word beside the title, a meta line, the owner and its priority, the paths, what it waits for, the plan as monospace text, the notes as a timeline (who and when above the sentence, a rule between them), a note field, and `Move to` only the lanes the card can reach, then `Assign to` for an unowned card, `Release`, `Edit`, `Drop`, `Close` |

Colour is a role: `--muted` for `todo`, `--accent` for `doing`, `--danger` for
`blocked` and destructive choices, `--success` for `done`. The Team tab's decision
rows sit on the kit's `--raised`, the one step above `--surface` that lets a block read
as a plane instead of an outline; the Done lane sits on the page itself, so history
stops competing with the lanes a lead works in. A card takes its colour
from the lane it sits in — the head's dot, and the reason line's tone — rather than
from a bar of its own, so one card does not shout twice. The page states a lane and
a card with `data-status`, so a theme change repaints it without a rule of its own.

## Keys

| Key | What it does |
|---|---|
| `n` | New card: open the dialog and focus the title field |
| `/` | Filter the cards by title, path, or owner |
| `j` / `k` | Next or previous card |
| `Enter` | Open the focused card |
| `t` | Switch Board and Team |
| `Esc` | Close a dialog, or clear the filter |
| `?` | The keyboard sheet |

A dialog traps `Tab`, closes on `Esc` or a backdrop click, and returns focus to
whatever opened it — the kit's `dialogScript`, shared with the review and browse
pages. A field keeps its keys: `n` inside the note input types an `n`.

## Security

- The page binds loopback only, answers only its own host names, and refuses a
  state-changing request another site made.
- There are two credentials, both 128 random bits minted when the page starts and
  compared in constant time: the lead's, which can change a card, and a viewer's, which
  cannot. They are in the URL, never a cookie, and there is no CORS. The note beside the
  cards (`page.json`, owner-only) carries the viewer's and never the lead's.
- A write is made **as the page's seat** — a browser is not an identity — so
  the toolbar names the session and claim/reclaim ask first.
- The page writes only the board store under the agent directory. It never writes
  your repository, and it reads the session bus's own records read-only — labels,
  modes, heartbeats, message counts, and whether each is listening — to draw the Teammates list.

## Limitations

- **Ownership is advisory.** Two sessions can still edit the same file; only
  `session-bus`'s path claims are a lock.
- **A finished card stays finished.** `done` is terminal for every transition — claim,
  assign, release, move, and plan all refuse it — so a card a dependency was recorded
  against cannot un-finish and reopen the order after the fact. A card finished by
  mistake is dropped and added again; its notes do not come with it.
- **Links are recorded by the tool.** A link names an id, so the page shows what a
  card waits for but does not edit it; `board edit` records it while the card is being
  planned, and `board drop` refuses to strand one.
- **The board does not know whether a session is alive.** "Idle" means a `doing`
  card nobody has touched for 30 minutes, not that its process is gone; and the
  Teammates list reads the bus's records, where `live` is a heartbeat inside ten
  minutes, `quiet` is a record whose heartbeat has aged, and `no record` means only
  that the bus holds no record of that label — never that a session is dead. With
  `session-bus` unloaded, or before any session has joined here, every state reads
  `—` and the board works exactly as before.
- **The seat and your terminal are two actors.** The page writes as `team-lead`, so a
  card a browser claimed is released from the browser or `reclaim`ed from the tool —
  `board release` in a session is a different actor and is refused. The Team tab marks
  your own row from the session you are reading in, not from the seat.
- **A viewer's page is read-only, and the note is the only credential it carries.** A
  lead who pastes their own URL hands out write access; `/board status` prints the page,
  not that URL.
- **Nothing prunes.** A `done` card stays until someone drops it; the page shows
  how many bytes the store occupies.
- **A page claim is the seat's claim.** Two browsers on one page are one owner, and every
  browser that can reach the lead's URL writes as the same seat.
- **The page stops a minute after its last tab leaves.** Closing the tab to run a
  command and coming back is fine, and a teammate's watching tab counts as one, so a
  page nobody is reading does not answer a port for the rest of the session. `/board`
  starts it again on the same port.
- **The note is believed only while it answers.** A page that crashed leaves its note
  behind; the next `/board` probes it, takes it over when nothing replies, and attaches to
  the page that won when two sessions start in the same instant. A note it cannot read at
  all is named with its path — "another session is serving" is only said of a page that was
  seen answering.

## Pi integration

- **`session-bus`**: a card's owner is the bus label, so a card names a session a
  peer can be addressed by. The board calls one thing on it — the join, through
  `lib/session-tool.ts`, because a command context cannot call a tool and the request
  therefore travels on `pi.events` — and reads its records otherwise, which is why the
  page works with the bus disabled. A failed join is a clause on the `/board` line, not
  a failed page. The seat is a different actor from the session that serves it, which is
  why `/board status` names both.
- **`plan`**: `board plan` records a plan file's path; the plan extension owns the
  file. The plan is recorded **after** approval, because plan mode makes mutating
  tools unavailable.
- **`todo`**: the approved plan's steps are seeded into `todo`. Steps never become
  cards.
- **`worktree`**: the store is keyed by the repository's common git directory, so
  every worktree shares one board.
- **`bytefly`**: the page's port appears as a `board` status chip, and `doctor`
  reports nothing new — the board needs no binary and no config.

## Design notes

- **One JSON file per card**, in `<agentDir>/board/<repo-key>/cards/`. The listing
  is the index, so a reader needs no cache and no daemon.
- **Create is exclusive**, by hard-linking a temporary file onto the target name,
  so two adds cannot share an id. **Update** re-reads, re-checks the operation's
  own preconditions, then renames over the old file: an operation means "apply when
  this holds", never "force this state".
- **The page is a dumb renderer** over one snapshot built on the server, pushed
  only when a card's revision moves.
- **One page is found, not configured.** A note beside the cards carries the port, the
  seat, and a read-only token; it is created exclusively, so two sessions starting at
  once cannot both serve, and the loser attaches to the winner. The alternative —
  a setting that names the lead — was rejected: the role moves, the seat's name does
  not.
- **The new card is a dialog, not a fixture.** The page opens on the board, and an
  empty board leaves its own explanation in place rather than covering it with the
  dialog — the empty state's **Add the first card** is what opens it. A card
  is something you ask to write. It is the kit's modal, so `Tab` stays inside it and
  closing returns focus to the button that opened it; a draft survives `Esc` or a
  backdrop click, and `Cancel` is the one way to throw it away.
- **One edge, stored once.** A link is one id in the waiting card's file and the
  reverse edge is computed over the board, because a `blockedBy` copy of the same edge
  is a copy that drifts; the cycle check and the drop rule are what keep the graph
  whole instead.
- **A priority is a field, not a lane.** The four lanes are the board's vocabulary and
  a fifth would double the counts and the heads; inside a lane, priority then age is the
  order, and a card says its priority only when it is not the ordinary one.
- **`edit` leaves an omitted field alone.** It is the one action whose job is "make it
  say this", so an absent field must mean "not this field" — otherwise the page, which
  shows no links, would clear every link it saved.
- **Rejected:** steps as cards (they flood the board), a shared database (a file per
  card needs no dependency and no lock), an index file (every write maintains it,
  every read can find it stale), drag-and-drop (a lane change is a named `move`), a
  priority lane (four lanes are the vocabulary), and a reverse `blockedBy` field (two
  copies of one edge).

## Files

| File | Responsibility |
|---|---|
| `index.ts` | The factory: gate on `PI_DISABLED_EXTENSIONS`, build the runtime and the page, register both, close on shutdown |
| `runtime.ts` | Which store a call uses, and who it writes as |
| `schema.ts` | The tool's parameters |
| `tools.ts` | Action dispatch and the refusal shape |
| `input.ts` | A card body as both surfaces read it: the `add` fields normalized once, so the tool and the page cannot disagree |
| `format.ts` | The model-facing text |
| `rows.ts` | The transcript row grammar |
| `result.ts` | The transcript block |
| `page.ts` | The page's lifecycle: the port it remembers, the chip that names it, and the three closes — `/board stop`, the idle grace, and shutdown |
| `snapshot.ts` | The page's snapshot: the cards, the bus's records, and the store's size, handed to `buildView` |
| `writes.ts` | The page's write path: one request to one store call, 422 for a field and 409 for a card somebody else moved |
| `commands.ts` | `/board`, its three words, and the one line `/board status` prints |
| `seat.ts` | The seat the page serves as: one name, and an id derived from it, so the page is one actor across restarts |
| `transport/router.ts` | The routes, what a credential may do, and the guards in front of them |
| `transport/server.ts` | The loopback listener, the frame push, and the close |
| `view/page.ts` | The document: an inert shell the client fills |
| `view/styles.ts` | The page's `board-*` layout rules |
| `view/render.ts` | The client's snapshot → DOM renderer: toolbar, lanes, cards, the dialog's contents |
| `view/team.ts` | The client's round: the two tables and the Done line |
| `view/actions.ts` | The client's writes and its two kit dialogs |
| `view/keys.ts` | The key table, and the bindings that make it true |
| `view/live.ts` | The client's tabs, new-card dialog, filter, and frame stream |
| `view/client.ts` | The one script served at `/app.js` |

The store, the rules, the rollup, and the snapshot are `lib/board/` — see
[`lib/README.md`](../../lib/README.md).

## Testing

`test/suite-manifest.ts` declares the suites:
`lib/board/{card,links,page-pointer,round,round-text,rules,session,store,view}` for the
record, the dependency graph, the note a page leaves, the rollup and its text, the
lifecycle, the store, and the snapshot, and
`extensions/board/{input,seat,tools,page,commands,extension,transport/router,view/pages}`
for the card body, the seat, every action, the page's lifecycle over a real socket (a page
served, attached to, taken over, and refused to a viewer), the command, the factory, the
routes, and the document and client bundle.
