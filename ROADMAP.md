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

## Where we are (v0.12.0)

- Sixteen extensions, two themes, one shared `bytefly.json`.
- Four product groups in the README: plan and delegate, keep work safe, reach
  the world, chrome and upkeep.
- Foundations that hold: no build step, no fork, every extension optional,
  three-OS CI, a shared `lib/tui/` design system, budgeted prompt context, and
  268 co-located test files.
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

Every item ships with the same contract: behavior, tests, the extension README,
the catalog and config reference where relevant, a `CHANGELOG.md` bullet, and a
`doctor` finding if it adds a runtime prerequisite. TUI work also updates the
screenshots.

## Promise ledger

| README promise | Today | Next move |
|---|---|---|
| Plan, then execute | Strong; review state and plan history have gaps | P1–P3, P5 |
| Delegate and parallelize | Strong; child cost is not attributed | P4, P6–P8 |
| Never wreck the checkout | Works, but isolation is best-effort | S1–S9 |
| Remember across sessions | Works; store hygiene is manual | S3–S4 |
| Reach the web and your files | Broad; formats and remote media are thin | W1–W12 |
| Optional and upgradeable | Strong; docs and releases can be tighter | C1–C11, F1–F10 |

## If only three things ship

1. **P1 — Review continuity.** The plan is the pack's central promise; it has to
   survive a resume.
2. **S1 — Isolation status.** "Never wreck the checkout" becomes honest when the
   gaps are named in the session instead of only in a README.
3. **F2 — Docs truth test.** Prevent the class of defect where a shipped command
   is documented as absent.

## Horizons

| Horizon | Question | Exit condition |
|---|---|---|
| **Now** (highest priority) | Are the promises true? | No known stale doc; state survives resume; isolation gaps are visible. |
| **Next** (queued) | Does the daily loop feel finished? | Plan-to-execution handoff, pricing breadth, settings completeness, remote concurrency. |
| **Later** (parked) | Is it a platform? | Named Pi compatibility range, reproducible releases, benchmarked long sessions, expansion decisions made. |

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

- Changed-section markers need a same-session baseline; a resumed session shows
  none (`plan` README).
- Approval tracks at most 50 steps and shortens a step over 200 characters in
  the todo list (`plan` README).
- The plans directory is the only index; there is no way to discover or list
  prior plans, and reopening one requires knowing its path (`plan` README).
- A browser that never connects leaves the review waiting until cancel or abort
  (`plan` README).
- A subagent's tokens and cost are shown in its result but not attributed to the
  parent session (`subagent` README).
- `watch` cannot use bytefly's OS notification channel by design (`watch`
  README).

**Now**

- **P1 — Review continuity.** Persist the reviewed section baseline as a session
  entry (a hash per heading) so `/resume` and `/tree` mark only what actually
  changed. *Done when* a resumed session reviews a plan and the markers match
  the same session's.
- **P2 — Plan index.** Add `/plan list` over `.pi/plans` with title, modified
  time, step progress, and a path to reopen. Walk the directory; add no registry
  file. *Done when* 100 plans list from `readdir` and one bounded read per plan,
  and worktrees are respected.
- **P3 — Objective handoff.** When plan mode starts with an active goal, put the
  goal in the planning context; when a plan is approved with no goal, offer to
  record one. *Done when* the handoff costs no extra model call and never
  overwrites an existing goal.
- **P4 — Delegation accounting.** Publish a finished-subagent event, following
  the `job` pattern in `lib/events.ts`, so bytefly can show a separate child-run
  roll-up without pretending the cost belongs to the parent session. *Done when*
  the child roll-up is separate and the footer's parent total is untouched.

**Next**

- **P5 — Verification handoff.** Approval merges `## Steps` into the todo list;
  also carry the plan's `## Verification` section as the final checklist item,
  so the definition of done cannot be lost between approval and execution.
- **P6 — Job parity on Windows.** A detached job should either survive the
  session or be refused with a clear message, and unknown exit codes should be
  named in `doctor`. *Decision first:* how much Windows process control is in
  scope.
- **P7 — Alerts where the user is.** Route a `wake` match through bytefly's
  notify capability when notifications are enabled. *Decision first:* this
  reverses a documented `watch` non-goal.

**Later**

- **P8 — Delegation artifacts.** Optional per-run transcripts under
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
  through `/memory`.

**Where the promise is thin**

- The user's own `!` shell is not re-rooted; it still runs in the main checkout
  (`worktree` README).
- `skipOverrides` leaves the skipped tool unguarded for relative paths, and
  Windows `powershell` has no worktree surface (`worktree` README).
- Shell escape detection is best-effort; `eval`, `sh -c`, and command
  substitution are covered only behind `blockUnparsableCommands` (`worktree`
  README).
- Rewind is all-or-nothing, does not capture ignored files, and has no restore
  preview (`rewind` README).
