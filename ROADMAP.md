# Roadmap

What this pack is trying to become, and the next work that gets it there.
Derived from [`README.md`](./README.md), the limitations each extension already
documents, and the history in [`CHANGELOG.md`](./CHANGELOG.md). Items are
proposals, not release commitments; the changelog is the record of what shipped.

This file describes the tree, not the last tag. It is re-derived from
`git log <last-tag>..main` at each review, so work that has landed but has not
shipped yet is already part of what it describes, and an item stays listed until
the review that removes it.

## North star

Pi's core is small on purpose; this pack is the layer that makes it deliberate.
One sentence is the end state: **what the pack promises, it either does, names as
a limitation, or reports from `doctor`** — so nobody has to guess which of the
two they are reading.

The README's promises — plan, delegate, isolate, remember, reach — are that
sentence's content, and the ledger below tracks each one. The breadth is already
there (see *Where we are*); the next stage is not more of it, but that every new
surface arrives with its limitation written in the same breath.

## Where we are

- 22 extensions, 4 packaged skills, 2 themes, one shared `bytefly.json`.
- Foundations that hold: no build step, no fork, every extension optional,
  three-OS CI, a shared `lib/tui/` and `lib/web/` design system, budgeted prompt
  context, and package-level guards that hold the docs, the catalog, the release
  window, and this file to the tree.
- The last tag is `0.21.0`. `0.18.0` shipped the body the review before this one
  listed as pending: `session-bus` with its live board, plans split
  into a team at approval, reviewer links that follow the plan file live, the browse
  page's `path:line` reference copy, one loopback server lifecycle in `lib/http/` so
  no served page owns a socket of its own, and the daily loop's structured fetch and
  update action.
- `0.19.0` withdraws that team of sessions — the `session join` that claimed a
  unit's paths, the shared-file rule, and the `parallel-dev` skill — because a lead
  who cannot start a peer's turn spent more of the user's attention than the split
  saved. The round comes back without that premise: `board` is a per-repository
  feature board that any session reads and writes, served as a page that follows the
  store live, and `team` is the lead's three bus-dependent actions over the same
  cards — `assign` hands one to a session that is already running, `offer` hands one
  to whoever is free, and `reclaim` takes one back — so a handoff is a message and
  never a launch. It adds outbound images, two peers' turns at once, and the notice a
  close sends when it abandons a turn; moves every extension doc to
  `docs/extensions/`, capabilities first; fits the browse page to a phone; names the
  `changelog` skill `project-docs` and gives `refactor` an inventory script; and makes
  the memory store notice a same-size edit inside a millisecond.
- The window since `0.19.0` has closed four limits this file listed: the board page
  is a reader — it draws a view and offers nothing it cannot do, and plan mode admits
  `list` alone; a session or a teammate whose process is gone reads `gone`, and its
  paths and cards come back at the next call; a dropped card leaves a record and its
  number is never reused; and a model nobody can price is named with the
  `price.rates` key that would price it. It also gives every doc count a test, gives
  every served page the brand mark and a tab title that names its subject, and says
  `no commits` for a worktree that has not committed since it was created. The tag
  this bullet names is checked against the newest one by `test/roadmap.test.ts`.

## How items are ordered

1. **Make a promise true.** Fix a place where the README or an extension page
   says something the code does not do, or where a documented limitation can be
   removed.
2. **Never lose work.** A path that can discard a change, a plan, a goal, a
   conversation, or a message outranks a new capability.
3. **Remove a silent degradation.** A missing prerequisite or an unreported
   failure belongs in `doctor` or in the result, not in the moment of use.
4. **Expand reach.** New formats, providers, and integrations come last.

Two rules keep this file honest:

- **An item is deleted when it ships, never ticked.** Re-derive a candidate from
  `git log <last-tag>..main` before promoting it: an unreleased fix can already
  have closed the limitation the README still lists, and a roadmap written from
  the last tag describes a tree that no longer exists. An item the tree
  contradicts is deleted with its reason recorded, not parked as if it were
  still available.
