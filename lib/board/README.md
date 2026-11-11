# lib/board — the shared feature board

A board is one file per feature: what the feature is for, what it promises, why it sits
where it does, and the two signatures a person gives it. The `board` tool, `team`'s round,
and the served page read and write those files through this directory, and no surface may
decide one of their rules for itself.

What belongs here rather than in `extensions/board/`: the record and the boundary a read
passes, the lifecycle that decides who may do what, the store that is the only writer, and
the bodies every surface renders. The extension keeps the tool, its schema, its commands,
its transport, and the browser bundle, which receives `view.ts`'s snapshot as its data and
the spliced rules below as its source. The user-facing contract is
[`docs/extensions/board.md`](../../docs/extensions/board.md); the decisions behind these
rules, with the conditions that would revisit them, are
`AGENTS.md` for the rules, and the code for the limits it states.

Each module below owns one paragraph: what it is, and the couple it must not drift out of.
The one-line index of the same modules is the `board/` block of [`../README.md`](../README.md).

## The record and its boundary

### card.ts

The shape one card file holds, the caps a write is held to, and the parser that decides
whether a file on disk is still a card. `CARD_VERSION` with `SUPPORTED_VERSIONS` and
`ENDED_VERSION` say which builds wrote what; `Card`, `CardOwner`, `CardNote`,
`CardBlock`, `CardTransition`, `CardLanded`, and the `EndedCard` a finished card becomes
are the record, and `MAX_TITLE` / `MAX_PATHS` / `MAX_PATH` / `MAX_PLAN` / `MAX_NOTE` /
`MAX_NOTES` / `MAX_LOG` / `MAX_DEPENDS` are its caps. Ownership, priority
(`PRIORITIES`, `DEFAULT_PRIORITY`, `priorityOf`, `priorityRank`), and the `BLOCKERS` a
block names, with a 200-char reason, are part of the same record, so a lane's `ownerless`
invariant can be read off the lane table rather than restated.

The `normalize*` boundary is what the model's arguments pass: `normalizeTitle`,
`normalizePathHints` (repo-relative hints, never claims), `normalizeNote`,
`normalizePlanPath`, `normalizePriority`, `normalizeCardId`, `normalizeBlock`. Each answers
`{ error }` instead of throwing, because a bad argument is a refusal a reader can act on.
`isCard` is the shape every read is held to and `isEndedCard` the older finished record —
`read.ts` maps a past shape onto this one, so the router, the tool, and the page see the
same record or none.

Three rules live here because two surfaces need each and a second copy would be a second
answer. `matchesQuery` is the rule `list`'s `query` and the page's filter box both answer,
spliced into the bundle as `MATCHES_QUERY_JS`. `holds` (the id decides when both sides have
one) with `cardRef` and `signatureOf` names a card and notices it changed; `dependsOf`
reads a card's own links. `laneSince` says
when the card entered the lane it is in, computed from the lane log because a stored clock
would be one more field to keep true.

### kind.ts

What kind of work a card is (`type`) and whether it breaks an existing user (`breaking`),
the two facts a changelog line answers. `CARD_TYPES` is the closed table — feature, bug,
refactor, docs, test, chore — and `normalizeType` refuses anything else rather than defaulting
to a kind nobody chose, so an unclassified card draws nothing. `normalizeBreaking` takes a
boolean and `breakingOf` reads an absent marker as not breaking, because the record writes
the key only when it is true. Both fields are optional, so a card written before the kind
existed is still a card; `card.ts` holds the two keys and imports the type, which is why this
is its own module rather than four more rules in that record's row.

### read.ts

The one gate a card file read passes. `readCard` maps every version this build can read
onto the current record — a v1 file's `status`, `plan`, and `blockedBy`/`blocker` become
`lane`, `planPath`, and `blocked`, and the four-lane log's `todo` / `doing` become
`backlog` / `execute` — then stamps `CARD_VERSION`. The map is read-time only: no file is
rewritten, so a board full of older cards reads as a board rather than as a pile of
refusals, and each card takes the new shape on its next write.

### lanes.ts

