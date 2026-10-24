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

- 19 extensions, 5 packaged skills, 2 themes, one shared `bytefly.json`.
- Foundations that hold: no build step, no fork, every extension optional,
  three-OS CI, a shared `lib/tui/` and `lib/web/` design system, budgeted prompt
  context, and package-level guards that hold the docs, the catalog, the release
  window, and this file to the tree.
- The last tag is `0.18.0`, and it shipped the body the previous review listed
  as pending: `session-bus` with its live board and slice joining, plans split
  into a team at approval, reviewer links that follow the plan file live, and the
  browse page's `path:line` reference copy. The window since it changes no
  behaviour — `docs/architecture.md` now states the target architecture rather
  than a snapshot, with the three rules the code has not reached carried here as
  `F3`–`F5`; the `refactor` skill measures a scope with a shipped
  `scripts/inventory.ts`; the `project-docs` skill keeps the front door, the roadmap,
  and the changelog honest from one five-mode workflow, with the changelog's
  `scripts/state.ts` moved under it; and `AGENTS.md` names its four rules, the fourth
  enforced by review alone.

## How items are ordered

1. **Make a promise true.** Fix a place where the README or an extension README
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

Every item ships with the same contract: behavior, tests, the extension README,
the catalog and config reference where relevant, a `CHANGELOG.md` bullet, and a
`doctor` finding if it adds a runtime prerequisite. **A number a doc states about
the code is derived by a test** — the settings count is the pattern, and every
count this file or a doc repeats should follow it. TUI work also updates the
screenshots.

## Promise ledger

| README promise | Today | Open items |
|---|---|---|
| Plan, then execute | Strong; one plan store per repository, a split at approval, and a review that follows its file | P1–P2 |
| Delegate and parallelize | Strong; background runs, a local session bus, and a protocol skill, with every bus limit documented | P1 |
| Never wreck the checkout | Works, but isolation is best-effort | S2–S3 |
| Remember across sessions | Works; the store reports its own health, and a same-tick edit is next | S1 |
| Reach the web and your files | Broad; formats, remote media, and launch reporting are thin | W1–W5 |
| Optional and upgradeable | Strong; the update action is the remaining surface | C1–C2, F1–F5 |

The last row is a paraphrase: the README says "Everything is optional and
independently toggleable" and "the package upgrades with Pi like any other."
The column is *Open items*, not the `Next` tier, because a ledger row can be
closed by work parked in any horizon.

## If only two things ship

1. **P1 — A split's shared files stay the lead's after approval.** Approval
   refuses an owner unit that claims `package.json`; nothing stops that edit once
   the sessions are running.
2. **S1 — Memory notices a same-size edit in the same tick.** The store compares
   a millisecond stamp, so an edit that keeps the size and lands inside one tick
   is invisible until `/memory reload`.

These are the two `Now` items: the rest of this file can wait for a later
release, and the changelog, not this list, records what did.

## Horizons

| Horizon | Question | Exit condition |
|---|---|---|
| **Now** | Does the pack keep what it promised? | `P1` and `S1` ship, each with its test and its README line. |
| **Next** | Does the daily loop feel finished? | `W1` and `C1` land, or are demoted with the reason recorded. |
| **Later** | Is it a platform? | Reproducible releases, benchmarked long sessions, and the expansion decisions made. |

Horizons are priority tiers, not dated commitments. A minor release ships
whatever is ready; this project releases often and treats the changelog, not
this file, as the record of what shipped.

The previous `Now` — a stale-doc sweep, every isolation gap visible in the
session, a named Pi range, and a long-session benchmark — closed with `0.13.0`.
The two items that used to head this file are gone for a reason worth keeping:
the provider table would only price *below* Pi's per-model catalog, and the
picker's scope decision is made — themes and prompts stay out, because neither is
a scoped enable list. The update-channel item is gone for the third kind of
reason: the tree contradicts it (see *Chrome and upkeep*).

## 1. Plan and delegate

**README promise:** "Plan, then execute." and "Delegate and parallelize."

**Today**

