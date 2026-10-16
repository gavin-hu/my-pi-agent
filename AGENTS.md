# AGENTS.md

Guidance for AI coding agents working in this repository. `@gavin-hu/my-pi-agent`
is a Pi package of extensions, themes, and shared helpers. Pi discovers
resources from the `pi` manifest in `package.json` and loads each extension as
plain TypeScript, so there is no build step to run one.

Keep this file short and universally applicable. Detail belongs in the docs it
links to, not here.

## Commands

```bash
bun run check   # format:check + typecheck + test
bun run format  # biome format --write .
bun run test    # bun test --parallel=4 --timeout 30000
```

- Run `bun run check` after code changes and fix every failure.
- Run any test you add or change and iterate until it passes.
- Do not commit unless the user asks.

## Git workflow (`main` treated as protected)

Treat `main` as protected against direct commits: never commit while it is
checked out. This is a repository convention, not a GitHub branch rule, so
nothing rejects a stray commit or push — the discipline is on the agent. Do all
work on a branch in its own worktree, then merge that branch into `main`. A
local merge into `main` is allowed; a pull request is optional.

- **Start every task in a worktree.** Under Pi with this package loaded, use
  `enter_worktree <name>`; otherwise
  `git worktree add .pi/worktrees/<name> -b worktree-<name>`. One worktree per
  task; keep the `main` checkout clean.
- **Ask before ending the task.** When the work is done, ask the user how to
  reconcile the branch (commit, merge, keep, or discard) and only call
  `exit_worktree` (or `git worktree remove`) after they decide. Never exit on
  your own initiative, so uncommitted work is not discarded without a choice.
- Before committing: run `bun run check`, check `git status`, and stage explicit
  paths. Never `git add -A` / `git add .`.
- Never `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, or
  `git commit --no-verify`.
- Never force-push `main`. Parallel sessions and subagents inherit the worktree
  through `PI_WORKTREE_ROOT`, so they cannot edit the `main` checkout.
- Commit format: `type(scope): summary`, scope is the extension name, with a
  short why-body for non-trivial changes.

## Release

Distribution is git and npm: `main` is installable as a git Pi package, and every
release is published to npm. A release is an annotated `vX.Y.Z` tag on `main`
plus a matching GitHub release whose body is that version's `CHANGELOG.md`
section, heading included, and an `npm publish` of the package. This section is
the source of truth; the user-facing copy is `docs/development.md`, so keep the
two in sync.
Prepare it on a branch like any other change:

1. Bump `version` in `package.json`.
2. In `CHANGELOG.md`, move the `## [Unreleased]` entries under
   `## [X.Y.Z] - YYYY-MM-DD`, leave `## [Unreleased]` in place and empty, and
   update the link refs at the bottom: `[X.Y.Z]` points at the new release URL
   and `[Unreleased]` compares from `vX.Y.Z`.