The lane vocabulary as data, and the one table that decides what each lane means.
`LANES` / `Lane` (backlog, plan, execute, blocked, done) and `LANE_RULES` carry each
lane's label, its empty word, its colour role, and the three facts the rest of the board
reads off it: `ownerless` (the pool), `terminal` (finished), `pulled` (held to a WIP
limit). The page receives the table in its snapshot and the tool's schema is generated
from `LANES`, so a lane cannot be spelled one way in a schema and another in a renderer.

`TRANSITIONS` is the other half: every lane change a move may make, with the
`Requirement`s (`REQUIREMENTS`: contract, approval, review, artifact, blocker, waiting) in
front of it. `steps.ts` enforces them, and `transitionOf` / `targetsFrom` are the same table
asked about one move — `targetsFrom` is the list a refusal prints. The tool's `lane`
description names `movableLanes()` instead: which targets exist depends on the card's own
lane and a schema has no card, so it offers every lane but `backlog` and leaves the route to
the refusal. `laneIndex` and `isLane` are the questions left.

### contract.ts

What a card promises before it may be executed: `Contract` (goal, acceptance, scopeOut,
and the `Sign` that approved the wording), `CONTRACT_FIELDS` / `MAX_CONTRACT`, and the
boundary `normalizeContractField` applies to one line of a model's argument. The plan file
says how; the contract says what and why, so a session that picks a card up does not
renegotiate it and one that finishes it can be checked against something it did not write.

The sign is part of the contract because it is a statement about *this* wording:
`mergedContract` drops it when an edited line arrives, and `missingContractFields` /
`contractComplete` / `contractApproved` are the gate `steps.ts` asks. `normalizeInstruction`
is the one line an overriding sign says why, which `isSign` and `isContract` also hold a
stored value to.

### links.ts

The dependency graph, answered over an index of the whole board. A link is one id in the
waiting card's own file — the reverse edge is never stored, because a second copy of one
edge is a copy that can drift. `BoardIndex` / `indexOf` build the map; `blockersOf` says what
is unfinished, `lanesText` is a card list as a reader meets it (`#2 (execute), #3 (blocked)`,
with `titles` for the one surface that has room for a title), and `waitingOn` is the same
unfinished list as one sentence. `dependentsOf` / `openDependentsOf` / `dependedOn` say what
a drop would strand or block, `wouldCycle` refuses a loop, and `normalizeDepends` stores one
edge once. A dependency naming a card that is not on the board is refused when it is written,
and a card cannot be dropped while another waits on it.

### limits.ts

How many cards a pulled lane may hold, and the sentence that refuses the next one. The
board is a pull system whose binding constraint is the person who approves and spot-checks,
so `plan` and `execute` are gated rather than advised. `WipLimits`, `DEFAULT_WIP` (3 and
5), `MAX_WIP`, and `normalizeWip` over `clampInteger` turn the settings into numbers, so a
typo cannot stop a board; `limitOf` / `countIn` answer a lane's `Requirement`; and
`wipRefusal` names the count, the limit, and the ways out.

The arithmetic only: where the numbers are read from is `config.ts`, which hands them to
`applyOp` whole so `rules.ts` stays pure.

### artifact.ts

Whether a path is a plan of this repository, which is the one thing the board asks of the
plan store. `PlanArtifact` is the resolved path that was proved and `ArtifactCheck` is that
path or the sentence refusing it — one fact for the state machine to order. `planForContract`
requires a `.md` this repository's store holds whose file is there; `planForExecute` requires
the recorded plan to still be there, named with the card and `contractRoute` as the way out.
The path rules come from [`../plans/paths.ts`](../plans/paths.ts), so the board and the plan
tool cannot disagree about what a plan path is; the board still never reads a plan.

## The lifecycle

### rules.ts

The card lifecycle as a pure function of the card, the operation, who asked, the clock, the
other cards, and the board's limits. `Actor`, `CardOp`, and `createCard` define the inputs;
`mayOp` is the same decision without the write, which is what `team` asks before it sends a
handoff — a dry run is a question, not a mutation performed as a fake session; and `applyOp`
is one switch over the card *and* the board index, so a lane change cannot be reachable from
one surface and refused from another.