- **`Now` and `Next` hold at most ten items each; everything else is `Later`.**
  A tier is a priority, so a bucket that keeps growing stops being one. Demote an
  item rather than widening the cap.

Every item ships with the same contract: behavior, tests, the extension page,
the catalog and config reference where relevant, a `CHANGELOG.md` bullet, and a
`doctor` finding if it adds a runtime prerequisite. **A number a doc states about
the code is derived by a test** — the settings count is the pattern, and every
count this file or a doc repeats should follow it. TUI work also updates the
screenshots.

## Promise ledger

| README promise | Today | Open items |
|---|---|---|
| Plan, then execute | Strong; one plan store per repository, a step list approval seeds into `todo`, and a review that follows its file | — |
| Delegate and parallelize | Strong; background runs, a local session bus, and a shared board with a lead's round, with every bus limit documented | — |
| Never wreck the checkout | Works, but isolation is best-effort | S1–S2 |
| Remember across sessions | Works; the store reports its own health and notices an edit inside a millisecond | — |
| Reach the web and your files | Broad; formats, remote media, and launch reporting are thin | W1–W4 |
| Optional and upgradeable | Strong; the package updates through Pi's own package manager | C1, F1 |

The last row is a paraphrase: the README says "Everything is optional and
independently toggleable" and "the package upgrades with Pi like any other."
The column is *Open items*, not the `Next` tier, because a ledger row can be
closed by work parked in any horizon.

## Horizons

| Horizon | Question | Exit condition |
|---|---|---|
| **Now** | Does the daily loop feel finished? | Closed by the structured fetch, the update action, the team round, and a doc count every page derives; the next review reopens it with a candidate. |
| **Next** | Does the pack keep what it promised? | `S1` is spiked or demoted, with the reason recorded. |
| **Later** | Is it a platform? | Reproducible releases, benchmarked long sessions, and the expansion decisions made. |

Horizons are priority tiers, not dated commitments. A minor release ships
whatever is ready; this project releases often and treats the changelog, not
this file, as the record of what shipped.

The previous `Now` — a stale-doc sweep, every isolation gap visible in the
session, a named Pi range, and a long-session benchmark — closed with `0.13.0`,
and the one after it — memory's same-tick edit — shipped with `0.19.0`. The
daily-loop question closed with the structured fetch, the update action, and the
team round, so the promise question is the one left; its exit condition still
names `S1`, which sits in `Later`.
The two items that used to head this file are gone for a reason worth keeping:
the provider table would only price *below* Pi's per-model catalog, and the
picker's scope decision is made — themes and prompts stay out, because neither is
a scoped enable list. The update-channel item is gone for the third kind of
reason: the tree contradicts it (see *Chrome and upkeep*). The `lib/` promotion
item went the same way: both modules it named have a second consumer inside
`lib/`, so moving either into an extension would make `lib/` import one.

## 1. Plan and delegate

**README promise:** "Plan, then execute." and "Delegate and parallelize."

**Today**

- `plan`: five tools — `enter_plan_mode`, `write_plan`, `exit_plan_mode`,
  `cancel_plan_mode`, `set_plan_steps` — `/plan` with `list`, `review`, `share`,
  and `cancel`, the `--plan` flag, `Ctrl+Alt+P`, a TUI review, and a browser
  review with inline comments. A review can be shared as one link per person: the
  name a link first posts under is bound to it, the page follows the plan file
  live, and only the owner's own page saves, approves, or closes. Plans live in
  `<agent-dir>/plans/<repo-key>` — one store per repository, keyed by the common
  git directory, so every worktree sees the same plan.
- `session-bus`: one `session` tool (`status`, `send`, `inbox`, `claim`, `release`,
  `join`) and `/sessions`, a live board with Sessions, Inbox, and Claims scopes.
  `join` is the one way in — it puts a session on the bus, names it, and starts
  listening unless told not to — and `wake`, which raises a turn, stays opt-in.
  State lives under the agent directory and is keyed by the common git directory,
  so every worktree of a repository is on one bus; no server starts.