- `plan`: five tools — `enter_plan_mode`, `write_plan`, `exit_plan_mode`,
  `cancel_plan_mode`, `set_plan_steps` — `/plan` with `list`, `review`, `share`,
  and `cancel`, the `--plan` flag, `Ctrl+Alt+P`, a TUI review, and a browser
  review with inline comments. A review can be shared as one link per person: the
  name a link first posts under is bound to it, the page follows the plan file
  live, and only the owner's own page saves, approves, or closes. On approval a
  plan can be split into a `## Team` table, and the result prints a roster card
  of the commands the package cannot run. Plans live in
  `<agent-dir>/plans/<repo-key>` — one store per repository, keyed by the common
  git directory, so every worktree sees the same plan.
- `session-bus`: one `session` tool (`send`, `inbox`, `claim`, `release`, `join`,
  `leave`, `name`, `watch`, `status`) and `/sessions`, a live board with
  Sessions, Inbox, and Claims scopes, `units n/m` for the newest split, and an
  opt-in inbox watch. State lives under the agent directory and is keyed by the
  common git directory, so every worktree of a repository is on one bus; no
  server starts.
- The packaged `parallel-dev` skill turns the bus into a protocol: contract
  first, one owner per outcome slice rather than per layer, shared files to the
  lead, a merge order, and claims released when the work merges.
- `subagent`: eight built-in agents, single, parallel, chain, and background
  runs with `/agents`, a per-run deadline, read-only mode, and opt-in
  transcripts.
- `todo`, `goal`, `question`, `job`, `watch`, and `context` keep the loop
  visible, interruptible, and priced.

**Where the promise is thin**

- A split's shared-file rule is a refusal at approval and nothing else: after
  `join`, an owner session can still claim or edit `package.json`, the changelog,
  the test manifests, and the shared name modules (`P1`).
- A split can be approved only in the terminal review. The browser cannot approve
  one, because the `## Team` section is written at approval and has no source
  lines for a comment to anchor to (`plan` README).
- A shared review reaches one network and one address: there is no tunnel or
  relay, so a distributed team cannot open the link, and a laptop that changes
  network changes its link. A review holds at most eight links, and a reviewer's
  name is a label on a bearer link rather than an account (`plan` README).
- The plans directory is the only index: `/plan list` walks it on demand, there
  is no cross-repository history, and nothing reports how large a repository's
  store has grown (`P2`).
- Approval caps a plan at 50 top-level steps, and a step over 200 characters is
  shortened in the todo list and the approval listing; the plan file keeps the
  full text.
- A subagent's tokens and cost are published for bytefly's `↳` roll-up but
  deliberately never added to the parent session's total, and the roll-up starts
  from zero after `/resume`. Background is single mode only: parallel and chain
  still wait, and a background child is session-owned, so `/tree` does not move
  it and a restart cannot resume it (`subagent` README).
- The bus is one machine and one OS user, with no authentication between
  sessions; delivery is pull-based unless a session arms its watch; a claim is
  advisory and a crashed owner keeps its paths until the ten-minute TTL; two
  armed peers can ping-pong (`session-bus` README).
- A `watch` match raises its notification or its wake once a running turn
  settles, not in the middle of it (`watch` README).

**Now**

- **P1 — A split's shared files stay the lead's after approval.** Approval
  refuses an owner unit whose prefixes cover a shared file, and nothing applies
  that rule once the sessions are working. A session joined to an owner unit
  refuses a `claim` on any path `SHARED_FILES` covers, or is covered by, and the
  refusal names the lead; the lead's own claim is untouched. One list
  (`lib/plans/split.ts`) drives approval and claiming, so the two cannot
  disagree. *Done when* an owner's claim on `package.json` is refused with the
  lead named, the plan README says the rule holds at claiming time, and a
  project-extended shared list is still approval-only by name.

**Next**

Nothing here is queued: the split and the bus shipped with this window, and `P1`
is the one gap they left.

**Later**

- **P2 — The plan store says how big it is.** The store moved into the agent
  directory, so it grows with every repository and nothing reports it. `/plan
  list` names how many plans the repository holds and how old the oldest is;
  nothing deletes a plan, because a plan is the user's record of an approval.

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
  refused rather than parsed (`worktree` README).
- `git branch --merged main` calls a worktree branch merged whenever it matches
  its base, so a worktree that never committed looks landed while its uncommitted
  work is still there; prune itself refuses that worktree, and `list_worktrees`
  reports the clean and merged flags beside each other (`worktree` README).
- Rewind captures no ignored file; the path checklist needs a TUI, so RPC,
  `print`, and `json` restore the whole tree; hunk selection covers modified text
  files only; `/review` targets the latest prompt's snapshot and refuses while
  plan mode is on (`rewind` README).