The one write bumps the revision, appends the lane log, and clears what the lane
left behind. Two shapes of failure matter here: a refusal is `{ ok: false }` with its reason
and the card untouched, while a no-op is `{ ok: true, changed: false }` — the preconditions
already hold, so nothing is written and the revision does not move. Nothing here touches the
filesystem or the bus: ownership is advisory, and the store owns the compare-and-set that
makes a concurrent writer lose.

### steps.ts

What each operation a card alone can decide does — the gates, the lane changes, and the sentence
a refusal carries — split from the table that dispatches it so the dispatch reads as one switch
and the rules read as one decision per operation. `claim` pulls a pool card into `plan`; `assign`
hands one over and moves only a pool card's lane; `release` returns it; `move` walks
`TRANSITIONS` and asks every gate; `contractOp` writes the three lines and the plan path;
`approve` / `review` record the two human gates, both refused to the card's own holder, and
`review` also signs a card already in `done` when an override gives the one line saying why;
`note` / `edit` / `offer` / `archive` / `drop` keep their own rules, and a drop is refused
while something waits on the card.

Each answers a `Prepared`: a refusal sentence, a no-op, or the fields a write would apply.
`{ fields: null, changed: true }` is the one operation that changes the board without
changing the record — `archive` moves the file, and that is the store's write.

### reclaim, in lead.ts

The one operation `steps.ts` cannot hold, because its gate reads a fact the card does not carry:
whether the session holding it is still running. A session takes its own card back (a release by
another name), the lead takes anybody's, and a peer takes one only from an owner whose record says
it stopped — `quiet` or `gone`. `absent` is refused with no fact at all, because a session that
never joined this bus writes no record either. The fact is bound to the owner it was read for, so a
card that changed hands under the read is taken on nothing.

What returns to the pool keeps the notes and the contract, and keeps a spot-check unless the
reclaimer is its signer: the sign is evidence, and only the person who made it withdraws it. It
lives in `lead.ts` because that module already answers who may act on a card's two gates, and this
is the same question asked of another verb.

### actions.ts

The actions and which of them only read the board, as one table. `BOARD_ACTIONS` /
`BoardAction` is the list the tool publishes, in its description order, and
`BOARD_ACTION_KIND` is a `Record` over every one of them, so an action added to the tuple
does not compile until somebody says whether it reads. `BOARD_READ_ACTIONS` is the same
answer for a reader that has to name the reads, `readActionsText` is that list as the phrase
plan mode's refusal prints, `boardWriteRefusal` is the refusal a write action gets there,
and `isBoardReadAction` answers for one unnormalized value, where anything unknown is not a
read.

One table, so the tool's enum and the read-only policy cannot disagree: `lib/policy.ts`'s
`isBoardRead` and `board`'s own schema both read this one, so a second read action cannot be
admitted by one and refused by the other.

## Storage and identity

### store.ts

The backend: `BoardStore` over `<agent-dir>/board/<repo-key>/cards/*.json`, with `createStore`
and the one construction point `openBoard`. `BOARD_DIR_NAME` / `CARDS_DIR_NAME` and
`boardDirFor` are the layout a caller names, the `ended/` and `archive/` piles sit beside
`cards/`, and `key`
is the hash it was filed under, carried rather than read back off the directory's last segment
because `session-bus` files this repository's records under the same key.

Two writes take turns. `create` hard-links a temp file onto the name, so two adds cannot share
an id and the loser retries with the next one. `mutate` takes the board's write lock, re-reads the
card and the board, and renames over the old file — a write says "apply when this holds", never
"force this state", and the lock is what keeps a peer's write from landing between the check and
the rename. The lock is the board's because the questions a check asks are about other cards: has
this lane a slot, would this link close a loop, does anything wait on the card being dropped.
`scan` is one pass answering the cards,
the files it refused (`Skip`), and the bytes they occupy, so a page's frame reads the board
once; `list` and `skipped` are its two halves, and `list` orders a lane by priority then id.