- `subagent`: eight built-in agents, single, parallel, chain, and background
  runs with `/agents`, a per-run deadline, read-only mode, and opt-in
  transcripts.
- `todo`, `goal`, `question`, `job`, `watch`, and `context` keep the loop
  visible, interruptible, and priced.

**Where the promise is thin**

- A shared review reaches one network and one address: there is no tunnel or
  relay, so a distributed team cannot open the link, and a laptop that changes
  network changes its link. A review holds at most eight links, and a reviewer's
  name is a label on a bearer link rather than an account (`plan` page).
- The plans directory is the only index: `/plan list` walks it on demand, there
  is no cross-repository history, and its header reports the footprint of this
  repository's store.
- Approval caps a plan at 50 top-level steps, and a step over 200 characters is
  shortened in the todo list and the approval listing; the plan file keeps the
  full text.
- A subagent's tokens and cost are published for bytefly's `↳` roll-up but
  deliberately never added to the parent session's total, and the roll-up starts
  from zero after `/resume`. Background is single mode only: parallel and chain
  still wait, and a background child is session-owned, so `/tree` does not move
  it and a restart cannot resume it (`subagent` page).
- The bus is one machine and one OS user, with no authentication between
  sessions; delivery is pull-based unless a session arms its watch; a claim is
  advisory, and a claim whose owner's process is gone is released at the next bus
  call while a *hung* owner keeps its paths until the ten-minute TTL; two armed
  peers can ping-pong (`session-bus` page).
- A `watch` match raises its notification or its wake once a running turn
  settles, not in the middle of it (`watch` page).

**Now**

Nothing here is queued: the page stopped writing, so the item that would have given
it more to write was withdrawn with it.

The split that shipped with the review is withdrawn too: a plan is one flow, and a
session claims its own paths.

**Next**

Nothing here is queued either: the store now reports its own footprint.

**Later**

Nothing here is queued: the directory stays the only index, and there is no
cross-repository history to build.

## 2. Keep your work safe

**README promise:** "Never wreck the checkout." and "Remember across sessions."

**Today**

- `worktree`: re-roots the built-in file and shell tools, guards absolute paths
  and shell escapes, and refuses to discard a dirty, committed, current, or
  live-locked worktree; `/worktree` names every isolation gap it could not close.
- `rewind`: one git-ref snapshot per prompt, restore code (whole tree or a chosen
  subset of paths), conversation, or both, with `max` and `autoPrune`, plus a
  `/review` pass over the latest turn's changes.
- `memory`: project and global markdown notes, injected each run, managed
  through `/memory` (add, edit, forget, merge, and move between scopes), with
  `/memory doctor` naming what the cap drops and which pairs the conservative key
  considers equal.

**Where the promise is thin**

- The user's own `!` shell is not re-rooted; it still runs in the main checkout.
  `skipOverrides` leaves the skipped tool unguarded for relative paths. Shell
  escape detection is best-effort, so `eval`, `sh -c`, and command substitution
  are covered only behind `blockUnparsableCommands`, and Windows `powershell` is
  refused rather than parsed (`worktree` page).
- A worktree this package did not create has no recorded fork point, so its row
  cannot say how many commits it has of its own: `list_worktrees` falls back to
  `git branch --merged`, and one that never committed still reads as merged
  (`worktree` page). Prune still refuses such a worktree when it holds work.
- Rewind captures no ignored file; the path checklist needs a TUI, so RPC,
  `print`, and `json` restore the whole tree; hunk selection covers modified text
  files only; `/review` targets the latest prompt's snapshot and refuses while
  plan mode is on (`rewind` page).
- Memory injects a large store truncated with a tail note, `forget` is an exact
  match, one note is one line, and the near-duplicate key is conservative by
  design (`memory` page). A same-size edit is picked up inside a millisecond now;
  on a filesystem whose own stamp is coarser than that, `/memory reload` is still
  the way in.

**Now**

Nothing here is queued: the last item shipped — a worktree that has not committed
since it was created says `no commits` instead of `merged`, so a dirty empty
checkout stops reading as landed.