- Memory injects a large store truncated with a tail note, `forget` is an exact
  match, one note is one line, and the near-duplicate key is conservative by
  design (`memory` README). A same-size edit inside one filesystem timestamp
  tick is invisible until `/memory reload`; `S1` narrows that to a filesystem
  whose mtime is coarser than the write.

**Now**

- **S1 — Memory notices a same-size edit in the same tick.** The store cache keys
  on `(mtimeMs, size)`, so an edit that keeps the size and lands inside one
  timestamp tick is invisible until `/memory reload`. Compare the nanosecond
  stamp a bigint `stat` gives; where the filesystem reports no finer stamp than
  the cached one, keep the documented caveat rather than reading the file on
  every run. *Done when* a sub-millisecond, same-size edit is picked up without
  a reload, the existing mtime-jump test still passes, and the README states the
  residual case.

**Next**

Nothing here is queued: cleanup refuses what it cannot verify, the store reports
its own health, and the remaining gaps are documented behavior.

**Later**

- **S2 — Sandbox spike.** Evaluate `sandbox-exec` (macOS), `bubblewrap` (Linux),
  and a Windows job or AppContainer equivalent behind an optional setting. The
  documented non-goal stands until a spike proves the ergonomics, because it also
  decides what "guarded" means for the user's own shell.
- **S3 — Snapshot visibility.** Surface storage per root and a "keep the last N"
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
  (`file-read` README).
- Web search quality depends on the provider, and the keyless default returns
  answers and related topics rather than a result list; there is no provider
  failover. `web_fetch`'s extraction is a heuristic rather than a readability
  engine, PDF text needs the optional `unpdf`, and its page cache lives and dies
  with the registration (`web-access` README).
- A browse page's live status patches the rows it already drew: a new file needs
  `⟳ reload`, and subfolders, `/diff`, and `changes` stay snapshots. The server
  has no authentication, and it is loopback-only by design (`file-browse`
  README).
- `open_path` is codemode-exposed and inactive by default; reveal has no native
  Linux meaning; Windows `explorer` can exit non-zero after a successful open and
  a hidden window is undetected, so only "the launcher started" is known
  (`file-open` README).
- WeChat answers two peers at once, and a third waits; there is no group chat and
  no outbound video or voice; a peer must message first; a full-screen
  `ctx.ui.custom` dialog cannot be answered from the phone; and a turn abandoned
  by a close ends in one notice rather than an answer (`wechat` README).

**Now**

Nothing here is queued: the abandoned-turn notice shipped, so a close that cuts a
peer's turn off says so in one line. The rest of this section is `Next` work or a
decision.

**Next**

- **W1 — Structured fetch.** Teach `web_fetch` to render JSON, CSV, and XML as
  readable text — indented keys, aligned columns, one record per block — instead
  of a raw blob. No model call and no new dependency, and the HTML heuristic
  path is untouched. *Done when* a fixture of each renders as text, a malformed
  document still returns its raw body, and the README says which formats are
  rendered.

**Later**

- **W2 — Group chats.** A separate admission and routing model, not a flag on
  the current bridge.
- **W3 — OCR.** Only if a local, dependency-light engine earns its install size;
  otherwise keep the explicit non-goal.
- **W4 — Readability engine.** Replace the heuristic extractor only with a
  measured improvement on a fixture set.
- **W5 — PPTX and EPUB.** Add both to the `file-read` registry using libraries
  already present where possible (`fflate`, `fast-xml-parser`), lazily imported.
  This reverses a documented non-goal; approve before building.

## 4. Chrome and upkeep

**README promise:** the `/bytefly` control center, the curated settings, priced
runs, an update check, and two themes.

**Today**

- Bytefly owns the header, footer, turn rule, notices, tool frame, live working
  row, control center, doctor, notify, price, and update check.
- The control center lists extensions and skills with the same enable checkbox
  and Global/Project scope, and keeps the curated Settings shortlist beside
  them.
- Settings is a flat shortlist of thirteen preferences — eleven of them
  `bytefly.json` rows — including the Theme row, one edited amount, and the
  `plan.split` switch; every other key is a `bytefly.json` edit. The counts the
  docs state are derived from the catalogue by a test, so a new row cannot leave
  the docs describing an older screen.
