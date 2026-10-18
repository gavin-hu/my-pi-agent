# Roadmap

What this pack is trying to become, and the next work that gets it there.
Derived from [`README.md`](./README.md), the limitations each extension already
documents, and the history in [`CHANGELOG.md`](./CHANGELOG.md). Items are
proposals, not release commitments; the changelog is the record of what shipped.

## North star

The README makes one promise: **plan before you act, delegate the work, keep the
main checkout clean, and carry context across sessions** — without forking Pi.
The roadmap is ordered by how directly an item makes that sentence true.

The pack already has breadth: sixteen extensions and two themes. The next stage
is not more surface area. It is making the existing promises exact, continuous
across `/resume` and `/tree`, and honest where a platform cannot deliver.

## Where we are

- Sixteen extensions, two themes, one shared `bytefly.json`.
- Four product groups in the README: plan and delegate, keep work safe, reach
  the world, chrome and upkeep.
- Foundations that hold: no build step, no fork, every extension optional,
  three-OS CI, a shared `lib/tui/` design system, budgeted prompt context, 268
  co-located test files and seven package-level ones.
- Recent releases focused on the plan review browser, CNY/USD pricing, inline
  text editing in `/bytefly settings`, and moving exhaustive docs into
  `docs/references/`.

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

| README promise | Today | Next move |
|---|---|---|
| Plan, then execute | Strong; review state and plan history have gaps | — |
| Delegate and parallelize | Strong; a child run's cost now has its own footer roll-up, and folding it into the parent total stays a documented non-goal | P1–P3 |
| Never wreck the checkout | Works, but isolation is best-effort | S1–S5 |
| Remember across sessions | Works; the store reports its own health | — |
| Reach the web and your files | Broad; formats and remote media are thin | W1–W7 |
| Optional and upgradeable | Strong; docs and releases can be tighter | C1–C10, F1–F6 |

## If only three things ship

1. **C2 — Re-checkable updates.** The npm update check should cache with a
   timestamp and re-run on demand, so a release is visible without a restart.
2. **S1 — Guard parity on Windows.** Block `powershell` escapes in the worktree
   guard the way plan mode already does, or report the gap as `degraded`.
3. **F1 — Release provenance.** Publish npm with `--provenance` from a protected
   workflow that still requires the per-release approval, so a published release
   is verifiably built from this repository.

## Horizons

| Horizon | Question | Exit condition |
|---|---|---|
| **Now** (highest priority) | Are the promises true? | No known stale doc; every isolation gap is visible in the session; the suite runs on a named Pi range and a long-session benchmark holds. |
| **Next** (queued) | Does the daily loop feel finished? | Plan-to-execution handoff, note promotion, settings completeness. |
| **Later** (parked) | Is it a platform? | Reproducible releases, benchmarked long sessions, expansion decisions made. |

Horizons are priority tiers, not dated commitments. A minor release ships
whatever is ready; this project releases often and treats the changelog, not
this file, as the record of what shipped.

## 1. Plan and delegate

**README promise:** "Plan, then execute." and "Delegate and parallelize."

**Today**

- `plan`: four tools, `/plan`, `--plan`, `Ctrl+Alt+P`, a TUI review, and a
  loopback browser review with inline comments.
- `subagent`: eight built-in agents, single/parallel/chain, read-only mode.
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
- `watch` cannot use bytefly's OS notification channel by design (`watch`
  README).

**Now**

Nothing here makes a false promise today: a plan the user reviewed cannot lose
steps to the cap any more, and the rest is documented behavior. This section
contributes no `Now` item.

**Next**

- **P1 — Job parity on Windows.** A detached job should either survive the
  session or be refused with a clear message, and unknown exit codes should be
  named in `doctor`. *Decision first:* how much Windows process control is in
  scope.
- **P2 — Alerts where the user is.** Route a `wake` match through bytefly's
  notify capability when notifications are enabled. *Decision first:* this
  reverses a documented `watch` non-goal.
- **P3 — Delegation artifacts.** Optional per-run transcripts under
  `.pi/subagents/` for audit and handoff. This reverses the current
  no-persistence non-goal; only with a retention rule.

## 2. Keep your work safe

**README promise:** "Never wreck the checkout." and "Remember across sessions."

**Today**

- `worktree`: re-roots the built-in file and shell tools, guards absolute paths
  and shell escapes, and refuses to discard a dirty worktree.
- `rewind`: one git-ref snapshot per prompt, restore code/conversation/both,
  with `max` and `autoPrune`.
- `memory`: project and global markdown notes, injected each run, managed
  through `/memory` (add, edit, forget, merge, and move between scopes).

**Where the promise is thin**

