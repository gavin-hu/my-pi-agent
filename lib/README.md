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
| [`env.ts`](./env.ts) | The worktree module's process-environment contract: `ENV_ROOT`, `worktreeRoot`, `resolveEffectiveCwd`. |
| [`format.ts`](./format.ts) | Pure text/number formatting shared by renderers: `formatTokens`, `sanitize`. |
| [`git.ts`](./git.ts) | The `RunGit` seam (`createExecRunner`, `runGitOrThrow`) plus read helpers (`repoRoot`, `gitDir`, `revParse`, `hasCommits`, `currentBranch`). |
| [`list-cursor.ts`](./list-cursor.ts) | Scrollable-list behavior for the `/plans`, `/rewind`, `/todos`, and `/jobs` screens: `fitRows`, `keepVisible`, `clampScroll`, `navIntent`, `wheelDelta`, `selectionMarker`, `formatRange`, and the `ListCursor` state. |
| [`path.ts`](./path.ts) | `isInside`: the containment predicate the file-browser and worktree guards both use on a resolved target. |
| [`policy.ts`](./policy.ts) | `createReadOnlyPolicy`: default-deny tool classification from `readOnlyHint` + explicit allow/deny. |
| [`rails.ts`](./rails.ts) | Above-editor widget ordering (`goal` → `todo`) and dock-screen suppression, carried on `pi.events`. |
| [`tool-names.ts`](./tool-names.ts) | Tool names more than one extension must agree on, so an orchestrating `ctx.executeTool()` call breaks the build on a rename. |
| [`tui.ts`](./tui.ts) | Screen chrome: `screenHeader`, `screenHint`, `viewportRows`, and `FULL_SCREEN_OVERLAY`. |
| [`ui.ts`](./ui.ts) | Shared UI vocabulary: `GLYPHS`, `SEPARATORS`, and `STATUS_KEYS` (`ctx.ui.setStatus` keys). |

## Conventions

- **No dependencies on an extension.** Shared code imports only `node:*`, host
  packages, and other `lib/` modules; extensions import from `lib/`.
- **Inject the host seam.** Modules that need a host capability take a function
  (`RunGit`, `HttpRunner`) rather than the whole `ExtensionAPI`, so the logic is
  testable without a runtime.
- **Constants that must agree across both sides live in `ui.ts`** — a glyph and
  the `setStatus` key are one contract, not two literals. Tool names shared by
  an orchestrating tool and the tool it calls live in `tool-names.ts`.
