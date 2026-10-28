# AGENTS.md

`@gavin-hu/my-pi-agent` is a Pi package of extensions, themes, skills, and shared
helpers. Pi reads the `pi` manifest in `package.json` and loads each extension as
plain TypeScript, so there is no build step to run one.

The reasoning lives in the linked docs; do not restate it. `test/drift.test.ts`
holds the word budget: a new paragraph replaces one.

## Commands

```bash
bun install                       # once per worktree (no node_modules)
bun run check                     # format:check + typecheck + test
bun run format                    # biome format --write .
bun test <path>                   # one test file or directory
PI_SLOW_TESTS=1 bun run test      # include the gated git suites
bun run check:serial              # what macOS CI runs: --parallel can hang
bun run bench:render              # render benchmark; see docs/development.md
```

- `bun run check` is what a change must pass: run the test you touched while
  iterating, and the whole check when done.
- `rewind`, `worktree`, and `session-bus`'s real-repository tests skip unless
  `CI` or `PI_SLOW_TESTS=1` is set. Touching one means running it explicitly.
- A new package-level test goes into `ROOT_TEST_FILES` in
  `test/structure.test.ts`: that set is compared exactly.
- A peer change is proved against the newest published Pi by the `compat` CI job;
  `docs/development.md` reproduces it locally. Never commit the peer bump.

## Git workflow

`main` is protected by convention.

- Start every task in a worktree, before plan mode, which refuses
  `enter_worktree`. Under Pi, `enter_worktree <name>`; otherwise
  `git worktree add .pi/worktrees/<name> -b worktree-<name>`. It cuts from
  `origin/main`, so rebase onto `main` right after.
- Never commit unless the user asks; before `exit_worktree`, ask how to reconcile
  the branch (commit, merge, keep, discard).
- Commit, then rebase onto `main` before merging, re-running `bun run check`: a
  rebase needs a clean tree, and `main` moves while you work. `git push origin
  main` publishes everything on it.
- Stage explicit paths; never `git add -A` or `git add .`. Never `git reset
  --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git commit
  --no-verify`, or force-push `main`.
- Commit format `type(scope): summary`, where scope is the extension name or
  `lib`, `docs`, `test`, `ci`. No emojis.

## Release

Distribution is git and npm. A release is an annotated `vX.Y.Z` tag on `main`
plus a GitHub release whose body is that version's changelog section.