`archive` renames a finished card's file into the `archive/` pile beside the cards without
rewriting it, so `read` finds a card in either pile while `list` still reads the board alone —
and only the board's pile is writable: `mutate` hands `applyOp` the place it found the card
(`Place`), and every operation but `drop` is refused there. `archived()` / `archivedCount()` are the pile on request
and its count, a number spent by an ended or archived card is never handed out again, and nothing
prunes: `archive` and `drop` are the two ways a card leaves the board.

### lock.ts

The board's write lock: `lockBoard` creates `<board>/.lock-board` exclusively, waits
`LOCK_WAIT_MS` for a live holder, takes over a lock older than `LOCK_STALE_MS` — a holder needs
one board read and one rename, so a file still there seconds later is a process that died inside
its window — and hands back the `release` that clears it. `lockPathFor` is that one name, shared
by every writer whichever pile the card it touches lies in.

The exclusive create is the decision, not a read before it. `release` removes a file only while it
still carries its own token, so the victim of a takeover cannot open the board to a third writer.
The unit is the board, not the card — `mutate` reads the whole board, so a per-card lock let two
writers answer one rule from two snapshots, a rule passed twice rather than a file overwritten —
and `concurrency.test.ts` is that pair. `create` takes none, and neither does a read.

### config.ts

The `board` section of `bytefly.json`, read once: `BoardConfig` (`wip` and `lead`),
`DEFAULT_BOARD_CONFIG` / `DEFAULT_LEAD`, `normalizeBoardConfig` — each key falling back on
its own, so a file
that sets one keeps the other — and `readBoardConfig`, the project's section over the global
one. Both are read together when the store opens, because a board that asked the file on
every write would spend a stat to answer a question nobody changed.

The arithmetic of a limit stays in `limits.ts` and the signer rule stays in `lead.ts`; this
module is the file. `extensions/bytefly` imports it too, so the settings screen shows what the
loader keeps rather than a copy of the default.

### session.ts

What a board call works on and who it writes as: `BoardSession`, `TeamStanding` — what the
last join did, so a claim joins and `/board status` can say — and `openBoardSession`. One
store per working directory, opened on first use and remembered, because the repository
lookup shells out to git; a failed open is not remembered, so one bad read does not outlive
the call that hit it. The identity is the pair a card records: the Pi session id, which keeps
a card held across a rename, and the name the bus already holds for it, else the id-derived
one.

One session per *host*, not one per extension: `board` and `team` load with separate module
caches, so two sessions would mean the seat `/board` sets is invisible to every write `team`
makes. That state lives in the closure, never in a module variable, and `busDirFor` builds the
bus's directory from the key the store carries, so the roster cannot be moved by regrouping
the board's own files. `roster(cwd)` is the one read of the records the bus files there —
`who` asks it for a name, the join for the record that decides the ask, the rollup for the
owners it folds, and `/team` for who is here — so no caller re-derives a directory or a parse,
and a failed read is the caller's to report. `planDir(cwd)` is this repository's plan store through
[`../plans/paths.ts`](../plans/paths.ts), which is what a card's plan file has to be inside.

### join.ts

The one join every door asks for, so a claim through `board` and one through `team` cannot
answer it differently, and neither can the page. `JoinSession` is the standing, the clock,
and the roster — all the rule reads — and `joinTeam` asks while the roster holds no `live`
record under the name being asked for: a standing stays true after the bus stops, the TTL
prunes the record, or `/resume` takes the seat over, so a claim that trusted it would write
a card under a name peers no longer resolve, while a page opening on a session the bus holds
as a teammate renames it to the seat. The record decides and the standing only fills in when
the roster cannot be read — a session joined through `/session join` never asked a board door,
and it is still on the team — and the record has to be this process's own: two panes opened on
one session id write one record each, and the other pane's watch is not this one's, so a door
here asks and arms its own. The ask repeats the watch the record names, so a rename keeps a
`join({listen: false})` and a wake the session had, and a failed join never undoes the card it
came after — a bus that is not loaded is a sentence, not an exception. The ask is recorded
here, and `TeamState`/`standingOf` hand the line its words; `teamStatus` prefers the live
record too, and prints no team once the bus no longer holds the session, because a name no
peer resolves is worse than no name at all.