- Memory injection truncates a large store with a tail note; `forget` is exact
  and near-duplicate matching is deliberately conservative (`memory` README).

**Now**

- **S1 — Isolation status.** Add `/worktree status` and a `doctor` finding that
  name every unguarded surface in this session: the user shell, a skipped
  override, Windows `powershell`, and any path the guard cannot parse. *Done
  when* enabling `skipOverrides` is visible without reading the README.
- **S2 — Restore preview.** `/rewind` shows the files and `+/-` counts a restore
  would change, and asks for confirmation when the tree is dirty. `read-tree`
  behavior is unchanged. *Done when* the preview is pure git output and tested
  without touching a real checkout.
- **S3 — Memory health.** `/memory doctor` reports note count, bytes,
  over-budget stores, and near-duplicates; the picker can merge two notes into
  one. Dedupe stays conservative. *Done when* no injection path changes and a
  merge is atomic.
- **S4 — Note promotion.** Move a note between project and global scope from the
  `/memory` picker, so a fact learned in one repository can graduate without a
  manual file copy.
- **S5 — Guard parity on Windows.** Block `powershell` escapes in the worktree
  guard the way plan mode already does, or report the gap as `degraded`. *Done
  when* a Windows test covers an escape attempt.

**Next**

- **S6 — Partial restore.** Per-file or per-directory rewind from a snapshot,
  with the same confirmation and dirty-tree rules. This reverses the current
  all-or-nothing non-goal; design the UI before the tool.
- **S7 — Worktree handoff.** A checked way to leave a worktree with a commit and
  a merge or pull-request hint, without becoming a general branch manager. The
  branch flow in `AGENTS.md` is the contract to keep.
- **S8 — Sandbox spike.** Evaluate `sandbox-exec` (macOS), `bubblewrap` (Linux),
  and a Windows job or AppContainer equivalent behind an optional setting. The
  documented non-goal stands until a spike proves the ergonomics.

**Later**

- **S9 — Snapshot visibility.** Surface storage per root and a "keep the last N"
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

- `read_doc` has no extraction timeout and no OCR; legacy `.doc` has no fixture
  (`document` README).
- A Windows launch that `explorer` refuses is not reported (`file-open` README).
- Web search quality depends on the provider; the keyless default returns
  answers and related topics, not a result list (`web-access` README).
- WeChat runs one turn at a time across peers, has no group chat, and cannot
  deliver outbound images (`wechat` README).

**Now**

- **W1 — Extraction deadline.** Add a per-call timeout and abort to `read_doc`
  so a pathological PDF cannot pin the process; keep `maxFileBytes` and
  `maxChars` unchanged. *Done when* the error names the limit and the library's
  work is abandoned cleanly.
- **W2 — `.doc` fixture.** Add a small OLE `.doc` fixture so the legacy path is
  tested for success, not only for its error message.
- **W3 — Windows launch truth.** Preflight the target and report a refused
  `explorer` launch instead of only "started"; never route through `cmd`. *Done
  when* a fake launcher test covers the refused path.
- **W4 — Provider diagnostics.** On an explicit refresh, `doctor` names the
  active search provider, whether its endpoint is reachable, and which key
  environment variable is missing. Probes stay injected and testable offline.
- **W5 — WeChat docs truth.** State exactly what pause does: stop polling,
  release the lock, and let a running turn finish. The stale "there is no pause"
  limitation is corrected with this roadmap; keep pause's runtime-local scope
  documented in one place.

**Next**

- **W6 — PPTX and EPUB.** Add both to the `document` registry using libraries
  already present where possible (`fflate`, `fast-xml-parser`), lazily imported.
  This reverses a documented non-goal; approve before building.
- **W7 — Per-peer WeChat concurrency.** Give each peer its own interaction
  channel and a fair queue, so two peers can run at once while each peer's own
  turns stay serial. *Done when* a forwarded dialog still has exactly one
  owner.
- **W8 — Outbound images.** Send images such as plan screenshots or generated
  plots to a peer, not only text and files. This reverses a non-goal; confirm the
  API shape first.
- **W9 — Structured fetch.** Teach `web_fetch` to render JSON, CSV, and XML as
  readable text instead of a raw blob. No model call and no new dependency.

**Later**

- **W10 — Group chats.** A separate admission and routing model, not a flag on
  the current bridge.
- **W11 — OCR.** Only if a local, dependency-light engine earns its install
  size; otherwise keep the explicit non-goal.
- **W12 — Readability engine.** Replace the heuristic extractor only with a
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

- **C1 — Settings completion.** Add the notify trigger toggles and a numeric
  `doctor.timeoutMs` row; allow a custom rail glyph through the text editor.
  Arrays and tables stay JSON with a pointer to the config reference. *Done when*
  no scalar setting is JSON-only.
