# Roadmap

What this pack is trying to become, and the next work that gets it there.
Derived from [`README.md`](./README.md), the limitations each extension already
documents, and the history in [`CHANGELOG.md`](./CHANGELOG.md). Items are
proposals, not release commitments; the changelog is the record of what shipped.

## North star

The README makes one promise: **plan before you act, delegate the work, keep the
main checkout clean, and carry context across sessions** — without forking Pi.
The roadmap is ordered by how directly an item makes that sentence true.

The pack already has breadth: seventeen extensions and two themes. The next stage
is not more surface area. It is making the existing promises exact, continuous
across `/resume` and `/tree`, and honest where a platform cannot deliver.

## Where we are

- Seventeen extensions, two themes, one shared `bytefly.json`.
- Four product groups in the README: plan and delegate, keep work safe, reach
  the world, chrome and upkeep.
- Foundations that hold: no build step, no fork, every extension optional,
  three-OS CI, a shared `lib/tui/` design system, budgeted prompt context, and
  package-level guards that hold the docs, the catalog, the release window, and
  this file to the tree.
- Recent releases through `0.14.0` cover the plan review browser, CNY/USD
  pricing, inline text editing in `/bytefly settings`, the wider settings
  catalogue, the config reference, and the re-checkable update cache. `0.13.0`
  added subset rewind, the `wake` desktop alert, `/plan list`, the worktree
  handoff block, isolation gaps named in the session, one reviewed publish path
  with provenance, a Pi-compat job, and a long-session benchmark. An unreleased
  Theme row adds `system` and the two shipped palettes to Settings.

## How items are ordered

1. **Make a promise true.** Fix a place where the README or an extension README
   says something the code does not do, or where a documented limitation can be
   removed.
2. **Never lose work.** A path that can discard a change, a plan, a goal, or a
   conversation outranks a new capability.
3. **Remove a silent degradation.** A missing prerequisite belongs in `doctor`,
   not in the moment of use.
4. **Expand reach.** New formats, providers, and integrations come last.

Two rules keep this file honest:

- **An item is deleted when it ships, never ticked.** Re-derive a candidate from
  `git log <last-tag>..main` before promoting it: an unreleased fix can already
  have closed the limitation the README still lists, and a roadmap written from
  the last tag describes a tree that no longer exists.
- **`Now` and `Next` hold at most ten items each; everything else is `Later`.**
  A tier is a priority, so a bucket that keeps growing stops being one. Demote
  an item rather than widening the cap.

Every item ships with the same contract: behavior, tests, the extension README,
the catalog and config reference where relevant, a `CHANGELOG.md` bullet, and a
`doctor` finding if it adds a runtime prerequisite. TUI work also updates the
screenshots.

## Promise ledger

| README promise | Today | Open items |
|---|---|---|
| Plan, then execute | Strong; review continuity and `/plan list` shipped, and the remaining gaps are documented behavior | — |
| Delegate and parallelize | Strong; a child run's cost now has its own footer roll-up, background runs are live, and folding a child total into the parent stays a documented non-goal | — |
| Never wreck the checkout | Works, but isolation is best-effort | S1–S2 |
| Remember across sessions | Works; the store reports its own health | — |
| Reach the web and your files | Broad; formats and remote media are thin | W1–W7 |
| Optional and upgradeable | Strong; docs and releases can be tighter | C1–C5, F1–F2 |

The last row is a paraphrase: the README says "Everything is optional and
independently toggleable" and "the package upgrades with Pi like any other."
The column is *Open items*, not the `Next` tier, because a ledger row can be
closed by work parked in any horizon.

## If only three things ship

1. **C1 — Provider rate packs.** Published rates for the major hosted providers,
   each dated, so a non-DeepSeek model whose tariff a table can express is priced
   from a published rate instead of showing no price at all.
2. **C2 — Control-center breadth.** *Decision first:* whether themes, skills, and
   prompts belong in the picker or stay with `pi config`; if they do, they need the
   same health and scope rules as extensions.
3. **F1 — Dependency budget.** A check that a new runtime dependency is lazy-loaded
   unless it is needed at registration, so an install stays small.