- The steps are normative in
  [`docs/development.md#release`](./docs/development.md#release); follow them in
  order.
- Publish only through `publish.yml`, never `npm publish` locally. Get the user's
  approval for each dispatch — an earlier one expires — and wait for the
  environment review.
- Push the tag with `main`: `git push origin vX.Y.Z main`. A `main`-first push
  races CI's `fetch-depth: 0` checkout and fails `test/release.test.ts`.
- The `[Unreleased]` bullet lands in the same commit as its change; read it
  against `git log <last-tag>..main` before a release.

## Invariants

Not caught by types, and easy to get wrong.

- `lib/` loads with isolated module caches, so it stays value-only: no
  module-level state (`test/structure.test.ts`).
- No extension imports another extension's modules. Shared tool and parameter
  names live in `lib/tool-names.ts`; shared glyphs and status keys in
  `lib/tui/glyphs.ts`.
- An extension factory only registers. Start long-lived resources in
  `session_start` and release them in an idempotent `session_shutdown`.
- State that must survive `/resume` and `/tree` lives in tool-result `details` or
  a custom entry, rebuilt from the session branch; widgets are derived, never
  authoritative.
- A rejected tool call returns an error carrying the previous state; never
  half-apply.
- A path is data: compare resolved paths, build them with the platform joiner,
  and canonicalize before using one as a state key. A literal `a/b` assertion
  passes on macOS and fails on Windows.
- A trust boundary two extensions answer — a loopback server, a served page —
  has one policy module in `lib/` (`lib/http/`), never a copy each: two copies
  are how a `Host` rule or an allowlist drifts apart.
- Host packages (`@earendil-works/pi-*`, `typebox`) stay in `peerDependencies`
  with a `"*"` range.
- Adding an extension touches the `pi` manifest, `package.json`, `REQUIREMENTS`
  in `lib/requirements.ts`, its suites in `test/suite-manifest.ts`, its page in
  `docs/extensions/`, the catalog in both READMEs, and
  `test/naming.test.ts` for a tool name.
- Adding a packaged skill is a `skills/<name>/SKILL.md` whose frontmatter carries
  `name` and `description`, plus its row in both entry READMEs' skill tables;
  `test/extension-load.test.ts` holds both.

## Tool and prompt surface

Every tool declares `annotations.readOnlyHint` and `openWorldHint`, plus
`destructiveHint` when it mutates; a missing hint defaults to the restrictive
value. `executionMode: "sequential"` when a tool mutates session, UI, or runtime
state. Every registered tool has a `promptSnippet`, and no channel restates
another's job. `test/prompt-budget.test.ts` holds the ceilings; see
[`docs/development.md#tool-and-prompt-surface`](./docs/development.md#tool-and-prompt-surface).

A tool rename updates `test/naming.test.ts` and the catalog table in both entry
READMEs; a command rename updates its `docs/extensions/` page.

## Rules

Three of the four are gates; the fourth is review.

- **One body, one owner.** A helper two extensions need lives in `lib/`, never in
  both; `test/shared-helpers.test.ts` fails a body identical to an existing one.
- **No module grows.** One job per module, and a name that says it: past 600
  lines a module is named in `LONG_MODULES` in `test/structure.test.ts` with the
  responsibility that keeps it whole, at its own height, which may only fall.
- **One owner per concept.** Every `lib/` module has a row in `lib/README.md`;
  `test/drift.test.ts` fails the module that has none.
- **A cross-cutting change is its own task.** Review only: no test can tell it
  from a feature, so a change spanning unrelated areas does not ride on another.

## Code quality

- `unknown` at a boundary, never `any`. A cast claims something about a value you
  did not build, so it names the guarantee it relies on.
- No dead branch, commented-out code, or comment that restates its line.
  `test/structure.test.ts` fails `TODO` markers, suppression comments, `any`, and
  commented-out statements.
- TUI surfaces follow Pi's built-in design system and the `lib/tui/` kit
  (`lib/tui/README.md` is the contract): colors from a role, text sanitized at the
  boundary, width in terminal columns.
- Do work once per render rather than per frame, and keep nothing that grows with
  the transcript. `bun run bench:render` measures it.

## UI verification

A surface is verified by rendering it. A terminal frame:
`bun run screenshots render <screen>`, or
`bun run tools:render render <tool> --width 80` for one block; a
browser page: `bun run screenshot:plan <plan.md>` or `screenshot:file-browse`,
each driving the shipped page. `bun run check` renders every screen at three
widths, so an overflowing frame fails there. Re-capture an `assets/` file only
when its surface or a printed version is behind.

## Documentation

- `README.md` is the user front door and `README.zh-CN.md` mirrors it;
  `test/docs-parity.test.ts` compares headings, table rows, and links.
- An extension's doc is `docs/extensions/<name>.md` (capabilities first, per
  [`docs/development.md#one-doc-per-extension`](./docs/development.md#one-doc-per-extension));
  no Markdown beside the code.
- A behaviour change updates the catalog in both entry READMEs, the
  relevant `docs/` guide, and `CHANGELOG.md` under `## [Unreleased]`.
- Work planned but not started is a card on the repo's board (`board`), never a
  `TODO` comment or a second list in Markdown.
- Renaming a heading or moving a file means fixing every relative link and
  `#anchor`; `test/structure.test.ts` resolves them.
- One doc per audience: per-area contracts live in
  `docs/extensions/<name>.md`, `lib/README.md`, `lib/tui/README.md`,
  `scripts/README.md`, and `test/README.md`.

## How to work

- Be short and direct: answer before editing, state agreement or disagreement.
- Ask before adding a runtime dependency to `package.json`.
- Ask before removing functionality that looks intentional; add no backward
  compatibility unless asked.
- If an instruction conflicts with this file, ask before overriding it.

## Read more

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branch flow, checks, commits.
- [`docs/development.md`](./docs/development.md) — scripts, test tiers, compat,
  release steps.
- [`docs/architecture.md`](./docs/architecture.md) — the target architecture, state,
  and where code belongs.
- [`test/README.md`](./test/README.md) — test tiers, helpers, determinism.
- [`docs/extensions/worktree.md`](./docs/extensions/worktree.md) — the
  worktree flow above.
