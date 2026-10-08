# `_shared` — shared extension helpers

Small modules imported by two or more extensions. Pi loads each extension with
an **isolated module cache**, so these are *value-only* libraries: pure
functions, constants, and classes. Never keep cross-extension state here — a
module-level variable would have one copy per extension, not one shared copy.
The single exception is the event-bus pattern in `rails.ts`, where the state
lives in the caller's closure, not in this module.

| Module | Responsibility |
|---|---|
| [`config.ts`](./config.ts) | `~/.pi/agent/<name>.json` + `<cwd>/.pi/<name>.json` loading, with `clampInteger` / `cleanString` / `readJson`. |
| [`format.ts`](./format.ts) | Pure text/number formatting shared by renderers: `formatTokens`, `sanitize`. |
| [`git.ts`](./git.ts) | The `RunGit` seam (`createExecRunner`, `runGitOrThrow`) plus read helpers (`repoRoot`, `gitDir`, `revParse`, `hasCommits`, `currentBranch`). |
| [`http.ts`](./http.ts) | Native-`fetch` transport (`HttpRunner`, `createFetchRunner`, typed errors) used by fetch-only extensions; injectable for tests. |
| [`path-guard.ts`](./path-guard.ts) | `hasPathInput`: detect path-like tool arguments so a caller can refuse to trust a tool's `readOnlyHint`. |
| [`policy.ts`](./policy.ts) | `createReadOnlyPolicy`: default-deny tool classification from `readOnlyHint` + explicit allow/deny. |
| [`rails.ts`](./rails.ts) | Above-editor widget ordering (`goal` → `todo` → `jobs`) and dock-screen suppression, carried on `pi.events`. |
| [`tool-names.ts`](./tool-names.ts) | Tool names more than one extension must agree on, so an orchestrating `ctx.executeTool()` call breaks the build on a rename. |
| [`tui.ts`](./tui.ts) | Screen chrome: `screenHeader`, `screenHint`, `viewportRows`, and `FULL_SCREEN_OVERLAY`. |
| [`ui.ts`](./ui.ts) | Shared UI vocabulary: `GLYPHS`, `SEPARATORS`, and `STATUS_KEYS` (`ctx.ui.setStatus` keys). |
| [`worktree-env.ts`](./worktree-env.ts) | The worktree extension's process-environment contract: `ENV_ROOT`, `worktreeRoot`, `resolveEffectiveCwd`. |

## Conventions

- **No dependencies on an extension.** Shared code imports only `node:*`, host
  packages, and other `_shared` modules; extensions import from `_shared`.
- **Inject the host seam.** Modules that need a host capability take a function
  (`RunGit`, `HttpRunner`) rather than the whole `ExtensionAPI`, so the logic is
  testable without a runtime.
- **Constants that must agree across both sides live in `ui.ts`** — a glyph and
  the `setStatus` key are one contract, not two literals. Tool names shared by
  an orchestrating tool and the tool it calls live in `tool-names.ts`.