Cleanup refuses what it cannot verify, the store reports its own health and
notices a same-size edit inside a millisecond, and the remaining gaps are
documented behavior.

**Next**

Nothing here is queued either: both items left are decisions a spike has to earn,
not work that is ready to start.

**Later**

- **S1 — Sandbox spike.** Evaluate `sandbox-exec` (macOS), `bubblewrap` (Linux),
  and a Windows job or AppContainer equivalent behind an optional setting. The
  documented non-goal stands until a spike proves the ergonomics, because it also
  decides what "guarded" means for the user's own shell.
- **S2 — Snapshot visibility.** Surface storage per root and a "keep the last N"
  recommendation. `max` and `autoPrune` already prune, so this is visibility,
  not a new mechanism.

## 3. Reach the world

**README promise:** "Reach the web and your files."

**Today**

- `web-access`: keyless DuckDuckGo, optional SearXNG or Brave, readable fetch
  with paging and `find`, per-hop SSRF checks, and optional PDF.
- `file-browse`: a loopback read-only browser with Markdown preview, a diff view,
  a keyboard-navigable tree, quick open, a `path:12-30` reference copied from a
  selection, a reload hint when the folder changes, and live status streamed to
  an open page, at most eight of them at once.
- `file-read`: in-process PDF/DOCX/DOC/ODT/RTF/XLSX extraction, paged.
- `file-open`: native open and reveal on three operating systems.
- `wechat`: one Pi session per peer, inbound text, images, and files, outbound
  images, remote dialogs, one message per turn, serialized replies per peer, and
  two peers' turns at once with a per-peer dialog channel and a fair slot queue.

**Where the promise is thin**

- `read_doc` has no OCR; its extraction deadline cannot preempt a parser that
  never yields to the event loop; formatting, tables, and images are flattened;
  it reads one file per call, and a legacy `.xls` gets a hint rather than a read
  (`file-read` page).
- Web search quality depends on the provider, and the keyless default returns
  answers and related topics rather than a result list; there is no provider
  failover. `web_fetch`'s extraction is a heuristic rather than a readability
  engine, PDF text needs the optional `unpdf`, and its page cache lives and dies
  with the registration (`web-access` page).
- A browse page's live status patches the rows it already drew: a new file needs
  `⟳ reload`, and subfolders, `/diff`, and `changes` stay snapshots. The server
  has no authentication, and it is loopback-only by design (`file-browse`
  page).
- `open_path` is codemode-exposed and inactive by default; reveal has no native
  Linux meaning; Windows `explorer` can exit non-zero after a successful open and
  a hidden window is undetected, so only "the launcher started" is known
  (`file-open` page).
- WeChat answers two peers at once, and a third waits; there is no group chat and
  no outbound video or voice; a peer must message first; a full-screen
  `ctx.ui.custom` dialog cannot be answered from the phone; and a turn abandoned
  by a close ends in one notice rather than an answer (`wechat` page).

**Now**

Nothing here is queued: `web_fetch` renders JSON, CSV, and XML bodies, so this
section's daily-loop question is answered.

**Next**

Nothing here is queued: the abandoned-turn notice shipped, so a close that cuts a
peer's turn off says so in one line. The rest of this section is a decision.

**Later**

- **W1 — Group chats.** A separate admission and routing model, not a flag on
  the current bridge.
- **W2 — OCR.** Only if a local, dependency-light engine earns its install size;
  otherwise keep the explicit non-goal.
- **W3 — Readability engine.** Replace the heuristic extractor only with a
  measured improvement on a fixture set.
- **W4 — PPTX and EPUB.** Add both to the `file-read` registry using libraries
  already present where possible (`fflate`, `fast-xml-parser`), lazily imported.
  This reverses a documented non-goal; approve before building.

## 4. Chrome and upkeep

**README promise:** the `/bytefly` control center, the curated settings, priced
runs, an update check, and two themes.

**Today**

- Bytefly owns the header, footer, turn rule, notices, tool frame, live working
  row, control center, doctor, notify, price, and update check.
