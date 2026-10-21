# Contributing

Thanks for wanting to improve `my-pi-agent`. This page is the contributor entry
point; the repo's rules live in [`AGENTS.md`](./AGENTS.md), their detail in
[`docs/development.md`](./docs/development.md), and the guides under
[`docs/`](./docs/).

## Before you start

- Install [Bun](https://bun.sh) and make sure `git` is on `PATH`.
- Read [`docs/architecture.md`](./docs/architecture.md) for the package model,
  [`AGENTS.md`](./AGENTS.md) for the rules and their gates, and
  [`docs/development.md`](./docs/development.md#extension-conventions) for the
  conventions.
- For a large change, open an issue first so the approach can be agreed before
  code is written.

## Setup

```bash
bun install
bun run check
```

`bun run check` is the one command that must pass: format check, typecheck, and
the full test suite.

## Branch flow

`main` is treated as protected. Do all work on a branch in its own worktree, one
worktree per task:

```bash
# Under Pi with this package loaded:
enter_worktree <name>

# Otherwise:
git worktree add .pi/worktrees/<name> -b worktree-<name>
```

The branch is cut from `origin/main`, which lags the local `main` when pushes are
infrequent, so rebase onto `main` right after entering.

When the work is done, ask how to reconcile the branch (commit, merge, keep, or
discard) before removing the worktree. Never `git add -A` or `git add .`; stage
explicit paths. Never `git reset --hard`, `git checkout .`, `git clean -fd`,
`git stash`, `git commit --no-verify`, or force-push `main`.

## Checks

| Command | What it does |
|---|---|
| `bun run check` | format:check + typecheck + test |
| `bun run format` | Rewrite formatting with Biome |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Unit tests |
| `PI_SLOW_TESTS=1 bun run test` | Include the git-heavy `worktree` and `rewind` suites |

See [`docs/development.md`](./docs/development.md) and
[`test/README.md`](./test/README.md) for the test tiers and determinism rules.

## Commit format

```
type(scope): summary
```

`scope` is the extension name (`plan`, `worktree`, `bytefly`, …) or the shared
area (`lib`, `docs`, `test`). Keep the summary imperative, add a short why-body
for non-trivial changes, and use no emojis.

## Conventions

These are enforced or reviewed; the full list is in [`AGENTS.md`](./AGENTS.md)
and [`docs/development.md`](./docs/development.md#extension-conventions):

- **Extension boundary.** An extension factory only registers. Long-lived
  resources start in `session_start` and are released in an idempotent
  `session_shutdown`.
- **`lib/` is value-only.** Extensions load with isolated module caches, so a
  module-level variable would be duplicated. No extension imports another
  extension's modules.
- **Shared names.** Tool and parameter names that more than one extension agrees
  on live in [`lib/tool-names.ts`](./lib/tool-names.ts); glyphs and status keys
  in [`lib/tui/glyphs.ts`](./lib/tui/glyphs.ts).
- **Tool surface.** Declare `readOnlyHint` and `openWorldHint` on every tool;
  mutating tools also declare `destructiveHint`. Set `executionMode` to
  `"sequential"` when calls share state or order.
- **Prompt budget.** Always-on model-facing text is capped; see
  [`test/prompt-budget.test.ts`](./test/prompt-budget.test.ts).
- **TUI.** Follow Pi's built-in design system and the `lib/tui/` kit:
  [`tokens.ts`](./lib/tui/tokens.ts) roles, [`chrome.ts`](./lib/tui/chrome.ts),
  [`rules.ts`](./lib/tui/rules.ts), [`rows.ts`](./lib/tui/rows.ts),
  [`columns.ts`](./lib/tui/columns.ts), [`gauge.ts`](./lib/tui/gauge.ts),
  [`glyphs.ts`](./lib/tui/glyphs.ts), and [`cursor.ts`](./lib/tui/cursor.ts).
  Colors come from a role, never a literal. Width is terminal columns, and
  model- or file-authored text is sanitized at the boundary.

## Adding an extension

1. Add the entrypoint to the `extensions` list in
   [`package.json`](./package.json)'s `pi` manifest.
2. Add the capability suites to [`test/suite-manifest.ts`](./test/suite-manifest.ts)
   and write them (see [`test/README.md`](./test/README.md)).
3. Write `extensions/<name>/README.md` in the section order documented in
   [`docs/development.md`](./docs/development.md#one-doc-per-extension).
4. Add the extension to the catalog table in both entry READMEs — `README.zh-CN.md`
   mirrors `README.md` row by row and `test/docs-parity.test.ts` compares them —
   then update [`test/naming.test.ts`](./test/naming.test.ts) and the
   [`lib/tool-names.ts`](./lib/tool-names.ts) contract if it shares a tool name.

## Release

The release process is documented once, in
[`docs/development.md`](./docs/development.md#release). Do not duplicate it here.