- **C2 — Re-checkable updates.** Cache the npm result with a timestamp and let
  `/bytefly` re-run the check; show the release URL as text. *Done when* opening
  the screen never adds a network call and offline stays silent.
- **C3 — Doctor coverage audit.** One `requirements.ts` entry per runtime
  prerequisite (git, optional parser, browser or Chrome, notify method), with
  the same hint in the tool error and the report. *Done when* a test pins the
  table against the extension list.
- **C4 — Provider rate packs.** Add published rates for the major hosted
  providers (Anthropic, OpenAI, Google), each with an effective date and a
  "table may be stale" `doctor` warning. Keep Pi's recorded cost as the
  fallback. *Done when* no network is required and an unknown model still shows
  no invented price.
- **C5 — Theme contrast test.** Assert WCAG AA contrast for the semantic role
  pairs in both themes. *Done when* the test fails on a palette regression, not
  on a theme swap.

**Next**

- **C6 — Control-center breadth.** *Decision first:* do themes, skills, and
  prompts belong in the picker or stay with `pi config`? If added, they need the
  same health and scope rules as extensions.
- **C7 — Spend guardrail.** A session budget in `price` that warns once at a
  threshold and can notify through the existing capability. No hard stop by
  default.
- **C8 — Price freshness.** Record when a built-in table was last verified and
  surface its age in `doctor`, so a tariff change is visible instead of silently
  wrong.
- **C9 — Update channels.** An opt-in prerelease or tagged-channel preference,
  still with no auto-update.

**Later**

- **C10 — Update action.** Offer `pi update --extensions` from the control
  center behind a confirmation, only if the host exposes a safe way to run it.
- **C11 — More currencies.** Generalize the rates table beyond CNY and USD only
  when a user actually needs a third unit.

## 5. Foundations

These are not a README pillar, but every promise depends on them.

**Now**

- **F1 — Docs parity.** Keep the Chinese README in line and add a parity test
  for section headings, table rows, and links. Policy: the two entry READMEs
  stay in sync; deep docs remain English until a translation owner exists.
- **F2 — Docs truth test.** Extend the existing config-docs and naming checks to
  commands and documented flags: a command named in `docs/extensions.md` must be
  registered, and a key in the config reference must exist. *Done when* a
  renamed command or removed key fails CI.
- **F3 — Compatibility floor.** Add a CI job that installs the newest Pi peer
  packages, runs typecheck and the suite, and loads every extension through the
  fake runtime; document the tested range. Peer ranges stay `"*"`; the job names
  what was tested.
- **F4 — Long-session benchmark.** A script reports render time and allocations
  for 500 and 2000 tool blocks at 80 and 120 columns. Keep the hard gate
  deterministic (same input, same line array) and treat wall-clock as a
  pre-release check, not a flaky CI test.
- **F5 — Release provenance.** Publish npm with `--provenance` from a protected
  workflow that still requires the per-release approval `AGENTS.md` mandates;
  update the release guide to match.
- **F6 — CI debt.** Track the Bun macOS parallel-spawn bugs that force the
  serial suite and remove the workaround when fixed, so all three operating
  systems run one command.

**Next**

- **F7 — Changelog hygiene.** One `Added`/`Changed`/`Fixed` set per release
  window; add a check if duplicate subsection headings recur. There are two
  `### Added` headings under `[Unreleased]` today.
- **F8 — Test expansion.** Browser-page and plan-review coverage through the
  pure router and rendered HTML, without a real browser in CI.
- **F9 — Dependency budget.** A check that a new runtime dependency is
  lazy-loaded unless it is needed at registration, matching the `document` and
  `web-access` pattern.

**Later**

- **F10 — Signed artifacts and SBOM.** Generate an SBOM per release if consumers
  ask; do not add ceremony before then.

## 1.0 readiness

The pack is ready for 1.0 when all of these are true, not on a date:

- Every README promise has shipped behavior, a named limitation, or a `doctor`
  finding. No sentence describes a feature that does not exist.
- No known path loses work: worktree cleanup, rewind restore, plan approval, job
  reattachment, and WeChat turn shutdown each either preserve the work or say
  what was lost.
- State that claims to survive `/resume` and `/tree` does: goal, todo, plan
  mode, worktree binding, and the rewind timeline.
- The full check suite runs on Windows, macOS, and Linux, including the slow git
  suites, with a named tested Pi range.
- A long-session benchmark stays within its budget.
- A release is one reviewed command path with provenance, and the tag, changelog,
  and npm version cannot drift.
- Docs truth tests cover tools, commands, and config keys.

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

- Review at each minor release: delete what shipped (the changelog is the
  record), re-rank what remains, and add an item only with a concrete acceptance
  condition.
- An item that needs a documented non-goal reversed is marked as a decision, not
  slipped in as a feature.
- Small, self-contained first tasks: the Chinese README parity test, the `.doc`
  fixture, the docs truth check, and the duplicate changelog heading.