- The control center draws all three sections in one frame: a header rule with
  the attention at its right, one tab row with each section's count, any filter
  chips, and the Global/Project write scope; the body is padded to the tallest
  section so a tab never resizes the dock. Rows are named for the thing itself
  and carry at most one verdict word; at 96 columns and wider the focused row's
  facts sit beside the list, and below that they sit under it. `/` filters the
  rows by text, `!` keeps only what needs attention, `?` prints the key list, `s`
  switches the write scope, and `R` reloads to apply.
- Settings is a shortlist of twelve preferences — ten of them
  `bytefly.json` rows — grouped under Startup, Notifications, Session, and Price
  with each value in one aligned column, including the Theme row and one edited
  amount; every other key is a `bytefly.json` edit. The counts the
  docs state are derived from the catalogue by a test, so a new row cannot leave
  the docs describing an older screen.
- DeepSeek is priced from its published CNY and USD tables, with peak and
  off-peak windows, and a currency the session cannot price names what it left
  out.

**Where the promise is thin**

- The screen covers scalars and booleans only: `doctor.skip` (a list), the
  `rates` table, `price.peak` (a nested object), and the tuning numbers and
  labels that left the screen stay JSON (`bytefly` page).
- The picker manages the `extensions` and `skills` resource types; themes and
  prompts stay with `pi config`, and built-in extensions are not listed.
- The update check asks npm's `latest` for this package's version, keeps a
  fixed 24-hour cache, and prompts only for packages Pi's manager knows about, so
  `pi -e .` and temporary checkouts are not checked; suppressing Pi's own startup
  block depends on host shims a future Pi can invalidate (`bytefly` page).
- Only DeepSeek has a built-in rate table and there is no FX conversion — a model
  nothing can price is named with the `price.rates` key that would price it, in the
  footer, `/bytefly prices`, and one notice — and a `(auto)` or `(sub)` indicator
  cannot be reproduced.
- `doctor` checks declared requirements only, and a probe proves a binary runs,
  not that it works.

**Now**

Nothing here is queued: the unpriced-model item shipped, so the footer,
`/bytefly prices`, and one notice now name the models this session priced nothing
for, with the `price.rates` key that would price them. The published numbers stay
the user's to supply. The control center updates the configured packages through
Pi's own package manager, so this row's remaining surface is closed.

**Next**

Nothing here is queued: the count every doc states is the catalogue's, and a test
derives it from `SETTING_ROWS`, so a fourteenth row fails by naming the file that
did not follow.

**Later**

- **C1 — More currencies.** Generalize the rates table beyond CNY and USD only
  when a user actually needs a third unit.

The update-channel item that used to sit here is deleted, not deferred: the
release path accepts `X.Y.Z` only and publishes to the default `latest` tag, so
no prerelease or tagged channel is ever published, and a preference to select
one would have nothing to select. It can come back only with a release that
publishes a channel.

## 5. Foundations

These are not a README pillar, but every promise depends on them.

**Today**

- One reviewed publish path with provenance, a compat job against the newest
  published Pi, three-OS CI, and package-level guards over the docs, the catalog,
  the release window, and this file.

**Now**

Nothing here is queued: `test/doc-counts.test.ts` now derives the extension, skill,
theme, and tool counts every document states, so a count without a guard is the
exception rather than the rule.

Binding, the accept path, the close path, and idle grace are one server per session:
`serve` owns the socket, each page claims a path prefix on it (`/files/`, `/board/`,
`/plan/<id>/`), and the socket closes with its last page — so a session has one port,
one chip, and one close path, and a page cannot outlive the session it describes.

**Next**

Nothing here is queued: the last flat extension past twenty modules moved into
role directories, so the rule the architecture page states now holds without an
exception.

**Later**

- **F1 — Signed artifacts and SBOM.** Generate an SBOM per release if consumers
  ask; do not add ceremony before then.

## Deliberately left thin

Documented limitations that have no item, so a reader can tell a gap that was
triaged from one that was missed. Each row names the condition that would reopen
it. A limitation an item owns is named in that section instead, never here.

