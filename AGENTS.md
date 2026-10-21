# AGENTS.md

`@gavin-hu/my-pi-agent` is a Pi package of extensions, themes, skills, and shared
helpers. Pi reads the `pi` manifest in `package.json` and loads each extension as
plain TypeScript, so there is no build step to run one.

This is the machine-facing contract. The reasoning lives in the docs it links; do
not restate them here. `test/drift.test.ts` holds it to a word budget, so a new
paragraph replaces one or moves into a guide.

## Commands

```bash
bun install                       # once per worktree: it has no node_modules
bun run check                     # format:check + typecheck + test
bun run format                    # biome format --write .
bun test <path>                   # one test file or directory
PI_SLOW_TESTS=1 bun run test      # include the gated rewind and worktree suites
bun run check:serial              # macOS fallback when a parallel run hangs
bun run bench:render              # render benchmark, budgeted in docs/development.md
```

- `bun run check` is the one command a change must pass. Run the test you touched
  while iterating; run the whole check before you call the task done.
- `rewind` and `worktree` create real repositories and skip unless `CI` or
  `PI_SLOW_TESTS=1` is set. Touching either means running them explicitly.
- A new package-level test also goes into `ROOT_TEST_FILES` in
  `test/structure.test.ts`: that set is compared exactly.
- A peer change is proved against the newest published Pi by the `compat` CI job;
  `docs/development.md` reproduces it locally. Never commit the peer bump.

## Git workflow

`main` is protected by convention, not by a server rule: do work on a branch in
its own worktree, then merge that branch into `main`.

- Start every task in a worktree. Under Pi with this package loaded, use
  `enter_worktree <name>`; otherwise
  `git worktree add .pi/worktrees/<name> -b worktree-<name>`. It branches from
  `origin/main`, so rebase onto `main` right after entering.
- Never commit unless the user asks. When the work is done, ask how to reconcile
  the branch (commit, merge, keep, discard) before `exit_worktree`.
- Stage explicit paths; never `git add -A` or `git add .`. Never
  `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`,
  `git commit --no-verify`, or force-push `main`.
- Rebase and re-run `bun run check` before merging: another session may have
  landed on `main`, and `git push origin main` publishes everything on it.
- Commit format `type(scope): summary`, where scope is the extension name or
  `lib`, `docs`, `test`, `ci`. No emojis.

## Release

Distribution is git and npm. A release is an annotated `vX.Y.Z` tag on `main`
plus a GitHub release whose body is that version's changelog section.

