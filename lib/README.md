# lib — shared extension helpers

Small modules imported by two or more extensions. Pi loads each extension with
an **isolated module cache**, so these are *value-only* libraries: pure
functions, constants, and classes. Never keep cross-extension state here — a
module-level variable would have one copy per extension, not one shared copy.
`test/boundaries.test.ts` fails a module-scope `let`, `var`, `Map`, `WeakMap`, or
empty array, so this is a test and not a convention. The single exception is the
event-bus pattern in `rails.ts`, where the state lives in the caller's closure,
not in this module.

This directory sits outside `extensions/` on purpose: nothing here is a
loadable extension entrypoint, and every module is a contract shared *between*
extensions rather than private to one. A helper used by only one extension
belongs in that extension instead — see `extensions/web-access/http.ts` and
`extensions/plan/path-guard.ts`.

Here the modules also divide by direction, not only by topic: `workflow/` is the
domain, `git/` and `plans/` are the compute halves it may use, and `http/`,
`web/`, `tui/`, `diff/` and `browser.ts` are surfaces it may not reach — nor may
they reach it. `test/layering.test.ts` holds both halves, so the tree stays a
ladder rather than one flat namespace.

| Module | Responsibility |
|---|---|
| [`browser.ts`](./browser.ts) | Opening a page in the default browser: `browserCommand`, `openPageInBrowser`, `urlLauncher`, `launchDetached`, `$BROWSER`. |
| [`bus-request.ts`](./bus-request.ts) | The one-shot request/response over `pi.events`: `BusAnswer`, `BusRequest`, `requestOverBus`, `answerOn`, `ANSWER_BOUND_MS`. |
| [`config.ts`](./config.ts) | The `bytefly.json` document and its atomic writers: `loadConfigFile`, `SHARED_CONFIG_FILE`, `configSection`, `configValueAt`, `loadConfigSection`, `writeConfigFile`, `writeConfigSection`, `writeConfigValue`, `writeConfigValueAt`, `writeConfigValuesAt`, `unsetConfigValueAt`. |
| [`json.ts`](./json.ts) | The untrusted-JSON boundary: `clampInteger`, `clampNumber`, `cleanString`, `optionalString`, `asBoolean`, `stringList`, `asRecord`, `asNumber`, `memberOf`, `readJson`, `readJsonResult`, `writeJsonFile`, `tempPathFor`, `writeTextAtomic`. |
| [`env.ts`](./env.ts) | Env-var contracts: `ENV_ROOT`, `worktreeRoot`, `resolveEffectiveCwd`, `effectiveRealCwd`, `extensionEnablement`, `ENV_DISABLED_EXTENSIONS`. |
| [`escape.ts`](./escape.ts) | `escapeHtml`: the single HTML text/attribute escape used by the browse page renderers and the Markdown and syntax highlighters, plus `decodeCodePoint`, the other half of the same boundary — one numeric character reference as text, with a surrogate or out-of-range value decoded to U+FFFD. |
| [`events.ts`](./events.ts) | The inter-extension `pi.events` channels and payloads: `JOB_FINISHED_CHANNEL`, `SUBAGENT_FINISHED_CHANNEL`, `WORKTREE_CHANGED_CHANNEL`, `WEB_SEARCH_PROVIDER_CHANNEL`, and their event types. |
| [`notice.ts`](./notice.ts) | The shared transcript notice: `NOTICE_TYPE`, `NoticeDetails`, `NoticeItem`, `noticeMessage`, `isNotice`, `pruneStaleNotices`, `burstText`, `retainNewest`. |
| [`report.ts`](./report.ts) | The pending-report channel: `createPendingReporter`, `registerPendingChannel`, and the turn-edge handlers that report at the next turn. |
| [`errors.ts`](./errors.ts) | The unknown-throw boundary: `messageOf`, `hasErrorCode`, `attempt`. |
| [`format.ts`](./format.ts) | Text and number formatting for renderers: `formatTokens`, `formatCount`, `formatDuration`, `formatSize`, `formatAge`, `ageWords`, `plural`, `clipText`, `boundedTail`, `stripControlChars`, `sanitize`, `sanitizeLine`, `lineOf`, `sanitizeUntrustedLine`, `sanitizeUntrustedText`, `MAX_OUTPUT_LINE`, `overLimit`, `tooManyPaths`, `EMPTY_PATH`, `outsideRepository`, `pathRef`, `shortenPath`, `pageSource`. |
| [`timer.ts`](./timer.ts) | Cancellable timer seams: `ArmTimer`, `defaultTimer`, `RepeatTimer`, `defaultInterval`, `abortableSleep`. |
| [`lines.ts`](./lines.ts) | `LineSplitter`, the byte-safe splitter for a stream of program output: buffers bytes and decodes only at a newline, so a UTF-8 character split across two reads survives, and caps an over-long line instead of dropping it. Shared by `job`, `watch`, and `subagent`. |
| [`pool.ts`](./pool.ts) | `mapConcurrent`: one async read per entry with at most `limit` calls in flight and results in input order, so a directory listing or a status sweep fans out without an unbounded burst or a per-entry round trip. Shared by `file-browse` and `worktree`. |
| [`qr.ts`](./qr.ts) | The QR seam shared by `wechat`'s login and `plan`'s shared review link: `qrMatrix` (the module matrix), `qrLines` (Unicode half-block terminal lines of a fixed width), and `qrSvg` (inline markup a page can paste); the `qrcode` package is imported on first use, never at registration. |
| [`interaction.ts`](./interaction.ts) | The remote-interaction channel: `INTERACTION_TURN_KEY`, `markRemoteTurn`, `InteractionChannel`, `setPromptTimeout`, `isRemoteTurn`, `remoteLanguage`, `dialogLanguage`, `supportsCustomUI`, `askHuman`, `timeoutMs`. |
| [`lazy.ts`](./lazy.ts) | Deferred module loading: `lazy`, `assertDeferredPresent`, `deferredSpecifiers`. |
| [`diff/`](./diff/) | The change vocabulary a diff page reads, in four modules: [`diff/modes.ts`](./diff/modes.ts), [`diff/parse.ts`](./diff/parse.ts), [`diff/status.ts`](./diff/status.ts), [`diff/render.ts`](./diff/render.ts), [`highlight.ts`](./highlight.ts) |
| [`git/`](./git/) | Shared git plumbing: [`git/runner.ts`](./git/runner.ts), [`git/read.ts`](./git/read.ts), [`git/read-command.ts`](./git/read-command.ts), [`git/index.ts`](./git/index.ts) |
| [`highlight.ts`](./highlight.ts) | First-party, escape-first syntax tokenizer (`detectLanguage`, `fenceLanguage`, `highlightLines`, `HighlightLanguage`, `TokenClass`) for js/ts, json, css, html, shell, python, java, yaml, and sql; shared by `file-browse` and plan's code blocks. |
| [`http/`](./http/) | The loopback HTTP layer shared by `file-browse`, `plan` and `board`: [`http/serve.ts`](./http/serve.ts), [`http/mount.ts`](./http/mount.ts), [`http/sink.ts`](./http/sink.ts), [`http/headers.ts`](./http/headers.ts), [`http/response.ts`](./http/response.ts), [`http/compress.ts`](./http/compress.ts), [`http/router.ts`](./http/router.ts), [`http/guard.ts`](./http/guard.ts), [`http/token.ts`](./http/token.ts), [`http/port.ts`](./http/port.ts), [`http/server.ts`](./http/server.ts), [`http/index.ts`](./http/index.ts), [`http/mount.ts`](./http/mount.ts) |
| [`tui/`](./tui/) | The terminal design system shared by every interactive surface, documented in `tui/README.md`: [`tui/README.md`](./tui/README.md), [`tui/tokens.ts`](./tui/tokens.ts), [`tui/glyphs.ts`](./tui/glyphs.ts), [`tui/chrome.ts`](./tui/chrome.ts), [`tui/rules.ts`](./tui/rules.ts), [`tui/indent.ts`](./tui/indent.ts), [`tui/rows.ts`](./tui/rows.ts), [`tui/columns.ts`](./tui/columns.ts), [`tui/gauge.ts`](./tui/gauge.ts), [`tui/line-pane.ts`](./tui/line-pane.ts), [`tui/status-controller.ts`](./tui/status-controller.ts), [`tui/dock-screen.ts`](./tui/dock-screen.ts), [`tui/confirm.ts`](./tui/confirm.ts), [`tui/tool.ts`](./tui/tool.ts), [`tui/render-cache.ts`](./tui/render-cache.ts), [`tui/cursor.ts`](./tui/cursor.ts) |
| [`path.ts`](./path.ts) | Path arithmetic and containment: `normalizeTarget`, `posixPath`, `isInside`, `realPathOfNearest`, `isInsideReal`, `lastSegment`, `encodePath`. |
| [`pdf.ts`](./pdf.ts) | The optional `unpdf` seam shared by `web-access` and `file-read`: `pdfGuidance`, `PdfUnavailableError`, `pdfTextFromResult`, and the lazy `extractPdfText` (an injected extractor wins), so a missing package and a merged-pages result read the same way through either surface. |
| [`pi-invocation.ts`](./pi-invocation.ts) | `getPiInvocation`: how to launch a nested `pi` process, shared by `subagent` and bytefly's doctor surface. |
| [`policy.ts`](./policy.ts) | The read-only policy: `createReadOnlyPolicy`, `readOnlyHint`, `WORKSPACE_READERS`, `isBoardRead`, `isBoardWork`, `isSubagentWork`. |
| [`mode-state.ts`](./mode-state.ts) | The branch's one mode: `SessionMode`, `SESSION_MODES`, `isSessionMode`, `PLAN_MODE_ENTRY_TYPE`, `LEAD_MODE_ENTRY_TYPE`, `lastModeState`, `modeOf`, `isPlanModeEnabled`, `mayEnter`. |
| [`mode-entry.ts`](./mode-entry.ts) | A mode's entry and its refusals: `READ_ONLY_SUMMARY`, `PLAN_CONSENT`, `planConsent`, `PLAN_ENTER_REQUEST`, `PLAN_TOGGLE_REQUEST`, `PLAN_LEAVE_REQUEST`, `PlanModeRequest`, `isPlanExtensionLoaded`, `requestPlanMode`, `requestPlanToggle`, `requestPlanLeave`, `LeashedMode`, `modeRefusal`. |
| [`rails.ts`](./rails.ts) | Above-editor widget ordering (`goal` → `todo`) and dock-screen suppression, carried on `pi.events`. |
| [`repo-key.ts`](./repo-key.ts) | The per-repository key and its stores: `reposRoot`, `repoStoreDir`, `storeIdOf`, `worktreeRootFor`, `repoKeyOf`, `REPO_KEY_LENGTH`, `repoKeyFor`, `repoIdFor`. |
| [`plans/paths.ts`](./plans/paths.ts) | Where a plan lives and which paths are one: `PLANS_DIR_NAME`, `plansDir`, `isPlanFileName`, `isContainedPlan`, `resolvePlanArg`. |
| [`storage.ts`](./storage.ts) | Private files and their modes: `DIR_MODE`, `FILE_MODE`, `ensurePrivateDir`, `tightenMode`, `RESERVED_PATHS`. |
| [`screen-session.ts`](./screen-session.ts) | `withPolledScreen`: mount one `ctx.ui.custom` dock screen — rails suppressed for its lifetime, an optional repaint tick through an injected `RepeatTimer`, and one teardown — handing the mount the host's `tui`, `theme`, `requestRender`, `close`, and `viewportRows`. Shared by `/jobs`, `/watch`, and `/memory`, whose rails window and timer window were the same one. |
| [`serve-config.ts`](./serve-config.ts) | The `serve` section of the shared `bytefly.json`, owned here because three extensions answer it: `ServeConfig` with `port` (`0` takes the project's own, a positive value pins it) and `autoOpen` (whether `/browse` and `/board` open a tab), beside `DEFAULT_SERVE_CONFIG`, `normalizeServeConfig`'s clamp and boolean, and `loadServeConfig`. |
| [`workflow/`](./workflow/) | The shared feature board — the record, its lifecycle, the store, and the shapes every surface renders — whose per-module reasoning is its own doc: [`workflow/README.md`](./workflow/README.md). |
| [`workflow/card.ts`](./workflow/card.ts) | The card record and its boundary: `Card`, the field caps, the `normalize*` rules, the id's own spelling — `canonicalCardId`, `normalizeCardId`, `cardRef`, and `cardArg` / `cardRefOf`, which read a tool's `card` argument once so every refusal and every call line agree — `isOwner`, priority, `matchesQuery`, `stateAt` (the write a signature speaks for) and `laneSince`. |
| [`workflow/ended.ts`](./workflow/ended.ts) | A finished card: `EndedCard`, `isEndedCard`. |
| [`workflow/kind.ts`](./workflow/kind.ts) | What kind of work a card is and whether it breaks an existing user: `CARD_TYPES`, `normalizeType`, `normalizeBreaking`, and `breakingOf`, which reads an absent marker as not breaking. |
| [`workflow/read.ts`](./workflow/read.ts) | Reading the pile: `readCard`, `scanPile`. |
| [`workflow/landing.ts`](./workflow/landing.ts) | Resolving a close's landing: `resolveLanding`, `landingGate`, `landingFor`. |
| [`workflow/lanes.ts`](./workflow/lanes.ts) | The lanes and their moves: `LANES`, `LANE_RULES`, `TRANSITIONS`, `contractRoute`, `move`, `CardBlock`, `BLOCKERS`, `BlockerKind`, `MAX_BLOCKED`, `normalizeBlock`, `blockFields`, `isBlock`, `isCard`. |
| [`workflow/contract.ts`](./workflow/contract.ts) | What a card promises before execution: the three fields, the completeness gate, the sign an edit drops, and the merge a review became. |
| [`workflow/links.ts`](./workflow/links.ts) | The dependency graph over an index: blockers, readiness, dependents, cycles, and one stored edge per link. |
| [`workflow/limits.ts`](./workflow/limits.ts) | The WIP arithmetic and its refusal; the numbers themselves are `workflow/config.ts`'s. |
| [`workflow/notice.ts`](./workflow/notice.ts) | The workflow's notices: `composeNotice`, `NOTICES`, `NoticeKind`, `NoticeContext`, `handoffText`, `noticeText`, `offerText`, `actorFor`, `ownerFor`. |
| [`workflow/activity.ts`](./workflow/activity.ts) | The board's activity line: `activityOf`, `ActivityEvent`, `ACTIVITY_LIMIT`, `ACTIVITY_LABEL`, `ACTIVITY_KINDS`. |
| [`workflow/artifact.ts`](./workflow/artifact.ts) | An artifact's refusal: `artifactRefusal`, `artifact`. |
| [`workflow/rules.ts`](./workflow/rules.ts) | The lifecycle as a pure dispatch: `createCard`, `mayOp`, `applyOp`, `closedArchive` — the sentence a card in the archive answers a write with, asked before any step runs — and the one write that bumps the revision. |
| [`workflow/steps.ts`](./workflow/steps.ts) | The card operations: `claim`, `assign`, `move`, `shelve`, `unshelve`, `note`, `approve`, `review`, `drop`. |
| [`workflow/actions.ts`](./workflow/actions.ts) | The action list, which of them only read it, and which of them can change a working tree — the tables the tool, the read-only policy and the todo nudge share. |
| [`workflow/store.ts`](./workflow/store.ts) | The backend and the only writer: the card files, the id allocator, `mutate`'s locked re-check, and the archive pile, over the pile `workflow/read.ts` reads. |
| [`store-paths.ts`](./store-paths.ts) | Moving a store to its repository key: `migrateStoreDir` and its answers. |
| [`workflow/ids.ts`](./workflow/ids.ts) | Card numbering: `nextCardId`, `NEXT_ID_FILE`. |
| [`workflow/lock.ts`](./workflow/lock.ts) | The board's write lock: `lockBoard`, `.lock-board`, `LOCK_WAIT_MS`, `LOCK_STALE_MS`. |
| [`workflow/config.ts`](./workflow/config.ts) | The `board` section of `bytefly.json`, read once and handed to `applyOp` whole. |
| [`workflow/session.ts`](./workflow/session.ts) | The session a call works as: one store per directory, the seat, the id a card records, the bus's directory and its records, and `cross` — the lane crossing every write reports, loaded on the first one. |
| [`workflow/proven-remove.ts`](./workflow/proven-remove.ts) | Removing a file only when proved: `removeIfProven`. |
| [`workflow/claims.ts`](./workflow/claims.ts) | The bus's path claims as a card's lane wants them: `holdPaths`, `reclaimHeld`. |
| [`workflow/join.ts`](./workflow/join.ts) | The session's team standing: `onTeam`, `joinTeam`, `TeamState`, `standingOf`, `teamStatus`, `NOT_ON_TEAM`, `createMemberTools`, `solo`. |
| [`workflow/seat.ts`](./workflow/seat.ts) | The actor `team.lead` names. |
| [`workflow/signs.ts`](./workflow/signs.ts) | What a sign is: who may write one (`Lead`, `isLead`, `personActor`/`isPerson`), what it records (`signMark`/`signedAs`), and which one still speaks (`laneReview`, `signStale`, `currentReview`, and the four bodies as the page receives them) — with `HolderFact` and the note cap's one arithmetic. |
| [`workflow/lead.ts`](./workflow/lead.ts) | The gate ladder: who may move, sign, close or take a card back, the spot-check's own write and the run it holds to the contract's command, and every sentence that says why not — the words the ladder itself builds. |
| [`workflow/changelog.ts`](./workflow/changelog.ts) | The `[Unreleased]` line: `headingFor`, `insertBullet`, `lowerFirst`, `CHANGELOG_SECTIONS`. |
| [`workflow/land-subject.ts`](./workflow/land-subject.ts) | A landing's words: `landScope`, `landScopeProblem`, `landTitle`, `landSubject`, `landBullet`. |
| [`workflow/land-verb.ts`](./workflow/land-verb.ts) | Which verb runs: `VERB_SOURCES`, `verbSources`, `verbFingerprint`, `IMPORTED_LAND_FINGERPRINT`, `staleVerb`, `signedVerb`, `SignedVerb`. |
| [`workflow/land.ts`](./workflow/land.ts) | The landing verb: `landCard`, `parseNumstat`, `RunGit`. |
| [`workflow/suite-declarations.ts`](./workflow/suite-declarations.ts) | What a merge may delete: `declaredSuites`, `EXTENSION_SUITES`, `suiteFileOf`, `SuiteOwner`, `DeclaredSuite`, `withoutComments`, `literalBody`, `extensionGroups`. |
| [`workflow/round.ts`](./workflow/round.ts) | The lead's round: `gateOf`, `unassigned`. |
| [`workflow/round-text.ts`](./workflow/round-text.ts) | The round's rows: `withLiveOwner`, `LEAD_ROUND`, `teamPhrase`. |
| [`workflow/skipped.ts`](./workflow/skipped.ts) | The sentence for the card files a board refused. |
| [`workflow/view.ts`](./workflow/view.ts) | The page's snapshot: the shape a client knows. |
| [`workflow/page-pointer.ts`](./workflow/page-pointer.ts) | How a session finds a page already serving, and proves a stale note dead before taking it over. |
| [`workflow/verify.ts`](./workflow/verify.ts) | The acceptance command a contract names and the one run a spot-check records: `runVerification` (a shell in the card's directory, bounded and tree-killed, its output tail kept for the refusal), `verifiedCommand`, `verifySpotCheck` for both sign doors, and `shaOf` for the commit the sign carries. |
| [`workflow/tone.ts`](./workflow/tone.ts) | What colour a lane, a reason, and a decision row wear, the words and rank a decision wears, and the order a queue reads them in, as the tables both surfaces read. |
| [`workflow/reason.ts`](./workflow/reason.ts) | Why a card sits where it does: one sentence for the card face, the lead's queue, and the transcript. |
| [`session-files.ts`](./session-files.ts) | The bus on disk: the layout names, `busPaths`, `writeJsonAtomic`, `publishNew`, `readDocument`, `readDocuments`, `dropStaleTemps`, `SessionRecord`, `ClaimRecord`, `SessionMode`, `WatchMode`, `parseSessionRecord`, `parseClaimRecord`, `storedName`, `HostRecord`, `HostIdentity`, `readHostIdentity`, `ensureHostIdentity`. |
| [`session-roster.ts`](./session-roster.ts) | The bus read as rows: `readRoster`, `RosterSession`, `readTeam`, `recordFacts`, `rosterStateOf`, `SESSION_TTL_MS`, `PeerRow`, `peerRowOf`, `peerOf`, `lookupPeer`, `addressable`, `peerNamed`, `peerAlarm`, `ALARM_REASON`. |
| [`session-mail.ts`](./session-mail.ts) | The bus's mail as data: `BusMessage`, `MessageKind`, `MAX_MESSAGE_TEXT`, `isBusMessage`, `listArrivals`, `listMessages`, `readMailLedger`, `untoldIn`, `refusedIn`, `unaccountedOf`, `unreadableText`. |
| [`session-tool.ts`](./session-tool.ts) | The `session` tool as callers use it: `join`, `leave`, `peers`, `send`, `claimPaths`, `releasePaths`, `sendOutcome`, `notDeliveredLine`. |
| [`session-label.ts`](./session-label.ts) | The name a session is addressed by: `MAX_LABEL`, `normalizeLabel`, `shortId`, `defaultLabel`, `checkoutNames`, `agentLabel`, `normalizeTeammates`, `isTeammate`, `labelKey`, `sameLabel`, `readSessionLabel`. |
| [`requirements.ts`](./requirements.ts) | The prerequisite table and its probe: `probeExtension` and its seam types. |
| [`child.ts`](./child.ts) | One supervised child: `ChildSlot`, `ChildSink`, `createChildSupervisor`, `KILL_GRACE_MS`. |
| [`shell.ts`](./shell.ts) | Shell escape rule shared by the worktree isolation guard and plan mode's read-only git guard: `isShellEscapable` and `hasShellEscape`. |
| [`spawn.ts`](./spawn.ts) | Spawning and killing a process tree: `SpawnedProcess`, `SpawnFn`, `KillTreeFn`, `spawnOptions`, `killPlan`, `applyKillPlan`, `killChildTree`, `isPidAlive`, `startTokenOf`, `defaultSpawn`, `defaultKillTree`. |
| [`goal-state.ts`](./goal-state.ts) | The goal entry on the branch: `PublishedGoal`, `PublishedGoalStatus`, `GOAL_ENTRY_TYPE`, `MAX_GOAL_OBJECTIVE`, `isPursuedGoal`, `lastGoal`. |
| [`todo-state.ts`](./todo-state.ts) | The todo entry on the branch: `TODO_STATUSES`, `TodoStatus`, `ExistingTodo`, `MAX_TODOS`, `MAX_CONTENT`, `normalizeTodos`, `lastTodos`. |
| [`stray-fields.ts`](./stray-fields.ts) | Stray-field refusal: `ActionFields` and `strayField`. |
| [`tool-schema.ts`](./tool-schema.ts) | The tool-schema helpers: `StringEnum`, `TUnsafe`. |
| [`tool-names.ts`](./tool-names.ts) | Tool names and one parameter name that more than one extension must agree on, so an orchestrating `ctx.executeTool()` call or schema probe breaks the build on a rename. |
| [`tool-result.ts`](./tool-result.ts) | Tool results and their details: `textResult`, `details`, `structuredContent`, `failedResult`, `isError`, `toolError`, `errorResult`, `toolResultDetails`. |
| [`tool-set.ts`](./tool-set.ts) | The active tool set: `createToolSetFilter`, `getActiveTools`, `setActiveTools`, and the capture/enter/leave handlers. |
| [`usage.ts`](./usage.ts) | Usage counters: `USAGE_COUNTERS`, `UsageCounter`, `UsageCounts`, `zeroUsage`. |
| [`web/`](./web/) | The web brand system shared by the browser surfaces, documented in `web/README.md`: [`web/README.md`](./web/README.md), [`web/tokens.ts`](./web/tokens.ts), [`web/base.ts`](./web/base.ts), [`web/components.ts`](./web/components.ts), [`web/layout.ts`](./web/layout.ts), [`web/client-runtime.ts`](./web/client-runtime.ts), [`web/runtime.ts`](./web/runtime.ts), [`web/sheet.ts`](./web/sheet.ts), [`web/markup.ts`](./web/markup.ts), [`web/names.ts`](./web/names.ts), [`web/markdown-blocks.ts`](./web/markdown-blocks.ts), [`web/markdown.ts`](./web/markdown.ts), [`web/streams.ts`](./web/streams.ts), [`web/index.ts`](./web/index.ts) |

## Conventions

- **No dependencies on an extension.** Shared code imports only `node:*`, host
  packages, and other `lib/` modules; extensions import from `lib/`.
- **Inject the host seam.** Modules that need a host capability take a function
  (`RunGit`, `HttpRunner`) rather than the whole `ExtensionAPI`, so the logic is
  testable without a runtime.
- **Constants that must agree across both sides live in `tui/glyphs.ts`** — a
  glyph and the `setStatus` key are one contract, not two literals. Tool names
  shared by an orchestrating tool and the tool it calls — and parameter names
  one extension probes on another — live in `tool-names.ts`.
- **A helper that exists here must be imported, not redefined.**
  `test/shared-helpers.test.ts` fails a top-level extension declaration whose
  name is also exported by `lib/`, and a body copied from `lib/` or from any
  other file — a second extension, a sibling module, or `lib/` itself. A
  deliberate wrapper goes on that test's reasoned exception list; a copy belongs
  here with its declared capability suite.
- **An export is a promise to another module.** A value only its own file reads stays
  private, and when its last importer moves away the `export` goes with it: its row in
  the table above names what another module can reach, not what the file happens to
  declare. No test reads whether an export has an importer, so a review does.
- **A color is a role, not a token.** The rule is
  [`design-system.md`](../docs/design-system.md#color-is-a-role) and the primitives are in
  [`tui/README.md`](./tui/README.md#color-roles): draw through
  [`tui/tokens.ts`](./tui/tokens.ts) (`paint(theme, role, text)`) so a theme swap
  re-skins every surface. `TUI_TOKENS` is the one place a Pi token is named, Pi's
  tool vocabulary (`toolTitle`, `toolOutput`) included — a renderer names the
  role, and a theme that maps the token elsewhere is respected.
