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
bun run test    # bun test --parallel=4 --timeout 30000
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

## Release

Distribution is git-only: nothing is published to npm. A release is an annotated
`vX.Y.Z` tag on `main` plus a matching GitHub release whose body is that
version's `CHANGELOG.md` section, heading included. Prepare it on a branch like
any other change:

1. Bump `version` in `package.json`.
2. In `CHANGELOG.md`, move the `## [Unreleased]` entries under
   `## [X.Y.Z] - YYYY-MM-DD`, leave `## [Unreleased]` in place and empty, and
   update the link refs at the bottom: `[X.Y.Z]` points at the new release URL
   and `[Unreleased]` compares from `vX.Y.Z`.
3. Run `bun run check`.
4. Commit as `chore(release): X.Y.Z` and merge the branch into `main`.
5. Tag the merge commit and push `main` with it:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main && git push origin vX.Y.Z
   ```

6. Publish the release from that changelog section (`README.md` has the command
   that extracts it):

   ```bash
   gh release create vX.Y.Z --title X.Y.Z --notes-file section.md
   ```

GitHub marks the release created last as "Latest", so when an older version is
published after a newer one, run `gh release edit vX.Y.Z --latest` on the newest
tag.

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

## TUI design conventions

Follow Pi's built-in TUI design system; do not invent a private visual
language. Pi's [Terminal UI](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/tui.md)
and [Themes](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/themes.md)
docs are normative. In this package the shared implementation is `lib/tui.ts`
(screen chrome), `lib/ui.ts` (glyphs and status keys), and
`lib/list-cursor.ts` (list behaviour) — use it rather than re-deriving chrome,
glyphs, or scroll math.

- Prefer the host before custom code: `ctx.ui.select` / `confirm` / `input` /
  `editor`, then `notify` / `setStatus` / `setWidget`, then the pi-tui
  components. Reach for `ctx.ui.custom()` or a tool/entry renderer only when a
  surface needs its own layout or input, and never build a second terminal
  renderer.
- Match the built-in block grammar: one leading blank line per transcript
  block, nothing trailing (the host owns spacing); frame screens with a plain
  `─` rule, not box corners.
- Speak the built-in visual language: semantic `Theme` tokens only (never
  literal ANSI or hex), `screenHint` / Pi's `keyHint` for the hint row, and the
  shared `selectionMarker`, `GLYPHS`, `SEPARATORS`, and `STATUS_KEYS` instead
  of retyped literals.
- Width is terminal columns, not string length. Use `visibleWidth`,
  `truncateToWidth`, and `wrapTextWithAnsi`; every returned line must fit the
  width, and width arithmetic starts from `Math.max(1, width)`.
- Compact by default, expand for detail: label-first one-line widgets, with
  more revealed on demand or on a dedicated screen.
- Sanitize at the boundary: run model- or file-authored text through
  `stripControlChars` / `sanitize` before it reaches a widget or the terminal.
- Keyboard first, and consistent. Use `matchesKey` / `Key`, give every mouse
  interaction a keyboard path, and keep the shared bindings: Esc closes,
  `j` / `k` and arrows scroll, `g` / `G` and Home/End jump.
- Components are derived and cheap. Implement `Component` with `invalidate()`,
  update an instance in place, read live state on each render, and call
  `requestRender()` only after state changes; never hold themed strings in
  state unless `invalidate()` rebuilds them. A widget is derived from state,
  never authoritative.
- Size from the live viewport: `screenHeader`, `viewportRows`, `fitRows`, and
  `ListCursor`, fed by a `ViewportRowsSource` (number or getter) with a sensible
  fallback, so a resize is picked up. List screens stay docked; only the plan
  review uses `FULL_SCREEN_OVERLAY`.
- A TUI module gets a sibling `tui.test.ts`; see [`test/README.md`](./test/README.md).

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
- [Pi docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs)
  — the package, extension, and configuration contracts.

## How to work

- Be short and direct; no emojis in commits, code, or docs.
- Answer the user's question before making edits.
- State agreement or disagreement explicitly.
- Ask before removing functionality that looks intentional; do not add backward
  compatibility unless asked.
- If an explicit user instruction conflicts with this file, ask before
  overriding.