- The steps are normative in
  [`docs/development.md#release`](./docs/development.md#release); follow them in
  order.
- Publish only through `publish.yml`, never `npm publish` locally. Get the user's
  approval for that specific dispatch — approval for an earlier release is
  expired — and wait for the environment review.
- Push the tag with `main`: `git push origin vX.Y.Z main`. A `main`-first push
  races CI's `fetch-depth: 0` checkout and fails `test/release.test.ts`.
- The `[Unreleased]` bullet lands in the same commit as the change it describes.
  Read it against `git log <last-tag>..main` before a release.

## Invariants

Not caught by types, and easy to get wrong.

- `lib/` is loaded with isolated module caches, so it stays value-only: no
  module-level state, which `test/structure.test.ts` asserts.
- No extension imports another extension's modules. Shared tool and parameter
  names live in `lib/tool-names.ts`; shared glyphs and status keys in
  `lib/tui/glyphs.ts`.
- An extension factory only registers. Start long-lived resources in
  `session_start` and release them in an idempotent `session_shutdown`.
- State that must survive `/resume` and `/tree` lives in tool-result `details` or
  a custom entry and is rebuilt from the session branch. Widgets are derived,
  never authoritative.
- A rejected tool call returns an error carrying the previous state; never
  half-apply.
- A path is data: compare resolved paths, build them with the platform joiner,
  and canonicalize before using one as a state key. A literal `a/b` assertion
  passes on macOS and fails on Windows.
- A trust boundary two extensions answer — a loopback server, a served page — has
  one policy module in `lib/`, never a copy each: two copies are how a header, a
  `Host` rule, or an allowlist drifts apart. `lib/http/` is that module here.
- Host packages (`@earendil-works/pi-*`, `typebox`) stay in `peerDependencies`
  with a `"*"` range.
- Adding an extension also touches the `pi` manifest, the `package.json`
  description, `REQUIREMENTS` in `lib/requirements.ts`, the catalog table in
  `README.md` and its `README.zh-CN.md` mirror, and `test/naming.test.ts` when it
  adds a tool name.
- Adding a packaged skill is a `skills/<name>/SKILL.md` whose frontmatter carries
  `name` and `description`, plus its row in both entry READMEs' skill tables;
  `test/extension-load.test.ts` holds the manifest and the frontmatter.

## Tool and prompt surface

- Every tool declares `annotations.readOnlyHint` and `openWorldHint`; a mutating
  tool also declares `destructiveHint`. Missing hints default to the restrictive
  values, so leaving one out is never a safe shortcut.
- `executionMode: "sequential"` on a tool that mutates session, UI, or runtime
  state, or whose calls are order-dependent.
- Every registered tool has a `promptSnippet`. Each channel — `description`,
  `promptSnippet`, `promptGuidelines`, parameter docs, injected context — keeps
  its one job and does not restate another.
- Always-on prompt text is budgeted; `test/prompt-budget.test.ts` holds the
  ceilings.
- A tool or command rename also updates `test/naming.test.ts` and the catalog
  table in both entry READMEs.

## Code quality

- Do not copy code. A helper two extensions need lives in `lib/`, not in both; a
  body identical to an existing one is a duplicate, not a variation.
  `test/shared-helpers.test.ts` fails the second copy by name or body, and
  `test/drift.test.ts` fails a `lib/` module with no row in `lib/README.md`.
- Extension code is read far more often than written. One job per module and a
  name that says it. Past 600 lines a module is named in `LONG_MODULES` in
  `test/structure.test.ts` with the single responsibility that keeps it whole and
  its own height, which may only fall: the split costs a few lines at the bar and
  a rewrite a thousand lines later.
- `unknown` at a boundary, never `any`. A cast is a claim about a value you did
  not build, so it names the guarantee it relies on.
- No dead branch, commented-out code, or comment that restates its line.
  `test/structure.test.ts` fails `TODO` markers, suppression comments, `any`, and
  commented-out statements.
- TUI surfaces follow Pi's built-in design system and the `lib/tui/` kit;
  `lib/tui/README.md` is this package's contract. Colors come from a role, text
  is sanitized at the boundary, and width is terminal columns.
- Do work once per render rather than per frame, and keep nothing that grows with
  the transcript. `bun run bench:render` measures it.

## Documentation

- `README.md` is the user front door and `README.zh-CN.md` mirrors it;
  `test/docs-parity.test.ts` compares shared headings, table rows, and links.
- `CONTRIBUTING.md` is the human entry point, `docs/` holds the guides, and
  `AGENTS.md` is this file.
- An extension's only doc is `extensions/<name>/README.md`, in the section order
  of [`docs/development.md#one-doc-per-extension`](./docs/development.md#one-doc-per-extension);
  there is no `DESIGN.md`.
- A behaviour change updates the catalog table in both entry READMEs, the
  relevant `docs/` guide, and `CHANGELOG.md` under `## [Unreleased]`.
- Renaming a heading or moving a file means fixing every relative link and
  `#anchor`; `test/structure.test.ts` resolves them.
- One doc per audience. Deep per-area contracts live in
  `extensions/<name>/README.md`, `lib/README.md`, `lib/tui/README.md`, and
  `test/README.md`; `docs/development.md#drift-rules` explains the gate lists.

## How to work

- Be short and direct. Answer the question before making edits, and state
  agreement or disagreement explicitly.
- Ask before removing functionality that looks intentional, and do not add
  backward compatibility unless asked.
- If an instruction conflicts with this file, ask before overriding it.

## Read more

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — setup, branch flow, checks, and commit
  format.
- [`docs/development.md`](./docs/development.md) — scripts, test tiers, the compat
  procedure, and the normative release steps.
- [`docs/architecture.md`](./docs/architecture.md) — the package model, the turn,
  state, and where new code belongs.
- [`test/README.md`](./test/README.md) — test tiers, helpers, and determinism
  rules.
- [`lib/README.md`](./lib/README.md) and [`lib/tui/README.md`](./lib/tui/README.md)
  — shared helpers and the terminal design system.
- [`extensions/worktree/README.md`](./extensions/worktree/README.md) — the
  worktree flow used above.
