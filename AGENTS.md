# AGENTS.md

Guidance for AI coding agents working in this repository. `@gavin-hu/my-pi-agent`
is a Pi package of extensions, themes, and shared helpers. Pi discovers
resources from the `pi` manifest in `package.json` and loads each extension as
plain TypeScript, so there is no build step to run one.

Keep this file short and universally applicable. Detail belongs in the docs it
links to, not here.

## Commands

```bash
bun run check   # format:check + typecheck + transpile + test + smoke
bun run format  # biome format --write .
bun run test    # bun test --parallel --timeout 30000
```

- Run `bun run check` after code changes and fix every failure.
- Run any test you add or change and iterate until it passes.
- Do not commit unless the user asks.

## Git workflow (protected `main`)

`main` is protected against direct commits: never commit while it is checked
out. Do all work on a branch in its own worktree, then merge that branch into
`main`. A local merge into `main` is allowed; a pull request is optional.

- Under Pi with this package loaded, use `enter_worktree <name>` and
  `exit_worktree`. Otherwise use
  `git worktree add .pi/worktrees/<name> -b worktree-<name>`. One worktree per
  task; keep the `main` checkout clean.
- Before committing: run `bun run check`, check `git status`, and stage explicit
  paths. Never `git add -A` / `git add .`.
- Never `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, or
  `git commit --no-verify`.
- Never force-push `main`. Parallel sessions and subagents inherit the worktree
  through `PI_WORKTREE_ROOT`, so they cannot edit the `main` checkout.
- Commit format: `type(scope): summary`, scope is the extension name, with a
  short why-body for non-trivial changes.

## Invariants

Easy to get wrong, and not caught by types or tests. The linked docs explain
why.

- `lib/` is shared by extensions that load with isolated module caches, so it
  must stay value-only: no module-level state.
- No extension imports another extension's modules. Shared tool and parameter
  names live in `lib/tool-names.ts`; shared glyphs and status keys in
  `lib/ui.ts`.
- An extension factory only registers. Start long-lived resources from
  `session_start` and release them in an idempotent `session_shutdown`.
- State that must survive `/resume` and `/tree` lives in tool-result `details`
  (or a custom entry) and is rebuilt from `ctx.sessionManager.getBranch()`;
  widgets are derived, never authoritative.
- Sanitize model text at the boundary before it reaches a widget or the
  terminal.
- A rejected tool call returns an error carrying the previous state; never
  half-apply.
- Host packages (`@earendil-works/pi-*`, `typebox`) stay in `peerDependencies`
  with a `"*"` range, never `dependencies`.
- Adding or renaming a tool also means updating `test/naming.test.ts` and the
  root `README.md` table.

## Extension docs

Each extension has one doc, `extensions/<name>/README.md`; there is no separate
`DESIGN.md`. Follow this section order, omitting empty optional sections:

1. `# <name> — <tagline>`, then a 1–3 sentence intro.
2. Quickstart: `pi --extension ./extensions/<name>`, `pi -e .`, `pi install ./`.
3. `## What it does` — capability bullets.
4. Surface — `## Tool` / `## Tools` / `## Commands` / `## Commands and flags` /
   `## Routes`.
5. `## Behaviour by mode` (optional) — `tui`, RPC, JSON, print.
6. `## Configuration` (optional).
7. `## Security` (optional) — only with a real trust boundary.
8. Extension-specific deep dives (optional).
9. `## Limitations` (optional).
10. `## Non-goals` (optional).
11. `## Pi integration` — the contract, derived from source: integration
    points, tool `exposure`/`executionMode`/`annotations`/`outputSchema`, state
    storage, and lifecycle hooks (`session_start`/`session_shutdown`).
12. `## Design notes` — a short why, not a design doc.
13. `## Files` — module responsibility table.
14. `## Testing` (optional).

Use Pi's vocabulary from `docs/extensions.md`, account for every mode, and keep
user-facing content above the contributor sections.

## Read more

- [`test/README.md`](./test/README.md) — test principles, co-located layout,
  and helper conventions.
- [`lib/README.md`](./lib/README.md) — shared helpers, host seams, module rules.
- [`extensions/<name>/README.md`](./extensions/) — each extension's full tool
  and command surface, Pi integration contract, design notes, and file map.
- [`extensions/worktree/README.md`](./extensions/worktree/README.md) — the
  worktree flow used above, plus prune and include behavior.
- [Pi docs](https://github.com/earendil-works/pi/tree/main/docs) — the package,
  extension, and configuration contracts.

## How to work

- Be short and direct; no emojis in commits, code, or docs.
- Answer the user's question before making edits.
- State agreement or disagreement explicitly.
- Ask before removing functionality that looks intentional; do not add backward
  compatibility unless asked.
- If an explicit user instruction conflicts with this file, ask before
  overriding.