3. Run `bun run check`.
4. Commit as `chore(release): X.Y.Z` and merge the branch into `main`.
5. Tag `main`'s HEAD (the merge commit, or the branch tip when the merge
   fast-forwards) and push `main` with it:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main && git push origin vX.Y.Z
   ```

6. Publish the release from that changelog section:

   ```bash
   bun run release:notes X.Y.Z > section.md
   gh release create vX.Y.Z --title X.Y.Z --notes-file section.md
   rm section.md
   ```

7. Publish the npm package from the same commit (`publishConfig.access` is
   `public`; the `pi-package` keyword and `pi` manifest make it a Pi package).
   Name the registry explicitly: a machine whose default registry is a read-only
   mirror serves reads but rejects the publish with `E401`.

   ```bash
   npm publish --registry https://registry.npmjs.org/
   ```

GitHub marks the release with the newest creation date as "Latest", so after
creating a release for an older version, run `gh release edit vX.Y.Z --latest`
on the newest tag. Publishing a draft does not change which release is latest.

## Invariants

Easy to get wrong, and not caught by types or tests. The linked docs explain
why.

- `lib/` is shared by extensions that load with isolated module caches, so it
  must stay value-only: no module-level state.
- No extension imports another extension's modules. Shared tool and parameter
  names live in `lib/tool-names.ts`; shared glyphs and status keys in
  `lib/tui/glyphs.ts`.
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
  catalog in `docs/extensions.md` (and the group it belongs to in `README.md`).
- Always-on model-facing text (`description`, parameter docs, `promptSnippet`,
  `promptGuidelines`, injected context) is budgeted. Keep each channel to its
  one job; `test/prompt-budget.test.ts` holds the injected-context ceilings.

## TUI design conventions

Follow Pi's built-in TUI design system; do not invent a private visual
language. Pi's [Terminal UI](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/tui.md)
and [Themes](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/themes.md)
docs are normative. In this package the shared implementation is the `lib/tui/`
design system — [`tokens.ts`](./lib/tui/tokens.ts) (semantic roles),
[`chrome.ts`](./lib/tui/chrome.ts) (screen frame and hints),
[`rules.ts`](./lib/tui/rules.ts) (the rule grammar and glyph),
[`indent.ts`](./lib/tui/indent.ts) (the transcript block indent),
[`rows.ts`](./lib/tui/rows.ts) (list rows, checkboxes, chips, empty states),
[`columns.ts`](./lib/tui/columns.ts) (width math),
[`gauge.ts`](./lib/tui/gauge.ts) (the gauge),
[`line-pane.ts`](./lib/tui/line-pane.ts) (a scrollable log/match pane),
[`status-controller.ts`](./lib/tui/status-controller.ts) (footer chips),
[`glyphs.ts`](./lib/tui/glyphs.ts) (glyphs and status keys), and
[`cursor.ts`](./lib/tui/cursor.ts) (`ListCursor` by index, `IdCursor` by id) —
use it rather than re-deriving chrome, glyphs, or scroll math.

- Prefer the host before custom code: `ctx.ui.select` / `confirm` / `input` /
  `editor`, then `notify` / `setStatus` / `setWidget`, then the pi-tui
  components. Reach for `ctx.ui.custom()` or a tool/entry renderer only when a
  surface needs its own layout or input, and never build a second terminal
  renderer.
- Match the built-in block grammar: one leading blank line per transcript
  block, nothing trailing (the host owns spacing); frame screens with a plain
  `─` rule, not box corners.
- Reach for a `lib/tui/` primitive before composing your own: `titleRule` /
  `titleRule` for a heading, `listRow` / `checkbox` for a list, `gaugeBar` for
  a meter, `emptyState` for an empty screen, and `splitRow` / `fitCells` for two
  columns.
- Speak the built-in visual language: resolve colors through a `lib/tui/tokens.ts`
  role (`paint(theme, role, text)`), never a literal ANSI, hex, or a Pi token
  named inline; use `screenHint` / Pi's `keyHint` for the hint row, and the
  shared `selectionMarker`, `GLYPHS`, `SEPARATORS`, and `STATUS_KEYS` instead
  of retyped literals.
- Width is terminal columns, not string length. Use `visibleWidth`,
  `truncateToWidth`, and `wrapTextWithAnsi`; every returned line must fit the
  width, and width arithmetic starts from `Math.max(1, width)`.
- Compact by default, expand for detail: label-first one-line widgets, with
  more revealed on demand or on a dedicated screen.
- Sanitize at the boundary: run model- or file-authored text through
  `sanitizeLine` before it reaches a widget or the terminal — it neutralizes
  control characters and then collapses to one line. `stripControlChars` alone
  is for multi-line text that must keep its newlines.
- Keyboard first, and consistent. Use `matchesKey` / `Key`, give every mouse
  interaction a keyboard path, and keep the shared bindings: Esc closes,
  `j` / `k` and arrows scroll, `g` / `G` and Home/End jump.
- Components are derived and cheap. Implement `Component` with `invalidate()`,
  update an instance in place, read live state on each render, and call
  `requestRender()` only after state changes; never hold themed strings in
  state unless `invalidate()` rebuilds them. A widget is derived from state,
  never authoritative.
- Size from the live viewport: `titleRule`, `viewportRows`, `fitRows`, and
  `ListCursor`, fed by a `ViewportRowsSource` (number or getter) with a sensible
  fallback, so a resize is picked up. List screens stay docked; only the plan
  review uses `FULL_SCREEN_OVERLAY`.
- A TUI module gets a sibling `tui.test.ts`; see [`test/README.md`](./test/README.md).

## Prompt conventions

Everything an extension puts in front of the model — `description`,
`promptSnippet`, `promptGuidelines`, parameter docs, injected context — is
always-on context. Give each channel one job, and never restate the same
instruction in two of them.

- `description` says what the tool is and what it guarantees: contract, limits,
  side effects, prerequisites. Not "use it when…".
- `promptSnippet` is required on every registered tool: the one line in the
  system prompt's Available tools list, not a copy of the description.
- `promptGuidelines` say when, when not, and in what order: one idea per bullet,
  imperative, never restating the description.
- Parameter descriptions give meaning, default, and bounds only.
- Injected context states the current facts and the single next action, stays
  short, and is matched by `customType`, never by marker text.
- Tool errors name the problem and the corrective action; a rejected call
  returns the unchanged state.

## Tool surface conventions

The non-prompt fields of a tool definition are a contract a permission
extension and the plan-mode policy read, so keep them uniform across
extensions.

- `annotations`: declare `readOnlyHint` and `openWorldHint` on every tool. A
  mutating tool (`readOnlyHint: false`) also declares `destructiveHint`;
  `idempotentHint` is omitted on a read-only tool because it only describes
  repeating a mutation. Missing hints default to the restrictive MCP values, so
  leaving one out is never a safe shortcut.
- `executionMode`: set `"sequential"` on a tool that mutates session, UI, or
  in-memory runtime state, or whose calls are order-dependent. Omit it (the host
  default, parallel) when calls are independent, such as reads or processes each
  call spawns itself.
- `exposure` / `defaultActive`: set them only when they differ from the default
  (`direct`, active on registration) — `model-only`, `codemode`, and a tool
  activated later from `session_start` say so explicitly.
- `outputSchema`: declare it exactly when the result carries a
  `structuredContent` mirror; the two are one contract.
- A command that takes subcommands or flags implements
  `getArgumentCompletions` for them.

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

Use Pi's vocabulary from Pi's own `docs/extensions.md`, account for every mode,
and keep user-facing content above the contributor sections.

## Documentation layout

One doc per audience. Do not duplicate across them:

- `README.md` — the end-user front door: what the package is, install, the
  grouped catalog, configuration, and links onward.
- `CONTRIBUTING.md` — the human contributor entry point; points at `AGENTS.md`
  for the invariants rather than restating them.
- `docs/` — repo-level guides: `getting-started`, `extensions` (the full
  catalog), `configuration`, `architecture`, `development`, `security`.
- `AGENTS.md` (this file) — the machine-facing contract and the repo
  invariants.
- `extensions/<name>/README.md`, `lib/README.md`, `test/README.md` — the deep
  per-area contracts.

When behavior changes, update the catalog (`docs/extensions.md`), the relevant
`docs/` guide, and `CHANGELOG.md` under `## [Unreleased]`.

## Read more

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — setup, the branch flow, checks, and
  commit format for human contributors.
- [`docs/README.md`](./docs/README.md) — the index of user and contributor
  guides.
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