| Limitation | Why it has no item |
|---|---|
| `board`: ownership is advisory | A card names an owner; the lock on a file is `session-bus`'s path claim, and two sessions editing one file is a conflict the board cannot see. Revisit if the board issued claims of its own. |
| `board`: a link is checked when a card is taken and when it is finished | It never re-opens work that finished before the link was recorded, and `done` is terminal, so a dependency cannot un-finish. Revisit if a link must reorder completed work. |

| `board`: assigning without messaging the peer went with the write path | A page assignment recorded an owner and had to say no handoff was sent; `team`'s `assign` messages the peer instead. Revisit if a silent assignment is worth a tool action of its own. |
| `board`: a page stops a minute after its last tab leaves | An abandoned page must not answer a port for the rest of the session; `/board` starts it again on the same port. Revisit if a page must outlive its tabs. |
| `board`: a page's note is believed only while it answers | A crash leaves the note behind; the next `/board` probes it, takes it over when nothing replies, and attaches to the page that won when two sessions start at once, so a dead note costs one probe rather than a second page. Revisit if a note must be reaped by something other than its page. |
| `board`: nothing prunes, so finished cards accumulate | `drop` is the only deletion and the page shows the store's size. Revisit when the store's size is itself a reason to archive. |
| `team`: nothing here can start a peer's turn | A handoff or an offer waits in the recipient's inbox until its next turn, where a listening session reports it; no turn is raised on a peer's behalf, and nothing spawns a session. Revisit if the bus can raise a turn directly. |
| `team`: `to` must be on the team | A session that never opened the board, joined, or claimed a card cannot be handed one, and the refusal names the fix. A card's owner is now its team name, derived from the session id, so a rename no longer strands it. Revisit if a peer can be handed work before it ever joins. |
| `team`: plan mode makes `assign` and `offer` unavailable | The `session` call behind them is a mutating tool, which plan mode refuses; handing work over waits for approval. Revisit if a read-only bus call can dispatch. |
| `plan`: no PowerShell while planning | The read-only shell is Git Bash by design; PowerShell needs a second parser and guard, which is also why the worktree guard refuses the tool rather than parsing it. Revisit with `S1`. |
| `plan`: a browser that never connects waits until the user cancels, closes the tab, or aborts | Waiting is the intended behavior — the page can be opened minutes later. The URL is announced, and auto-declining would lose a slow reader. |
| `plan`: a step over 200 characters is shortened in the todo list and the approval listing | A display rule only: the plan file keeps the full text, and approval tracks the file. Revisit if an approval surface must show a full step. |
| `plan`: the plans directory is the only index, so there is no cross-repository plan history | The directory is the record, and a registry would be state that can drift from it. The store reports its own size, in its header, without becoming one. |
| `plan`: a shared review reaches one network, one address, and at most eight links | A tunnel, relay, or hosted review service is a product to operate, not a page to serve; the non-goal names it. Revisit with a hosted deployment. |
| `plan`: a reviewer's name is a label bound to a link, not an account | The owner still makes the only decision, so an account would add identity without adding a decision. Revisit if reviewers must be authenticated across restarts. |
| `subagent`: a child run's cost never enters the parent total, and the roll-up restarts at `/resume` | A documented non-goal: the parent total prices the parent's own turns, and a transcript is an audit record rather than a cost ledger. |
| `subagent`: background is single mode, and a background child is session-owned | Making a child resumable is a durable job queue, which the non-goals exclude. Revisit if a run must outlive its session. |
| `watch`: a **wake** match raises a notification once the running turn settles | A match found mid-turn is raised when that run settles, so a long turn delays it but never drops it. Revisit if a turn must be interrupted mid-flight. |
| `watch`: watcher state is memory-only | A watcher tails a live process or file; a resumed session cannot re-attach to a pipe it no longer has. Revisit if a watcher is given a durable source. |
| `worktree`: `skipOverrides` leaves the skipped tool unguarded for relative paths | The override is the user's statement that the tool should not be guarded. Revisit with `S1`, which changes what "guarded" means. |
| `rewind`: `.gitignore`d files are not captured | An explicit non-goal; no item. |
| `rewind`: the path checklist is TUI-only, so RPC, `print`, and `json` restore the whole tree | A non-interactive subset needs its own selector, validation, and preview. Revisit if a scripted caller needs a partial restore. |
| `memory`: injection truncates a large store, and `forget` is an exact match | `/memory doctor` names the notes the cap drops and the near-duplicate pairs, and `m` merges them, so the cap is visible where it bites. |
| `memory`: a store on a filesystem with coarse mtime can still hide a same-size edit | The stamp is nanoseconds, so every APFS/ext4 write is caught; a filesystem that reports one-second mtime cannot be beaten without reading the file on every run. Revisit if a store lives on such a filesystem. |
| `job`: `exec cmd` and Windows can settle a job with no exit code | The shell owns the exit path there; the job reports `unknown` rather than guessing. Revisit if a wrapper can always observe the code. |
| `job`: stdin is a pipe, a detached log is not rotated, and Windows cannot detach | Each is the price of a process that outlives its turn; the job page names all three where the option is offered. |
| `question`: there is no timeout, and RPC multi-select degrades to an editor | A prompt exists to wait for a person, and RPC cannot forward the component. Revisit if a host adds a component channel. |
| `context`: composition is an estimate, and no message can be trimmed or pinned | The report reads Pi's own bookkeeping; trimming is compaction's job. Revisit if Pi exposes a per-message API. |
| `web-access`: the keyless search returns answers and related topics rather than a result list | That is the provider's shape, not a parsing gap; SearXNG and Brave return a list. |
| `web-access`: DNS rebinding remains a residual SSRF risk | Every hop is checked by address, which cannot bind a later DNS answer. Revisit if a resolver-level guard is available. |
| `file-read`: the extraction deadline cannot preempt a parser that never yields | JavaScript cannot interrupt a synchronous parse, so the deadline stops waiting and discards the result. |
| `file-read`: formatting, tables, and images are flattened | Extraction returns text; layout fidelity is a different product. |
| `file-browse`: live status patches only the rows already drawn | A snapshot plus one reload control is honest; making every subfolder live is a different server. |
| `open_path`: Windows reports only that the launcher started | `explorer` exits non-zero after a successful open and reports nothing for a hidden window. Revisit with a platform API that answers. |
| `wechat`: an abandoned turn's notice is one attempt and needs a live connection | A notice the transport cannot deliver in five seconds is reported on the terminal, not retried: the session is gone, so there is nothing left to retry from. Revisit if a notice must outlive the session. |
| `wechat`: two peers' turns run at once, not more | Every concurrent turn is a full model run on the user's budget, and a phone chat rarely has more than two conversations in flight; the rest wait in a fair queue and are acknowledged. Revisit if `PEER_CONCURRENCY` needs to follow the hardware instead of the conversation. |
| `bytefly`: `doctor.skip`, the `rates` table, and `price.peak` are JSON-only | One is a list, one a table, one a nested object: none is a scalar row. |
| `bytefly`: built-in extensions are not listed in the picker | Pi does not expose their authoritative names, so this needs a host change rather than a picker row. |
| `bytefly`: themes and prompts are not picker sections | A theme is one active selection — a scalar, global setting — and a prompt template is a file Pi discovers; neither is the scoped enable list this screen writes. A decision, not a deferral: revisit if Pi exposes a scoped theme or prompt setting. |
| `bytefly`: the update cache window is fixed at 24 hours | One check per session reuses a younger entry; a setting would add a schema row and a `doctor` line for no failure it prevents. |
| `bytefly`: only packages configured in Pi's settings get an update prompt | Pi's package manager owns the list; a second detector would restore the duplicate-block class the single-notice refactor removed. |
| `bytefly`: the single update notice depends on patching `DefaultPackageManager.prototype.checkForAvailableUpdates` | Pi exposes no setting for its startup block. The shim is installed only in `tui`, restored on shutdown, and inert if the method shape changes. |
| `bytefly`: five notify triggers fire per event rather than per unseen event | A notification is a nudge, not a state; the footer chip is the state. |
| `session-bus`: a message file that does not parse is dropped | A message is written as a temp file and hard-linked into place, so this needs disk corruption; keeping it would leave an unreadable entry in every listing forever. |
| `session-bus`: a claim cannot see branch divergence | Claims say who is where, not what will merge; a rebase on the baseline still decides. |
| CI: macOS runs the suite serially while Windows and Linux use `--parallel=4` | Two open Bun bugs (`oven-sh/bun#41024`, `#39709`; a related one, `#45483`) can park a `--parallel` worker on macOS after its first subprocess spawn, which hangs a git-using test instead of failing it. Still open against Bun 1.4.3; revisit when both close, then delete `check:serial` from the matrix. |