The first two sit in `Now`; this one is the smallest foundation gap left.

## Horizons

| Horizon | Question | Exit condition |
|---|---|---|
| **Now** (highest priority) | Are the numbers honest? | `C1` and `C2` land: a model whose tariff a table cannot express keeps Pi's recorded cost, and the picker's scope decision is recorded. The built-in tariff is already dated, and its age is visible in `doctor`. |
| **Next** (queued) | Does the daily loop feel finished? | Empty: background delegation shipped; the next tier is not yet chosen. |
| **Later** (parked) | Is it a platform? | Reproducible releases, benchmarked long sessions, expansion decisions made. |

Horizons are priority tiers, not dated commitments. A minor release ships
whatever is ready; this project releases often and treats the changelog, not
this file, as the record of what shipped.

The previous `Now` — no stale doc, every isolation gap visible in the session, a
named Pi range, and a long-session benchmark — closed with `0.13.0`, and the
previous `Next` closed with it: note promotion, settings completeness, and the
worktree handoff all shipped, so the handoff item is gone rather than ticked.

## 1. Plan and delegate

**README promise:** "Plan, then execute." and "Delegate and parallelize."

**Today**

- `plan`: four tools, `/plan`, `--plan`, `Ctrl+Alt+P`, a TUI review, and a
  loopback browser review with inline comments.
- `subagent`: eight built-in agents, single/parallel/chain, read-only mode, a
  per-run deadline, and opt-in per-run transcripts.
- `todo`, `goal`, `question`, `job`, and `watch` keep the loop visible and
  interruptible.

**Where the promise is thin**

- A step longer than 200 characters is shortened in the todo list and the
  approval listing (`plan` README); the plan file keeps the full text.
- Prior plans are only discoverable through `/plan list`, which walks the
  directory on demand; there is no cross-repository history (`plan` README).
- A subagent's tokens and cost are published for bytefly's `↳` footer roll-up but
  deliberately never added to the parent session's total, and the roll-up starts
  from zero after `/resume` (`subagent` README).
- `watch` notifies the desktop only for a `wake` match found while the agent is
  idle; a match during a running turn is reported at the next turn without a
  notification (`watch` README).
- Delegation is synchronous: parallel mode overlaps children inside one call,
  but the turn waits for every child, so a long run stops the conversation.

**Now**

Nothing here makes a false promise today: a plan the user reviewed cannot lose
steps to the cap any more, and the rest is documented behavior. This section
contributes no `Now` item.

**Next**

Nothing here is queued: background delegation shipped with this release. This
section contributes no `Next` item.

## 2. Keep your work safe

**README promise:** "Never wreck the checkout." and "Remember across sessions."

**Today**

- `worktree`: re-roots the built-in file and shell tools, guards absolute paths
  and shell escapes, and refuses to discard a dirty worktree.
- `rewind`: one git-ref snapshot per prompt, restore code (whole tree or a chosen
  subset of paths), conversation, or both, with `max` and `autoPrune`.
- `memory`: project and global markdown notes, injected each run, managed
  through `/memory` (add, edit, forget, merge, and move between scopes).

**Where the promise is thin**

- The user's own `!` shell is not re-rooted; it still runs in the main checkout
  (`worktree` README).
- `skipOverrides` leaves the skipped tool unguarded for relative paths
  (`worktree` README).
- Shell escape detection is best-effort; `eval`, `sh -c`, and command
  substitution are covered only behind `blockUnparsableCommands` (`worktree`
  README).
