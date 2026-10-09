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
| [`config.ts`](./config.ts) | `~/.pi/agent/<name>.json` + `<cwd>/.pi/<name>.json` loading, with `clampInteger` / `cleanString` / `readJson`. |
| [`env.ts`](./env.ts) | Env-var contracts shared across extensions: the worktree environment (`ENV_ROOT`, `worktreeRoot`, `resolveEffectiveCwd`) used by worktree, file-browser, job, and rewind, plus `isExtensionEnabled` / `ENV_DISABLED_EXTENSIONS` for the package-wide disable list. |
| [`format.ts`](./format.ts) | Pure text/number formatting shared by renderers: `formatTokens`, `stripControlChars`, `sanitize`. |
| [`git/`](./git/) | Shared git plumbing. [`git/runner.ts`](./git/runner.ts) is the `RunGit` seam (`createExecRunner` with timeout/env handling, `runGitOrThrow`, `GitError`); [`git/read.ts`](./git/read.ts) holds the read helpers (`repoRoot`, `repoRootFor`, `gitDir`, `revParse`, `hasCommits`, `currentBranch`); [`git/index.ts`](./git/index.ts) is the barrel. |
| [`list-cursor.ts`](./list-cursor.ts) | Scrollable-list behavior for the `/rewind`, `/todos`, and `/jobs` screens: `fitRows`, `keepVisible`, `clampScroll`, `navIntent`, `wheelDelta`, `selectionMarker`, `formatRange`, and the `ListCursor` state. |
| [`path.ts`](./path.ts) | `isInside` (string containment) plus `realPathOfNearest` / `isInsideReal` (symlink-aware): the containment predicates the file-browser, worktree, and doc guards share. |
| [`policy.ts`](./policy.ts) | `createReadOnlyPolicy`: default-deny tool classification from `readOnlyHint` + explicit allow/deny. |
| [`rails.ts`](./rails.ts) | Above-editor widget ordering (`goal` → `todo`) and dock-screen suppression, carried on `pi.events`. |
| [`shell.ts`](./shell.ts) | Shell escape rule shared by the worktree isolation guard and plan mode's read-only git guard: `SHELL_ESCAPABLE`, `isShellEscapable`, `hasShellEscape`. |
| [`tool-names.ts`](./tool-names.ts) | Tool names and one parameter name that more than one extension must agree on, so an orchestrating `ctx.executeTool()` call or schema probe breaks the build on a rename. |
| [`tui.ts`](./tui.ts) | Screen chrome: `screenHeader`, `screenHint`, `viewportRows`, and `FULL_SCREEN_OVERLAY`. |
| [`ui.ts`](./ui.ts) | Shared UI vocabulary: `GLYPHS`, `SEPARATORS`, `STATUS_KEYS` (`ctx.ui.setStatus` keys), `EXPAND_KEYBINDING` with `expandKey` / `expandHint`, and the transcript rail `BODY_INDENT` / `GLYPH_GAP`. |

## Conventions

- **No dependencies on an extension.** Shared code imports only `node:*`, host
  packages, and other `lib/` modules; extensions import from `lib/`.
- **Inject the host seam.** Modules that need a host capability take a function
  (`RunGit`, `HttpRunner`) rather than the whole `ExtensionAPI`, so the logic is
  testable without a runtime.
- **Constants that must agree across both sides live in `ui.ts`** — a glyph and
  the `setStatus` key are one contract, not two literals. Tool names shared by
  an orchestrating tool and the tool it calls — and parameter names one
  extension probes on another — live in `tool-names.ts`.