- DeepSeek is priced from its published CNY and USD tables, with peak and
  off-peak windows, and a currency the session cannot price names what it left
  out.

**Where the promise is thin**

- The screen covers scalars and booleans only: `doctor.skip` (a list), the
  `rates` table, `price.peak` (a nested object), and the tuning numbers and
  labels that left the screen stay JSON (`bytefly` README).
- The picker manages the `extensions` and `skills` resource types; themes and
  prompts stay with `pi config`, and built-in extensions are not listed.
- The update check asks npm's `latest` for this package's version, keeps a
  fixed 24-hour cache, and prompts only for packages Pi's manager knows about, so
  `pi -e .` and temporary checkouts are not checked; suppressing Pi's own startup
  block depends on host shims a future Pi can invalidate (`bytefly` README).
- Only DeepSeek has a built-in rate table, there is no FX conversion, and a
  `(auto)` or `(sub)` indicator cannot be reproduced.
- `doctor` checks declared requirements only, and a probe proves a binary runs,
  not that it works.

**Now**

Nothing here is queued: the count every doc states is the catalogue's, and a test
derives it from `SETTING_ROWS`, so a fourteenth row fails by naming the file that
did not follow.

**Next**

- **C1 — Update action.** Offer `pi update --extensions` from the control center
  behind a confirmation — but only if a spike finds a host path that updates
  through Pi's own package manager instead of a shell. Start with the spike; if
  Pi exposes nothing safe, delete the item and leave the notice as the whole
  surface, which is what it is today.

**Later**

- **C2 — More currencies.** Generalize the rates table beyond CNY and USD only
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

Nothing here makes a false promise today.

**Next**

- **F3 — One loopback lifecycle.** Binding, the `Host` check, page headers, and
  the response writer live in `lib/http/`, but `plan` and `file-browse` each
  build their own `node:http` server around those pieces and close it
  themselves, so the close path exists twice and idle grace exists once
  (`extensions/file-browse/server.ts`, `extensions/plan/web.ts`). Give
  `lib/http/` one server entry that owns bind → accept → close → idle, and let an
  extension supply routes and an idle policy only. *Done when* neither extension
  imports `node:http` for its own server, idle grace is asserted by a `lib/http/`
  test, and a page cannot outlive the session it describes.
- **F4 — Role directories past twenty modules.** The architecture page names the
  roles a module can play and lets a role earn a directory past roughly twenty
  modules, the way `bytefly/` groups `footer/`, `notice/`, and `separator/` and
  `web-access/` groups `fetch/` and `search/`. Counting modules and not files —
  a co-located suite is not a module — `wechat` (35 modules) shipped its seven
  role directories, so `rewind` (25 modules) is the one flat extension past that
  size, and `job` (20 modules), `worktree` (20 modules), and `subagent` (17
  modules) stay flat until they cross it. *Done when* `rewind` holds role
  subdirectories plus `index.ts`, its imports are updated, and the page's layout
  rule describes the tree without an exception.
- **F5 — `lib/` names a contract.** Shared code is promoted on a second consumer
  or on a contract two sides must agree on, but `lib/claims/overlap.ts` has one
  consumer (`session-bus`, which re-exports it) and `lib/pi-invocation.ts` has
  one (`subagent`). Move each into the extension that uses it, and keep
  `lib/requirements.ts` — a declaration table whose whole point is being one
  list. *Done when* neither module is in `lib/`, both extensions' suites cover
  them, and `lib/README.md`'s conventions name the single-table exception.

**Later**

- **F1 — Signed artifacts and SBOM.** Generate an SBOM per release if consumers
  ask; do not add ceremony before then.
- **F2 — Split the browse listing out of `files.ts`.** At 564 of the 600-line
  bar, `extensions/file-browse/files.ts` still holds classification, Markdown
  detection, text reads, listings, and the sidebar tree. The split is a
  behaviour-neutral move of the listing half into its own module; it is deferred
  until the bar is reached, because today it is one file-browse-local module
  under the limit, and doing it alongside feature work would mix a structural
  move into an unrelated diff.

## Deliberately left thin

Documented limitations that have no item, so a reader can tell a gap that was
triaged from one that was missed. Each row names the condition that would reopen
it. A limitation an item owns is named in that section instead, never here.