- The user's own `!` shell is not re-rooted; it still runs in the main checkout
  (`worktree` README).
- `skipOverrides` leaves the skipped tool unguarded for relative paths, and
  Windows `powershell` has no worktree surface (`worktree` README).
- Shell escape detection is best-effort; `eval`, `sh -c`, and command
  substitution are covered only behind `blockUnparsableCommands` (`worktree`
  README).
- Rewind is all-or-nothing and captures no ignored file (see
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

- **S1 — Guard parity on Windows.** Block `powershell` escapes in the worktree
  guard the way plan mode already does, or report the gap as `degraded`. *Done
  when* a Windows test covers an escape attempt.

**Later**

- **S2 — Partial restore.** Per-file or per-directory rewind from a snapshot,
  with the same confirmation and dirty-tree rules that the whole-tree restore
  already has. This reverses the current all-or-nothing non-goal; design the UI
  before the tool.
- **S3 — Worktree handoff.** A checked way to leave a worktree with a commit and
  a merge or pull-request hint, without becoming a general branch manager. The
  branch flow in `AGENTS.md` is the contract to keep.
- **S4 — Sandbox spike.** Evaluate `sandbox-exec` (macOS), `bubblewrap` (Linux),
  and a Windows job or AppContainer equivalent behind an optional setting. The
  documented non-goal stands until a spike proves the ergonomics.
- **S5 — Snapshot visibility.** Surface storage per root and a "keep the last N"
  recommendation. `max` and `autoPrune` already prune, so this is visibility,
  not a new mechanism.

## 3. Reach the world

**README promise:** "Reach the web and your files."

**Today**

- `web-access`: keyless DuckDuckGo, optional SearXNG or Brave, readable fetch,
  paging, `find`, per-hop SSRF checks, optional PDF.
- `file-browse`: loopback read-only browser with Markdown preview, a diff view,
  and quick open.
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

**README promise:** the `/bytefly` control center, ten curated settings, priced
runs, an update check, and two themes.

**Today**

- Bytefly owns the header, footer, turn rule, notices, tool frame, live working
  row, control center, doctor, notify, price, and update check.
- Settings exposes ten scalar rows across six groups, with inline text editing.
- DeepSeek is priced from its published CNY and USD tables, with peak and
  off-peak windows.

**Where the promise is thin**

- Settings cover scalars only: notify trigger flags, `doctor.skip`,
  `doctor.timeoutMs`, the `rates` table, and `price.peak` remain JSON (`bytefly`
  README).
- The picker manages only the `extensions` resource type and does not list
  built-in extensions (`bytefly` README).
- The update check reads npm `latest` once per session, has no refresh, no
  channel preference, and no release-notes link (`bytefly` README).
- Only DeepSeek has a built-in rate table (`bytefly` README).

**Now**

Nothing here makes a false promise today. The gaps above are documented
behavior, and the one that is not (`C1`) needs a decision before it is work, so
this section contributes no `Now` item.

**Next**

- **C1 — Settings completion.** Add the notify trigger toggles and a numeric
  `doctor.timeoutMs` row, and allow a custom rail glyph through the text editor.
  *Decision first:* the glyph half reverses the `bytefly` README's "the rail
  glyph picker stays curated" limitation, and the accepted value must satisfy
  `visibleWidth(glyph) === 1` or the transcript indent breaks. Arrays and tables
  stay JSON with a pointer to the config reference. *Done when* no scalar
  setting is JSON-only and a two-column glyph is refused with a reason.
- **C2 — Re-checkable updates.** Cache the npm result with a timestamp and let
  `/bytefly` re-run the check; show the release URL as text. *Done when* opening
  the screen never adds a network call and offline stays silent.

**Later**

- **C3 — Provider rate packs.** Add published rates for the major hosted
  providers (Anthropic, OpenAI, Google), each with an effective date and a
  "table may be stale" `doctor` warning. Keep Pi's recorded cost as the
  fallback. *Done when* no network is required and an unknown model still shows
  no invented price.
- **C4 — Theme contrast test.** Assert WCAG AA contrast for the semantic role
  pairs in both themes. *Done when* the test fails on a palette regression, not
  on a theme swap.
- **C5 — Control-center breadth.** *Decision first:* do themes, skills, and
  prompts belong in the picker or stay with `pi config`? If added, they need the
  same health and scope rules as extensions.
- **C6 — Spend guardrail.** A session budget in `price` that warns once at a
  threshold and can notify through the existing capability. No hard stop by
  default.
- **C7 — Price freshness.** Record when a built-in table was last verified and
  surface its age in `doctor`, so a tariff change is visible instead of silently
  wrong.
- **C8 — Update channels.** An opt-in prerelease or tagged-channel preference,
  still with no auto-update.
- **C9 — Update action.** Offer `pi update --extensions` from the control
  center behind a confirmation, only if the host exposes a safe way to run it.
- **C10 — More currencies.** Generalize the rates table beyond CNY and USD only
  when a user actually needs a third unit.

## 5. Foundations

These are not a README pillar, but every promise depends on them.

**Now**

Nothing here makes a false promise today: the docs are checked against the code,
the catalog, and each other, and the remaining gaps are listed as items below.
This section contributes no `Now` item.

**Next**

- **F1 — Release provenance.** Publish npm with `--provenance` from a protected
  workflow that still requires the per-release approval `AGENTS.md` mandates;
  update the release guide to match.

**Later**

- **F2 — CI debt.** Track the Bun macOS parallel-spawn bugs that force the
  serial suite and remove the workaround when fixed, so all three operating
  systems run one command.
- **F3 — Changelog hygiene.** One `Added`/`Changed`/`Fixed` set per release
  window; add a check if duplicate subsection headings recur.
- **F4 — Test expansion.** Browser-page and plan-review coverage through the
  pure router and rendered HTML, without a real browser in CI.
- **F5 — Dependency budget.** A check that a new runtime dependency is
  lazy-loaded unless it is needed at registration, matching the `document` and
  `web-access` pattern.
- **F6 — Signed artifacts and SBOM.** Generate an SBOM per release if consumers
  ask; do not add ceremony before then.

## Deliberately left thin

Documented limitations that have no item, so a reader can tell a gap that was
triaged from one that was missed. Each row names the condition that would reopen
it.

| Limitation | Why it has no item |
|---|---|
| `plan`: no PowerShell while planning | The read-only shell is Git Bash by design; PowerShell needs a second parser and guard. Revisit with `S4`. |
| `plan`: a browser that never connects waits until the user cancels, closes the tab, or aborts | Waiting is the intended behavior — the page can be opened minutes later. The URL is announced, and auto-declining would lose a slow reader. |
| `rewind`: `.gitignore`d files are not captured | An explicit non-goal; revisit with `S2`. |
| `rewind`: a restore is all-or-nothing | A non-goal until `S2`; the confirmation already previews the change. |
| `document`: no OCR | `W6` is a non-goal until a dependency-light engine exists. |
| `document`: the extraction deadline cannot preempt a parser that never yields | JavaScript cannot interrupt a synchronous parse, so the deadline stops waiting and discards the result. Revisit with a worker-thread extractor if a real document needs preemption. |
| `document`: formatting, tables, and images are flattened | Extraction returns text; layout fidelity is a different product. |
| `bytefly`: built-in extensions are not listed in the picker | Pi does not expose their authoritative names. `C5` is the decision, not a fix. |
| `watch`: cannot raise an OS notification | `P2` reverses it; the in-session alert is documented until then. |
| `file-open`: Windows `explorer` exits non-zero after a successful open, so its status is not a failure signal | That is how `explorer` behaves; a launcher that cannot start is reported on every platform. |

## 1.0 readiness

The pack is ready for 1.0 when all of these are true, not on a date. Each gate
names the items that close it, so this list cannot drift from the horizons
above.

- Every README promise has shipped behavior, a named limitation, or a `doctor`
  finding, and every limitation with no item has a row in *Deliberately left
  thin* — enforced by `test/docs-truth.test.ts`, `test/naming.test.ts`, and
  `test/config-docs.test.ts`.
- No known path loses work: worktree cleanup, plan approval, job reattachment,
  and WeChat turn shutdown each either preserve the work or say what was lost —
  `P1`, `S1`.
- State that claims to survive `/resume` and `/tree` does: goal, todo, plan
  mode, worktree binding, and the rewind timeline — each a session entry or
  tool-result `details` rebuilt from `getBranch()`, pinned by its extension's
  tests.
- The full check suite runs on Windows, macOS, and Linux, including the slow git
  suites, and the compat job names the newest Pi it passed against — `F2`.
- A long-session benchmark stays within its budget — measured with
  `bun run bench:render` at each release.
- A release is one reviewed command path with provenance, and the tag, changelog,
  and npm version cannot drift — `F1`, `F3`.
- Docs truth tests cover tools, commands, and config keys, and this roadmap's own
  item numbers and links resolve — `test/naming.test.ts`,
  `test/docs-truth.test.ts`, `test/config-docs.test.ts`, and
  `test/roadmap.test.ts`.

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
- Small, self-contained first tasks: the Chinese README parity test, the `.doc`
  fixture, the docs truth check.
