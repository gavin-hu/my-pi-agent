# lib — shared extension helpers

Small modules imported by two or more extensions. Pi loads each extension with
an **isolated module cache**, so these are *value-only* libraries: pure
functions, constants, and classes. Never keep cross-extension state here — a
module-level variable would have one copy per extension, not one shared copy.
The single exception is the event-bus pattern in `rails.ts`, where the state
lives in the caller's closure, not in this module.

This directory sits outside `extensions/` on purpose: nothing here is a
loadable extension entrypoint, and every module is a contract shared *between*
extensions rather than private to one. A helper used by only one extension
belongs in that extension instead — see `extensions/web-access/http.ts` and
`extensions/plan/path-guard.ts`.

| Module | Responsibility |
|---|---|
| [`browser.ts`](./browser.ts) | Cross-platform default-browser opener shared by `file-browse` and `plan`: pure `browserCommand(url, platform)` plus best-effort `openInBrowser(url, { platform, spawn })` with an injectable spawn. |
| [`config.ts`](./config.ts) | Config loading, two ways: `loadConfigFile` for a whole file, and the shared `bytefly.json` (`SHARED_CONFIG_FILE`) via `configSection` / `loadConfigSection` (global, then project), plus the atomic `writeConfigFile` / `writeConfigSection`. Includes `clampInteger` / `clampNumber` / `cleanString` / `asRecord` / `readJson` / `readJsonResult`. |
| [`env.ts`](./env.ts) | Env-var contracts shared across extensions: the worktree environment (`ENV_ROOT`, `worktreeRoot`, `resolveEffectiveCwd`) used by worktree, file-browse, job, and rewind, plus `isExtensionEnabled` / `ENV_DISABLED_EXTENSIONS` for the package-wide disable list. |
| [`escape.ts`](./escape.ts) | `escapeHtml`: the single HTML text/attribute escape used by the browse page renderers and the Markdown and syntax highlighters. |
| [`events.ts`](./events.ts) | Inter-extension `pi.events` channels and payloads: `JOB_FINISHED_CHANNEL` and `JobFinishedEvent`, published by `job` and consumed by bytefly's notify capability. |
| [`notice.ts`](./notice.ts) | The shared transcript notice: `NOTICE_TYPE`, the `NoticeDetails` / `NoticeItem` shape, `noticeMessage` (the `display: true` message both send paths accept), `isNotice`, and `pruneStaleNotices` — posted by `job` and `watch`, rendered by bytefly. |
| [`format.ts`](./format.ts) | Pure text/number formatting shared by renderers: `formatTokens`, `formatCount`, `formatDuration` (`450ms`, `3.2s`, `1m05s`, `2h03m`), `stripControlChars`, `sanitize`, `sanitizeLine` — the boundary for untrusted, single-line text — and `shortenPath`. |
| [`interaction.ts`](./interaction.ts) | Turn-affinity prompt contract: the channel a remote adapter installs on `ctx.ui` under a string key, the `InteractionChannel` interface (`request` / `post` / `postFile`), and `remoteChannel` / `isRemoteTurn` / `supportsCustomUI` / `askHuman` (with an optional file/text preface) plus the shared “Other” label. |
| [`git/`](./git/) | Shared git plumbing. [`git/runner.ts`](./git/runner.ts) is the `RunGit` seam (`createExecRunner` with timeout/env handling, `runGitOrThrow`, `GitError`); [`git/read.ts`](./git/read.ts) holds the read helpers (`repoRoot`, `repoRootFor`, `gitDir`, `revParse`, `hasCommits`, `currentBranch`); [`git/index.ts`](./git/index.ts) is the barrel. |
| [`highlight.ts`](./highlight.ts) | First-party, escape-first syntax tokenizer (`detectLanguage`, `fenceLanguage`, `highlightLines`, `HighlightLanguage`, `TokenClass`) for js/ts, json, css, html, shell, python, java, yaml, and sql; shared by `file-browse` and plan's code blocks. |
| [`tui/`](./tui/) | The Bytefly terminal design system shared by every interactive surface: [`tui/tokens.ts`](./tui/tokens.ts) (semantic role -> theme color, `paint`), [`tui/glyphs.ts`](./tui/glyphs.ts) (`GLYPHS`, `SEPARATORS`, `STATUS_KEYS`, `EXPAND_KEYBINDING` with `expandKey` / `expandHint`, `GLYPH_GAP` — the vocabulary both sides of a status must agree on), [`tui/chrome.ts`](./tui/chrome.ts) (`screenHint`, `dockListFrame` (the docked-list frame), `viewportRows`, `FULL_SCREEN_OVERLAY`, `reuseText`, `editorTheme`), [`tui/rules.ts`](./tui/rules.ts) (the rule glyph `RULE_GLYPH`, and `plainRule` / `titleRule` / `centeredRule`), [`tui/indent.ts`](./tui/indent.ts) (the transcript block indent: `BODY_INDENT`, an optional rail prefix that a wrapped call line is kept out of, and `bodyLines` / `indentBlockLines` / `indentedLines`), [`tui/rows.ts`](./tui/rows.ts) (`listRow`, `checkbox`, `chip`, `keyValueRow`, `emptyState`), [`tui/columns.ts`](./tui/columns.ts) (`splitRow`, `fitCells`, `flowCells`, `padTo`, `clip`, `clipMiddle`), [`tui/gauge.ts`](./tui/gauge.ts) (`computeGauge`, `gaugeRole`, `gaugeBar`), [`tui/line-pane.ts`](./tui/line-pane.ts) (`LinePane`, the scrollable log/match pane), [`tui/status-controller.ts`](./tui/status-controller.ts) (`createStatusController`, the footer chips `job` and `watch` share), [`tui/tool.ts`](./tui/tool.ts) (`toolCallTitle`, the width-safe `ToolCallText` / `reuseCallText`, sanitized `errorLine` / `rejectionLine`, `moreHint`, `syncElapsedTimer`, `elapsedSuffix` — the tool-transcript kit), [`tui/render-cache.ts`](./tui/render-cache.ts) (`RenderCache`: the per-instance line memo a component that derives its lines from another component's output renders through, so a repeat frame is one comparison), and [`tui/cursor.ts`](./tui/cursor.ts) (scroll and navigation: `fitRows`, `keepVisible`, `clampScroll`, `navIntent`, `navigateList`, `navigateScroll`, `wheelDelta`, `scrollList`, `isCloseKey`, `selectionMarker`, `formatRange`, and the `ListCursor` (by index) and `IdCursor` (by stable id) state). |
| [`path.ts`](./path.ts) | `isInside` (string containment) plus `realPathOfNearest` / `isInsideReal` (symlink-aware): the containment predicates the file-browse, worktree, and doc guards share. |
| [`pi-invocation.ts`](./pi-invocation.ts) | `getPiInvocation`: how to launch a nested `pi` process, shared by `subagent` and bytefly's doctor surface. |
| [`policy.ts`](./policy.ts) | `createReadOnlyPolicy`: default-deny tool classification from `readOnlyHint` + explicit allow/deny. |
| [`rails.ts`](./rails.ts) | Above-editor widget ordering (`goal` → `todo`) and dock-screen suppression, carried on `pi.events`. |
| [`requirements.ts`](./requirements.ts) | Per-extension runtime prerequisite table plus a pure `probeExtension(seams)` over injected seams (exec, config reads, optional imports): bytefly's doctor surface reports on it and the extensions that own a dependency format their errors from it. |
| [`shell.ts`](./shell.ts) | Shell escape rule shared by the worktree isolation guard and plan mode's read-only git guard: `SHELL_ESCAPABLE`, `isShellEscapable`, `hasShellEscape`. |
| [`tool-names.ts`](./tool-names.ts) | Tool names and one parameter name that more than one extension must agree on, so an orchestrating `ctx.executeTool()` call or schema probe breaks the build on a rename. |
| [`web/`](./web/) | The Bytefly web brand system shared by the browser surfaces: [`web/tokens.ts`](./web/tokens.ts) (palette derived from the Bytefly terminal themes, scales, and the `tok-*` map), [`web/base.ts`](./web/base.ts), [`web/components.ts`](./web/components.ts), [`web/layout.ts`](./web/layout.ts), [`web/runtime.ts`](./web/runtime.ts) (`WEB_THEME_STORAGE_KEY`, `THEME_JS`, `THEME_TOGGLE_JS`), [`web/markup.ts`](./web/markup.ts), and the [`web/index.ts`](./web/index.ts) barrel. |

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
- **A color is a role, not a token.** Draw through [`tui/tokens.ts`](./tui/tokens.ts)
  (`paint(theme, role, text)`) so a theme swap re-skins every surface; the
  primitives in `tui/` already do, and a new one should too. The one exception is
  Pi's tool-rendering vocabulary (`toolOutput`, `toolTitle`), which stays direct:
  those tokens style a tool block, and no role maps to them.