### seat.ts

The seat a page is served as: `SEAT_ID_PREFIX` (`board:`) and `pageActor`, the actor a page
reads as. A page outlives the session that opened it, so it needs one name for its whole
life and one id derived from it, and the name is `board.lead` because the two questions have
one answer: the page belongs to the lead, and serving it is how a session becomes the lead.
The name arrives normalized by `config.ts`, so there is no second label rule here and no
default name — a constant would be a second answer to what the config already says. The page
writes nothing, so the id decides no ownership.

### lead.ts

Who may sign the two gates, and the words each refusal uses. `Lead`, `normalizeLead` over
[`../session-label.ts`](../session-label.ts), `isLead` (a case-insensitive label compare,
which is not `holds`), and the person at the keyboard — `PERSON_LABEL` (`you`),
`personActor` / `isPerson`, whose actor carries the id `person:you` — which is the actor
`/board approve` and `/board review` write,
and the one actor a file can name that is not a holder, so a repository worked by one session
can still close a card.

`signOf` names the two signs, `approve` and `review`, from one list; `signRefusal` (not the lead), `holderRefusal` (a
lead holding the card it means to sign), and `missingSign` (the sign a lane requires) are the
three sentences, so the gates and the lane requirements cannot drift into four versions of
one rule. `askLead` is the table's one phrase for how a session asks (`session send`),
`signedText` is what a sign sends the owner, and `notToldLine` is what the caller prints when
that message did not go.

## What a surface renders

### round.ts

The lead's rollup computed from the cards alone: `buildRound` with `RoundSummary` /
`RoundGroup` over owners, unassigned, unplanned (a contract still missing a line, or a plan
never recorded), unapproved, unreviewed (every card in `execute` until somebody has
spot-checked it, so the second gate is owed from the lane change rather than from a clock),
blocked, unwritten (`UNWRITTEN_MS`, half an hour), and done. It reads nothing but the cards,
so the board works with `session-bus` unloaded; a session that is merely idle is a bus fact
this rollup never reads.

The groups overlap on purpose: a card can be both `unplanned` and `unwritten`, and `unreviewed`
and `unwritten` say different things — one that the lead owes a look, the other that nobody has
written the card. Hiding it in one group would lose half the reason to look. `archivableOf` is
the finished pile `archive` is offered.

### round-text.ts

That rollup as the lines a reader gets, because `board`'s tool returns them — the model's next
decision is taken from the counts and the ids — and `team`'s `/team` prints them, because a
lead in a terminal should not have to open a browser. `formatRound` folds the owners a bus has
no record of and that hold nothing into one line, given the roster, and counts the closes made
by instruction on the done count. `plural` and the fold's own bodies (`isHistoryOwner`,
`historyLine`) are spliced into the page as `PLURAL_JS` / `HISTORY_OWNER_JS` / `HISTORY_LINE_JS`;
the page's filter rule and the card face's reason arrive the same way.

The same module carries what a session is holding — `holdingOf` (`#162 plan`, `#162 plan +2`,
or `idle`) and `holdingLine`, which is the label and its holding as one sentence, received by
the page as `HOLDING_OF_JS` — so `/team`'s presence line and the Team tab's teammate row say
what a named session is doing from one body.

### skipped.ts

The sentence for the card files a board refused. A skipped file is not an absent one: a board
written by a newer build, or a record this build cannot trust, would otherwise read as "nobody
has planned anything" while the work sits on disk. `skippedText` prints it under a listing and
the page prints the same sentence on the footer's hover title, so the two name the same files.
`Skip` is the store's own record, already phrased for a reader.

### view.ts

