# board — one shared feature board per repository

Every Pi session on a repository reads and writes the same cards, and the same
cards are served as a live page in your browser. A card is one **feature**: its
outcome, who holds it, where the work happens, the plan it is executing, and the
notes that explain how it got there.

The steps of the work are deliberately *not* on the board. They live in the
owner's plan and in `todo`; the board answers who is doing what, and what needs a
decision.

<img src="../../assets/screens/board.png" alt="The board page: a toolbar with the serving session, a live badge, Board and Team tabs, done-of-total progress, a filter and a New card button; four lane trays, each with a dot, a count and a fold control; and cards carrying an owner chip, path hints, a reason line and their actions" width="100%">

*`/board`: the four lanes, with the composer above them and the round one tab away.*

## Capabilities

| Capability | How | What you get |
|---|---|---|
| A shared feature list for one repository | `board` action `list` | Every card in lane order — `todo`, `doing`, `blocked`, `done` — or one card, or one lane |
| The lead's rollup | `board` action `list` with `round: true` | Owners and their live cards, then unassigned, unplanned, blocked, idle, and done |
| Publish a feature | `board` action `add` | A `todo` card with path hints and a first note |
| Take a feature | `board` action `claim` | The card is `doing` and owned by this session |
| Hand it back | `board` action `release` | The card is `todo` again, with no owner |
| Change lane | `board` action `move` | Wherever the owner moves it: `doing`, `blocked`, `done` |
| Record what happened | `board` action `note` | A note appended to the card's history, attributed and stamped |
| Record the plan | `board` action `plan` | The plan file the card is executing, so "unplanned" work is visible |
| Delete a card | `board` action `drop` | The card and its notes are gone; nothing else ever deletes one |
| A live page for the same cards | `/board` | A loopback page with a **Board** tab and a **Team** tab, following the store live |
| See the lead's rollup at a glance | `/board team` | One panel per owner, then unassigned, unplanned, blocked, idle, and done |

## Quickstart

```
you:  publish two features for the billing work
      → board add "Billing webhook accepts orders" paths ["src/billing"]
      → board add "Retry branches merge cleanly"
peer: claim the first, plan it, note the phases, finish it
      → board claim 1 → /plan → board plan 1 <plan file> → board note 1 … → board move 1 done
lead: board list --round
      → 1 owner · 2 features · 1 unassigned · 0 unplanned
```

`/board` opens the page. `/board team` opens it on the Team tab, `/board status`
prints the port and whether the page is running, and `/board stop` closes it.

## Tool

`board` is one action-shaped tool. `readOnlyHint: false`, `destructiveHint: true`,
`openWorldHint: false`, `executionMode: "sequential"`.

| Action | Parameters | Result |
|---|---|---|
| `list` | `status?`, `card?`, `round?` | the cards in lane order, one card, or one lane; `round: true` adds the rollup, which always covers the whole board |
| `add` | `title`, `paths?`, `note?` | the new `todo` card |
| `claim` | `card` | the card, now `doing` and owned by this session |
| `release` | `card` | the card, back in `todo` |
| `move` | `card`, `status` | the card in its new lane |
| `note` | `card`, `text` | the card with the note appended |
| `plan` | `card`, `path` | the card with its plan recorded |
| `drop` | `card` | the id that was dropped |

`card` takes `4` or `#4`. A refused call is an error result that still carries the
card, so the next attempt starts from the truth.

## Commands and flags

| Command | Effect |
|---|---|
| `/board` | Start the page on a session-fixed port, open the browser, and name the port in the status line |
| `/board team` | Open it on the Team tab |
| `/board status` | One line: the port and whether the page is up |
| `/board stop` | Close the page |

## Routes

Every route needs the page token; a write is made as the serving session.

```
GET    /                     the document (?view=board|team&card=4)
GET    /app.js               the client script
GET    /api/board            the snapshot
GET    /events               the live frame stream
POST   /api/cards            add a card
POST   /api/cards/:id/…      claim, release, reclaim, move, note, plan
DELETE /api/cards/:id        drop a card
```

## Layout

One page, two tabs, one lifecycle. The kit shell keeps the toolbar and the footer
pinned and makes the main pane the only scroll box; the page adds no second one.