| Limitation | Why it has no item |
|---|---|
| `plan`: no PowerShell while planning | The read-only shell is Git Bash by design; PowerShell needs a second parser and guard, which is also why the worktree guard refuses the tool rather than parsing it. Revisit with `S2`. |
| `plan`: a browser that never connects waits until the user cancels, closes the tab, or aborts | Waiting is the intended behavior — the page can be opened minutes later. The URL is announced, and auto-declining would lose a slow reader. |
| `plan`: a step over 200 characters is shortened in the todo list and the approval listing | A display rule only: the plan file keeps the full text, and approval tracks the file. Revisit if an approval surface must show a full step. |
| `plan`: the plans directory is the only index, so there is no cross-repository plan history | The directory is the record, and a registry would be state that can drift from it. `P2` reports a store's size without becoming one. |
| `plan`: a shared review reaches one network, one address, and at most eight links | A tunnel, relay, or hosted review service is a product to operate, not a page to serve; the non-goal names it. Revisit with a hosted deployment. |
| `plan`: a reviewer's name is a label bound to a link, not an account | The owner still makes the only decision, so an account would add identity without adding a decision. Revisit if reviewers must be authenticated across restarts. |
| `plan`: the browser cannot approve a split | The `## Team` section is written at approval, so it has no source lines for a comment to anchor to. Revisit if a split is ever authored inside the page. |
| `subagent`: a child run's cost never enters the parent total, and the roll-up restarts at `/resume` | A documented non-goal: the parent total prices the parent's own turns, and a transcript is an audit record rather than a cost ledger. |
| `subagent`: background is single mode, and a background child is session-owned | Making a child resumable is a durable job queue, which the non-goals exclude. Revisit if a run must outlive its session. |
| `watch`: a **wake** match raises a notification once the running turn settles | A match found mid-turn is raised when that run settles, so a long turn delays it but never drops it. Revisit if a turn must be interrupted mid-flight. |
| `watch`: watcher state is memory-only | A watcher tails a live process or file; a resumed session cannot re-attach to a pipe it no longer has. Revisit if a watcher is given a durable source. |
| `worktree`: `skipOverrides` leaves the skipped tool unguarded for relative paths | The override is the user's statement that the tool should not be guarded. Revisit with `S2`, which changes what "guarded" means. |
| `worktree`: `--merged` calls a never-committed worktree landed | `git branch --merged` compares branches, not working trees; prune refuses that worktree and `list_worktrees` shows the clean flag beside the merged one. Revisit if the status line grows a "no commits" state. |
| `rewind`: `.gitignore`d files are not captured | An explicit non-goal; no item. |
| `rewind`: the path checklist is TUI-only, so RPC, `print`, and `json` restore the whole tree | A non-interactive subset needs its own selector, validation, and preview. Revisit if a scripted caller needs a partial restore. |
| `memory`: injection truncates a large store, and `forget` is an exact match | `/memory doctor` names the notes the cap drops and the near-duplicate pairs, and `m` merges them, so the cap is visible where it bites. |
| `memory`: a store on a filesystem with coarse mtime can still hide a same-size edit | `S1` closes the case every APFS/ext4 write hits; a one-second stamp cannot be beaten without reading the file each run. Revisit if a store lives on such a filesystem. |
| `job`: `exec cmd` and Windows can settle a job with no exit code | The shell owns the exit path there; the job reports `unknown` rather than guessing. Revisit if a wrapper can always observe the code. |
| `job`: stdin is a pipe, a detached log is not rotated, and Windows cannot detach | Each is the price of a process that outlives its turn; the README names all three where the option is offered. |
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
  thin*. A review rule, not a test: read the extension READMEs against this file
  at each release.
- Every number a doc states about the code is derived by a test; the settings
  count is the first, and a count without a guard is a promise waiting to rot.
- No known path loses work: worktree cleanup, plan approval, job reattachment, a
  partial rewind, a WeChat turn that is abandoned, and a message the bus
  cannot read each either preserve the work or say what was lost.
- State that claims to survive `/resume` and `/tree` does: goal, todo, plan mode,
  worktree binding, the rewind timeline, and a plan's team — each a session entry
  or tool-result `details` rebuilt from `getBranch()`, pinned by its extension's
  tests.
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
  proposed reversals in `W5`, not current scope).
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
  derives it; prose alone is how the settings count drifted.
- Renumbering an item means grepping the Promise ledger, the three-things list,
  and the section intros; `test/roadmap.test.ts` fails on a dangling ID or a
  bucket over the cap.