The page's snapshot — `buildView` answering `BoardView` (lanes, each carrying its words,
colour, limit, and count, the total, the rollup, the signature, the repository's name and
root, and the store's path) — and the one shape a client is allowed to know. Each card arrives
as a `ViewCard` carrying the priority it acts on, the moment it entered its lane (`since`), and
`waits` when something unfinished blocks it, so the browser renders an answer instead of
re-deciding one. `sig` is what makes a push cheap: the page is re-sent only when a card's
revision moved, a teammate's state did, or the rollup's clock pushed a card into `unwritten` —
a membership time alone decides has to be in there, or the tab keeps a frame that is no longer
true. A client cannot invent a state the model surface would not report.

### page-pointer.ts

How a second session finds the page a repository already serves. A page is one loopback server
owned by one session's process, so the only thing discoverable is the note it leaves at
`PAGE_FILE` (`page.json`): the port, the seat, and the token the page reads by — nothing a
reader could misuse, since a page writes nothing. `PagePointer` is that note as a record and
`urlOf` the address it answers at; `PING_PATH` / `SNAPSHOT_PATH` / `BOARD_BASE`
are the routes the router serves and the probe asks for; `probePage` is the question "is it
still there", with the network as a seam so a test drives it.

Two rules make the file safe to trust. It is created exclusively by hard-linking a temp file
onto the name (`createPointer`), so two sessions starting at once cannot both believe they are
the page — the loser reads the winner's pointer and attaches. And it is believed only while it
answers: `settlePointer` runs the ladder — write, attach to a winner that answers, take over a
note proved dead — and `readPointer` / `clearPointer` (its own note only) leave an unreadable
note named rather than blaming a session.

### tone.ts

What colour a board surface wears, stated once, because the page and the terminal both need
it and two statements drift apart. `BoardTone` is the page kit's own colour words plus `dim`,
so a tone is the name of a CSS property and the page needs no map; `BOARD_TONES`, `REASON_TONE`
(every reason kind, `waiting` included because the card face invents it), and
`DECISION_KINDS` / `DECISION_TONE`, the Team queue's kinds in rank order with the tone each
wears, so a row's position and its colour cannot disagree. The rule behind the words: warn is
a person who must act next, danger is a refusal or a loss, and anything merely true of the
card is muted.

`DECISION_RANK_JS` / `DECISION_TONE_JS` / `REASON_TONE_JS` are those tables as the browser
bundle's own source, spliced in like every other rule the page shares. The terminal's
vocabulary is not here: `extensions/board/tone.ts` maps a tone to a `TuiRole`, because only the
transcript speaks it.

### reason.ts

Why a card sits where it does, as one rule for the card face, the lead's queue, and the
transcript. `REASON_KINDS` is every kind there is, and `reasonFor(card, ago)` answers a
`Reason` — a `ReasonKind` and one sentence — for
an unanswered offer, a blocked card's recorded reason, a contract's missing line, an approval
nobody gave, a spot-check nobody did, and a finished card's commit. The card face, the lead's
queue, and the transcript read this one body, because the states it names would otherwise be
three sentences that drift.

The offered sentence is the one reason that carries an age, so it answers `at` and `wording`
(a `{age}` template) beside its `text`: the page stamps those instead of writing the sentence,
and its one ticker keeps the line true without a frame. `text` stays the snapshot a transcript
line and a tooltip read.

`REASON_FOR_JS` is why it is self-contained: it reads the card and a formatter for relative
times and nothing else, and the clock is a parameter because the two callers read an age
against different nows — the page's against the reader's, the transcript's against the
snapshot's.

## What must not drift

- **One writer.** `store.ts` is the only code that writes a card file; a rule that seems to
  need a write belongs in an operation, and the store applies it with a re-read.
- **One action table.** `actions.ts` answers both "what may be called" and "what only reads",
  and `lib/policy.ts` reads it rather than keeping a list.
- **One lane table.** `lanes.ts` decides a lane's words, colour, ownership, and the moves out
  of it; the tool's enum, the page's snapshot, and `steps.ts` all read it.
- **One body per page rule.** Anything the browser bundle needs is a `*_JS` export here,
  spliced in by the extension's bundle — never a second copy written in JavaScript.
- **One set of sign words.** `lead.ts` owns what each refusal and each sign says, so the two
  gates and the lane requirements that ask for a signature cannot drift apart.
