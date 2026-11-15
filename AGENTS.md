# AGENTS.md

`@gavin-hu/my-pi-agent` is a Pi package of extensions, themes, skills, and shared
helpers. Pi loads each extension as plain TypeScript from the `pi` manifest in
`package.json`: no build step.

Each rule here carries its gate and the trap with no other home.
[`CONTRIBUTING.md`](./CONTRIBUTING.md) owns the contributor workflow — branch flow,
checks, commit format, conventions, page template, tool fields, release — and
`scripts/README.md` and `test/README.md` their areas; do not restate them.
`test/drift.test.ts` holds the word budget: a new paragraph replaces one.

## Commands

```bash
bun install              # once per worktree
bun test --changed=main  # this branch's suites; add `bun test test/` for the sweeps
bun run check            # before landing: format, types, every test
```

[`#checks`](./CONTRIBUTING.md#checks) and [`test/README.md`](./test/README.md) cover
the rest.

- The gated git suites (`rewind`, `worktree`, `session-bus`'s real-repository
  tests) skip unless `CI` or `PI_SLOW_TESTS=1` is set: touching one means
  `PI_SLOW_TESTS=1 bun test`.
- A new package-level test goes into `ROOT_TEST_FILES` in `test/layout.test.ts`:
  that set is compared exactly.
- A peer bump is proved against the newest published Pi by CI's `compat` job
  ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)); never commit it.

## Git workflow

[`CONTRIBUTING.md#branch-flow`](./CONTRIBUTING.md#branch-flow) owns the flow: a
worktree per task, entered before plan mode; commits as steps finish, and never
unless the user asks; a `--no-ff` merge, no rebase, no branch head pushed to `main`.

- Stage explicit paths; never `git add -A`, `git add .`, `git reset --hard`,
  `git checkout .`, `git clean -fd`, `git stash`, `git commit --no-verify`, or
  force-push `main`.
- A card closes after its landing: the card records which merge carried it, the
  sign which tree was checked.

## Release

Follow [`CONTRIBUTING.md#release`](./CONTRIBUTING.md#release): it is normative, and
landing a change is not a release.

- Publish only through `publish.yml`, only after the user approves that dispatch —
  an earlier approval expires — and wait on the environment review.
- The `[Unreleased]` bullet lands in the same commit as its change.

## Invariants

- An extension factory only registers. Long-lived resources start in
  `session_start` and release in an idempotent `session_shutdown`.
- `lib/` loads with isolated module caches, so it stays value-only: no
  module-level state (`test/boundaries.test.ts`). No extension imports another's
  modules.
- Shared tool and parameter names live in `lib/tool-names.ts`; shared glyphs and
  status keys in `lib/tui/glyphs.ts`.
- A start pays what an entry imports: what nothing needs before the first draw loads
  with `import()` in the call that needs it (`lib/lazy.ts`); `test/dependencies.test.ts`
  holds the budget, which may only fall.
- State that must survive `/resume` and `/tree` lives in tool-result `details` or a
  custom entry, rebuilt from the branch; widgets are derived, never authoritative.
- A rejected tool call returns an error carrying the previous state; never
  half-apply.
- A path is data: resolve before comparing, join with the platform joiner,
  canonicalize before using one as a key — a literal `a/b` assertion fails on Windows.
- A trust boundary two extensions answer — a loopback server, a served page — gets
  one policy module in `lib/http/`: two copies is how a `Host` rule drifts.
- Host packages (`@earendil-works/pi-*`, `typebox`) stay in `peerDependencies`
  with a `"*"` range.

## Adding a surface

[`#adding-an-extension`](./CONTRIBUTING.md#adding-an-extension) and
[`#adding-a-packaged-skill`](./CONTRIBUTING.md#adding-a-packaged-skill) are the
checklists; a missed row fails a gate — `REQUIREMENTS` in `lib/requirements.ts`,
`test/suite-manifest.ts`, the catalog in both entry READMEs
(`test/naming.test.ts`, `test/docs-parity.test.ts`), and a skill's own page at
`docs/skills/<name>.md` (`test/skill-docs.test.ts`).

## Tool and prompt surface

[`CONTRIBUTING.md#tool-and-prompt-surface`](./CONTRIBUTING.md#tool-and-prompt-surface)
owns every field; `test/prompt-budget.test.ts` holds the ceilings.

- A tool rename updates `test/naming.test.ts` and the catalog table in both entry
  READMEs; a command rename updates its `docs/extensions/` page.

## Rules

Three are gates; the fourth is review.

- **One body, one owner.** A helper two extensions need lives in `lib/`, never in
  both; `test/shared-helpers.test.ts` fails a body identical to an existing one.
- **No module grows.** One job per module, its name saying which: past 600 lines it
  is named in `LONG_MODULES` in `test/module-sizes.test.ts` with that responsibility,
  at a height that may only fall.
- **One owner per concept.** Every `lib/` module has a row in `lib/README.md`,
  held by `test/drift.test.ts`.
- **A cross-cutting change is its own task.** Review only: no test can tell it from
  a feature, so a change spanning unrelated areas does not ride on another.

## Code quality

- `unknown` at a boundary, never `any`. A cast names the guarantee it relies on,
  about a value you did not build.
- No dead branch, commented-out code, or comment that restates its line.
  `test/conventions.test.ts` fails `TODO` markers, suppression comments, `any`, and
  commented-out statements.
- TUI surfaces follow Pi's design system and the `lib/tui/` kit, listed under
  [`#conventions`](./CONTRIBUTING.md#conventions): colors from a role, text sanitized
  at the boundary, width in terminal columns.
- Do work once per render rather than per frame, and keep nothing that grows with
  the transcript; `bun run bench:render` measures it.

## UI verification

A surface is verified by rendering it: `capture:screens` for a terminal frame,
`render:tools --width 80` for one block, `capture:plan` or `capture:file-browse` for
a shipped page. `bun test` renders every screen at three widths, so an
overflowing frame fails there.

## Documentation

- An extension's doc is `docs/extensions/<name>.md`, on the template in
  [`CONTRIBUTING.md#writing-an-extension-page`](./CONTRIBUTING.md#writing-an-extension-page);
  no Markdown beside the code.
- A behaviour change updates the catalog in both entry READMEs, the relevant
  `docs/` guide, and `CHANGELOG.md` under `## [Unreleased]`.
- Work planned but not started is a card on the repo's board (`board`), never a
  `TODO` comment or a second list in Markdown.
- Renaming a heading or moving a file means fixing every relative link and
  `#anchor`; `test/doc-links.test.ts` resolves them.
- One doc per audience:
  [`CONTRIBUTING.md#one-doc-per-audience`](./CONTRIBUTING.md#one-doc-per-audience).

## How to work

- Work a feature on its card: claim, contract, sign, `execute` before editing; with
  no card, open one.
- Be short and direct: answer before editing; state agreement or disagreement.
- Ask before adding a runtime dependency.
- Ask before removing functionality that looks intentional; add no backward
  compatibility unless asked.
- If an instruction conflicts with this file, ask first.