## 1.0 readiness

The pack is ready for 1.0 when all of these are true, not on a date. Each gate
names the items that close it, so this list cannot drift from the horizons
above.

- Every README promise has shipped behavior, a named limitation, or a `doctor`
  finding, and every limitation with no item has a row in *Deliberately left
  thin*. A review rule, not a test: read the extension pages against this file
  at each release.
- Every number a doc states about the code is derived by a test; the settings
  count is the first, and a count without a guard is a promise waiting to rot.
- No known path loses work: worktree cleanup, plan approval, job reattachment, a
  partial rewind, a WeChat turn that is abandoned, and a message the bus
  cannot read each either preserve the work or say what was lost.
- State that claims to survive `/resume` and `/tree` does: goal, todo, plan mode,
  worktree binding, and the rewind timeline — each a session entry or tool-result
  `details` rebuilt from `getBranch()`, pinned by its extension's tests.
- The full check suite runs on Windows, macOS, and Linux, including the slow git
  suites, and the compat job names the newest Pi it passed against. macOS runs it
  serially until the upstream hang is fixed.
- A long-session benchmark stays within its budget — measured with
  `bun run bench:render` at each release.
- A release is one reviewed command path with provenance, and the tag, changelog,
  and npm version cannot drift — `test/release.test.ts` holds the version, the
  install pins, and the changelog's one-set-per-window shape.