- Rewind captures no ignored file, and the path checklist needs a TUI (see
  [Deliberately left thin](#deliberately-left-thin)).
- Memory injection truncates a large store with a tail note, and `forget` is
  exact; `/memory doctor` names the notes the cap drops and the near-duplicate
  pairs the conservative key considers equal, and `m` in the picker merges them
  (`memory` README).

**Now**

Nothing here makes a false promise today: the store reports its own health, the
remaining gaps are documented behavior, and dedupe stays conservative by design.
This section contributes no `Now` item.

**Next**

Nothing here is queued: turn review shipped with this release, and the rest is
either structural or later work. This section contributes no `Next` item.

**Later**

- **S1 — Sandbox spike.** Evaluate `sandbox-exec` (macOS), `bubblewrap` (Linux),
  and a Windows job or AppContainer equivalent behind an optional setting. The
  documented non-goal stands until a spike proves the ergonomics.
- **S2 — Snapshot visibility.** Surface storage per root and a "keep the last N"
  recommendation. `max` and `autoPrune` already prune, so this is visibility,
  not a new mechanism.

## 3. Reach the world

**README promise:** "Reach the web and your files."

**Today**

- `web-access`: keyless DuckDuckGo, optional SearXNG or Brave, readable fetch,
  paging, `find`, per-hop SSRF checks, optional PDF.
- `file-browse`: loopback read-only browser with Markdown preview, a diff view,
  quick open, and live status streamed to an open page.
- `document`: in-process PDF/DOCX/DOC/ODT/RTF/XLSX extraction, paged.
- `file-open`: native open and reveal on three operating systems.
- `wechat`: one Pi session per peer, inbound text/images/files, remote dialogs,
  and streaming replies.

**Where the promise is thin**

- `read_doc` has no OCR, and its extraction deadline cannot preempt a parser
  that never yields to the event loop (`document` README).
- Web search quality depends on the provider; the keyless default returns
  answers and related topics, not a result list (`web-access` README).
- WeChat runs one turn at a time across peers, has no group chat, and cannot
  deliver outbound images (`wechat` README).

**Now**

Nothing here makes a false promise today: every documented limitation either has
an item below or a row in *Deliberately left thin*. This section contributes no
`Now` item.

**Next**

Nothing here is queued: the search provider's configuration is now reported by
`doctor`. This section contributes no `Next` item.

**Later**

- **W1 — PPTX and EPUB.** Add both to the `document` registry using libraries
  already present where possible (`fflate`, `fast-xml-parser`), lazily imported.
  This reverses a documented non-goal; approve before building.
- **W2 — Per-peer WeChat concurrency.** Give each peer its own interaction
  channel and a fair queue, so two peers can run at once while each peer's own
  turns stay serial. *Done when* a forwarded dialog still has exactly one
  owner.
- **W3 — Outbound images.** Send images such as plan screenshots or generated
  plots to a peer, not only text and files. This reverses a non-goal; confirm the
  API shape first.
- **W4 — Structured fetch.** Teach `web_fetch` to render JSON, CSV, and XML as
  readable text instead of a raw blob. No model call and no new dependency.
- **W5 — Group chats.** A separate admission and routing model, not a flag on
  the current bridge.
- **W6 — OCR.** Only if a local, dependency-light engine earns its install
  size; otherwise keep the explicit non-goal.
- **W7 — Readability engine.** Replace the heuristic extractor only with a
  measured improvement on a fixture set.

## 4. Chrome and upkeep

**README promise:** the `/bytefly` control center, the curated settings, priced
runs, an update check, and two themes.

**Today**

- Bytefly owns the header, footer, turn rule, notices, tool frame, live working
  row, control center, doctor, notify, price, and update check.
- Settings exposes every scalar preference across ten groups, including the
  Theme row, with inline text editing.
- DeepSeek is priced from its published CNY and USD tables, with peak and
  off-peak windows.

**Where the promise is thin**

- Settings cover scalars only: `doctor.skip` (an array), the `rates` table, and
  `price.peak` (a nested object) remain JSON (`bytefly` README).
- The picker manages only the `extensions` resource type and does not list
  built-in extensions (`bytefly` README).
- The update check has no channel or prerelease preference, and its 24-hour
  cache window is not configurable (`bytefly` README).
- Only DeepSeek has a built-in rate table (`bytefly` README).

**Now**

Nothing above is a false promise; the picker gap is a scope decision rather than
a fix, so it is an item rather than a row. The money the chrome reports has one
gap left:

- **C1 — Provider rate packs.** Add published rates for the major hosted
  providers (Anthropic, OpenAI, Google), each with an effective date; the age
  report `doctor` now prints for the built-in tables extends to theirs. Keep Pi's
  recorded cost as the fallback. Scope it to a tariff a table can express: where the README's "no
  tiers, no special cache writes" limitation applies, the model keeps Pi's
  recorded cost instead of a guessed rate. *Done when* no network is required,
  a model the table cannot express never prices below its recorded cost, and an
  unknown model still shows no invented price.
- **C2 — Control-center breadth.** *Decision first:* do themes, skills, and
  prompts belong in the picker or stay with `pi config`? If added, they need the
  same health and scope rules as extensions.

**Next**

Nothing here is queued: every scalar preference now has a row. This section
contributes no `Next` item.

**Later**

- **C3 — Update channels.** An opt-in prerelease or tagged-channel preference,
  still with no auto-update.
- **C4 — Update action.** Offer `pi update --extensions` from the control
  center behind a confirmation, only if the host exposes a safe way to run it.
- **C5 — More currencies.** Generalize the rates table beyond CNY and USD only
  when a user actually needs a third unit.

## 5. Foundations

These are not a README pillar, but every promise depends on them.

**Now**

Nothing here makes a false promise today: the docs are checked against the code,
the catalog, and each other, and the pages they describe are covered through their
routers rather than a browser. This section contributes no `Now` item.

**Next**

Nothing here is queued: every publish now goes through one reviewed,
provenance-attested path. This section contributes no `Next` item.

**Later**

- **F1 — Dependency budget.** A check that a new runtime dependency is
  lazy-loaded unless it is needed at registration, matching the `document` and
  `web-access` pattern.
- **F2 — Signed artifacts and SBOM.** Generate an SBOM per release if consumers
  ask; do not add ceremony before then.

## Deliberately left thin

Documented limitations that have no item, so a reader can tell a gap that was
triaged from one that was missed. Each row names the condition that would reopen
it.

| Limitation | Why it has no item |
|---|---|
| `plan`: no PowerShell while planning | The read-only shell is Git Bash by design; PowerShell needs a second parser and guard, which is also why the worktree guard refuses the tool rather than parsing it. Revisit with `S1`. |
| `plan`: a browser that never connects waits until the user cancels, closes the tab, or aborts | Waiting is the intended behavior — the page can be opened minutes later. The URL is announced, and auto-declining would lose a slow reader. |
| `plan`: a step over 200 characters is shortened in the todo list and the approval listing | A display rule only: the plan file keeps the full text, and approval tracks the file, so no reviewed step is lost. Revisit if an approval surface must show a full step. |
| `plan`: the plans directory is the only index, so there is no cross-repository plan history | The directory is the record, and a registry would be state that can drift from it. Revisit if one view over several repositories is actually needed. |
| `subagent`: a child run's cost never enters the parent total, and the roll-up restarts at `/resume` | A documented non-goal: the parent total prices the parent's own turns, and a transcript is an audit record rather than a cost ledger. |
| `watch`: only a **wake** match found while the agent is idle raises a notification | A busy match is queued for the next turn, where the agent is already the listener. Revisit if a match during a long turn has to interrupt. |
| `worktree`: `skipOverrides` leaves the skipped tool unguarded for relative paths | The override is the user's statement that the tool should not be guarded. Revisit with `S1`, which changes what "guarded" means. |
| `rewind`: `.gitignore`d files are not captured | An explicit non-goal; no item. |
| `rewind`: the path checklist is TUI-only, so RPC, `print`, and `json` restore the whole tree | A non-interactive subset needs its own selector, validation, and preview. Revisit if a scripted caller needs a partial restore. |
| `memory`: injection truncates a large store, and `forget` is an exact match | `/memory doctor` names the notes the cap drops and the near-duplicate pairs, and `m` merges them, so the cap is visible where it bites. Revisit if a dropped note becomes invisible. |
| `web-access`: the keyless search returns answers and related topics rather than a result list | That is the provider's shape, not a parsing gap; SearXNG and Brave return a list. Revisit if the keyless default changes. |
| `document`: the extraction deadline cannot preempt a parser that never yields | JavaScript cannot interrupt a synchronous parse, so the deadline stops waiting and discards the result. Revisit with a worker-thread extractor if a real document needs preemption. |
| `document`: formatting, tables, and images are flattened | Extraction returns text; layout fidelity is a different product. |
| `bytefly`: `doctor.skip`, the `rates` table, and `price.peak` are JSON-only | One is a list, one a table, one a nested object: none is a scalar row. Revisit with `C2`, which would widen the picker. |
| `bytefly`: built-in extensions are not listed in the picker | Pi does not expose their authoritative names, so this needs a host change rather than a picker row. `C2` decides the picker's scope, not this. |
| `bytefly`: the update cache window is fixed at 24 hours | One check per session reuses a younger entry; a setting would add a schema row and a `doctor` line for no failure it prevents. Revisit with `C3`. |
| `bytefly`: only packages configured in Pi's settings get an update prompt, so `pi -e .` and temporary checkouts are not checked | Pi's package manager owns the list; a second detector would restore the duplicate-block class the single-notice refactor removed. Revisit if unmanaged installs need a prompt. |
| `bytefly`: the single update notice depends on patching `DefaultPackageManager.prototype.checkForAvailableUpdates` | Pi exposes no setting for its startup block. The shim is installed only in `tui`, restored on shutdown, and inert if the method shape changes. Revisit if Pi adds a supported switch. |
| `file-open`: Windows `explorer` exits non-zero after a successful open, so its status is not a failure signal | That is how `explorer` behaves; a launcher that cannot start is reported on every platform. |
| CI: macOS runs the suite serially while Windows and Linux use `--parallel=4` | Two open Bun bugs (`oven-sh/bun#41024`, `#39709`; a related one, `#45483`, filed 2026-10-16) can park a `--parallel` worker on macOS after its first subprocess spawn, which hangs a git-using test instead of failing it. Still open against Bun 1.4.3, the latest release; revisit when both close, then delete `check:serial` from the matrix. |

## 1.0 readiness

The pack is ready for 1.0 when all of these are true, not on a date. Each gate
names the items that close it, so this list cannot drift from the horizons
above.

- Every README promise has shipped behavior, a named limitation, or a `doctor`
  finding, and every limitation with no item has a row in *Deliberately left
  thin*. A review rule, not a test: read the extension READMEs against this file
  at each release; the truth tests below pin the surface, not this triage.
- No known path loses work: worktree cleanup, plan approval, job reattachment,
  a partial rewind, and WeChat turn shutdown each either preserve the work or say
  what was lost.
- State that claims to survive `/resume` and `/tree` does: goal, todo, plan
  mode, worktree binding, and the rewind timeline — each a session entry or
  tool-result `details` rebuilt from `getBranch()`, pinned by its extension's
  tests.
- The full check suite runs on Windows, macOS, and Linux, including the slow git
  suites, and the compat job names the newest Pi it passed against. macOS runs it
  serially until the upstream hang is fixed (see
  [Deliberately left thin](#deliberately-left-thin)).
- A long-session benchmark stays within its budget — measured with
  `bun run bench:render` at each release.
- A release is one reviewed command path with provenance, and the tag, changelog,
  and npm version cannot drift — `test/release.test.ts` holds the version, the
  install pins, and the changelog's one-set-per-window shape.
- Docs truth tests cover tool names and config keys, and this roadmap's own
  item numbers, links, and bucket caps resolve — `test/naming.test.ts`,
  `test/config-docs.test.ts`, and `test/roadmap.test.ts`.

## Explicit non-goals

These stay out unless a roadmap item says otherwise:

- An OS sandbox, a general branch manager, or a Pi fork.
- Semantic memory, embeddings, or automatic fact extraction.
- OCR, PPTX, EPUB, or writing and converting documents (PPTX and EPUB are
  proposed reversals, not current scope).
- Cron and scheduling, a durable job queue, or persisting watchers across
  sessions.
- Group chats, outbound media other than text and files, or model-callable sends
  to arbitrary recipients.
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
  for things that are.
- An item that needs a documented non-goal reversed is marked as a decision, not
  slipped in as a feature.
- Renumbering an item means grepping the Promise ledger, the three-things list,
  and the section intros; `test/roadmap.test.ts` fails on a dangling ID or a
  bucket over the cap.
- Small, self-contained first tasks: the dependency budget (`F1`), and the SBOM
  (`F2`) once a consumer asks for one.