| Band | What it holds |
|---|---|
| Toolbar | the mark, the serving session as a chip, a live badge (`connecting`, `live · 3m`, `reconnecting`), then one group: the Board\|Team switch, done-of-total progress, a filter, **+ New card**, the keys button, and the theme toggle |
| Composer | a drawer the toolbar's button (or `n`) opens: a title, space-separated path hints, the hint line, `Cancel`, and **Add card**; it stays open after an add, so a lead can publish several cards |
| Lanes | trays, not a bare list: four columns at ≥1180, two rows at 1000, one lane plus the lane switch at ≤860. Each head sticks while the pane scrolls, carries its count as a pill, and folds its cards away |
| Cards | the id and a two-line title (the page's loudest text), an owner chip and an age, path chips, one reason line, and at most three actions — `Claim` or `Move` bordered, then `Note` and `Open`. A hovered card lifts a pixel; a finished one recedes, title and owner chip muted |
| Team | a table of owners (`Owner · Cards · Oldest`), a table of cards that need a decision (`Card · Why · Owner` with `Reclaim`), and one muted Done line |
| Card dialog | a meta line, the owner, the paths, the plan as monospace text, the notes as a timeline, a note field, and the lane buttons, `Release`, `Drop`, `Close` |

Colour is a role: `--muted` for `todo`, `--accent` for `doing`, `--danger` for
`blocked` and destructive choices, `--success` for `done`. A card takes its colour
from the lane it sits in — the head's dot, and the reason line's tone — rather than
from a bar of its own, so one card does not shout twice. The page states a lane and
a card with `data-status`, so a theme change repaints it without a rule of its own.

## Keys

| Key | What it does |
|---|---|
| `n` | New card: open the composer and focus the title field |
| `/` | Filter the cards by title, path, or owner |
| `j` / `k` | Next or previous card |
| `Enter` | Open the focused card |
| `t` | Switch Board and Team |
| `Esc` | Close a dialog, fold the composer, or clear the filter |
| `?` | The keyboard sheet |

A dialog traps `Tab`, closes on `Esc` or a backdrop click, and returns focus to
whatever opened it — the kit's `dialogScript`, shared with the review and browse
pages. A field keeps its keys: `n` inside the note input types an `n`.

## Security

- The page binds loopback only, answers only its own host names, and refuses a
  state-changing request another site made.
- The token is 128 random bits minted when the page starts and compared in
  constant time; it is in the URL, never a cookie, and there is no CORS.
- A write is made **as the serving session** — a browser is not an identity — so
  the toolbar names the session and claim/reclaim ask first.
- The page writes only the board store under the agent directory. It never writes
  your repository.

## Limitations

- **Ownership is advisory.** Two sessions can still edit the same file; only
  `session-bus`'s path claims are a lock.
- **The board does not know whether a session is alive.** "Idle" means a `doing`
  card nobody has touched for 30 minutes, not that its process is gone; liveness is
  `session status`'s answer, and the board works with `session-bus` disabled.
- **Nothing prunes.** A `done` card stays until someone drops it; the page shows
  how many bytes the store occupies.
- **A page claim is the serving session's claim.** Opening the page in two browsers
  does not make two owners.
- **The page stops a minute after its last tab leaves.** Closing the tab to run a
  command and coming back is fine; an abandoned page does not answer a port for the
  rest of the session. `/board` starts it again on the same port.

## Pi integration

- **`session-bus`**: a card's owner is the bus label, so a card names a session a
  peer can be addressed by. The board never reads the bus, which is why it works
  when the bus is disabled; `team` is the extension that does, for `assign`.
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
- **The composer is a drawer, not a fixture.** The page opens on the board; a card is
  something you ask to write. Its draft survives an `Esc` that only leaves the field,
  and `Cancel` is the one way to throw it away.
- **Rejected:** steps as cards (they flood the board), a shared database (a file per
  card needs no dependency and no lock), an index file (every write maintains it,
  every read can find it stale), and drag-and-drop (a lane change is a named `move`).

## Files

| File | Responsibility |
|---|---|
| `index.ts` | The factory: gate on `PI_DISABLED_EXTENSIONS`, build the runtime and the page, register both, close on shutdown |
| `runtime.ts` | Which store a call uses, and who it writes as |
| `schema.ts` | The tool's parameters |
| `tools.ts` | Action dispatch and the refusal shape |
| `format.ts` | The model-facing text |
| `rows.ts` | The transcript row grammar |
| `result.ts` | The transcript block |
| `page.ts` | The page's lifecycle: the store, the snapshot, the write path, the chip, and the three closes — `/board stop`, the idle grace, and shutdown |
| `commands.ts` | `/board` and its three words |
| `transport/router.ts` | The routes, the token, and the guards in front of them |
| `transport/server.ts` | The loopback listener, the frame push, and the close |
| `view/page.ts` | The document: an inert shell the client fills |
| `view/styles.ts` | The page's `board-*` layout rules |
| `view/render.ts` | The client's snapshot → DOM renderer: toolbar, lanes, cards, the dialog's contents |
| `view/team.ts` | The client's round: the two tables and the Done line |
| `view/actions.ts` | The client's writes and its two kit dialogs |
| `view/keys.ts` | The key table, and the bindings that make it true |
| `view/live.ts` | The client's tabs, composer, filter, and frame stream |
| `view/client.ts` | The one script served at `/app.js` |

The store, the rules, the rollup, and the snapshot are `lib/board/` — see
[`lib/README.md`](../../lib/README.md).

## Testing

`test/suite-manifest.ts` declares the suites: `lib/board/{card,rules,store,round,view}`
for the record, the lifecycle, the store, the rollup, and the snapshot, and
`extensions/board/{runtime,tools,page,commands,extension,transport/router,view/pages}`
for the wiring, every action, the page's lifecycle over a real socket, the command,
the factory, the routes, and the document and client bundle.