- Docs truth tests cover tool names and config keys, and this roadmap's own item
  numbers, links, and bucket caps resolve — `test/naming.test.ts`,
  `test/config-docs.test.ts`, and `test/roadmap.test.ts`.

## Explicit non-goals

These stay out unless a roadmap item says otherwise:

- An OS sandbox, a general branch manager, or a Pi fork.
- Semantic memory, embeddings, or automatic fact extraction.
- OCR, PPTX, EPUB, or writing and converting documents (PPTX and EPUB are
  proposed reversals in `W4`, not current scope).
- Cron and scheduling, a durable job queue, or persisting watchers across
  sessions.
- Group chats, outbound video or voice, or model-callable sends to arbitrary
  recipients.
- Reviewer accounts, a relay, a tunnel, or a hosted review service.
- A plan registry across repositories.
- Auto-executing an approved plan without the user in the loop.
- Auto-updating the package.

## Maintaining this roadmap

- Review at each release: delete what shipped (the changelog is the record),
  re-rank what remains, and add an item only with a concrete acceptance
  condition.
- Restate an item from the tree before promoting it, not from a memory of it;
  `git log <last-tag>..main` is the first read of every review.
- A documented limitation with no item has a row in *Deliberately left thin*.
  That table is the answer to "why isn't this being fixed?", not a parking lot
  for things that are. A limitation an item owns is never repeated there.
- An item the tree contradicts is deleted with its reason written down, the way
  the update-channel item was; parking it would describe a tree that no longer
  exists.
- An item that needs a documented non-goal reversed is marked as a decision, not
  slipped in as a feature.
- A number this file or another doc states about the code needs a test that
  derives it; prose alone is how the settings count drifted. That includes the tag
  this file says it was written against: `test/roadmap.test.ts` compares it with the
  newest `vX.Y.Z` tag, so restate it in the same commit as a release.
- Renumbering an item means grepping the Promise ledger, the three-things list,
  and the section intros; `test/roadmap.test.ts` fails on a dangling ID or a
  bucket over the cap.
