# AGENTS.md

`@gavin-hu/my-pi-agent` is a Pi package of extensions, themes, skills, and shared
helpers. Pi loads each extension as plain TypeScript from the `pi` manifest in
`package.json`: no build step.

This file holds the rules and their traps. A rule naming a test is gated by it; one
naming none is review-only. `CONTRIBUTING.md` owns the workflow — branch flow, checks,
commit format, conventions, page template, tool fields, one doc per audience, release —
and `scripts/README.md` and `test/README.md` their areas; do not restate them. It owns
the procedure; this file owns the rules.

`test/drift.test.ts` holds this file's word count: a paragraph replaces one, and a trim
lowers `CEILING` in the same commit.

## How to work

- Work every change on its card: claim, plan, contract, sign, then `execute` before
  editing; with no card, open one.
  [`docs/extensions/board.md`](./docs/extensions/board.md) owns the states and signs.
- Be short and direct: answer before editing; state agreement or disagreement.
- Ask before adding a runtime dependency, or removing a function that looks intentional.
  Add no backward compatibility unless asked.
- If an instruction conflicts with this file, ask first.

## Commands

```bash
bun install              # once per worktree
bun test --changed=main  # this branch's suites; add `bun test test/` for the sweeps
bun run check            # before landing: format, types, tests
```

- A gated git suite (`rewind`, `worktree`, `session-bus`'s real-repository tests) skips
  unless `CI` or `PI_SLOW_TESTS=1`: touching one means `PI_SLOW_TESTS=1 bun test`.
- A new package-level test goes into `ROOT_TEST_FILES` in `test/layout.test.ts`,
  compared exactly.
- A peer bump is proved against the newest published Pi by CI's `compat` job; never
  commit one.

## Invariants

- An extension factory only registers. Long-lived resources start in `session_start` and
  release in an idempotent `session_shutdown`.
- `lib/` loads with isolated module caches, so it stays value-only: no module-level
  state (`test/boundaries.test.ts`). No extension imports another's modules.
- Shared tool and parameter names live in `lib/tool-names.ts`; shared glyphs and status
  keys in `lib/tui/glyphs.ts`.
- An entry pays for its static graph: a module nothing needs before the first draw loads
  with `import()` where it is used (`lib/lazy.ts`); `test/dependencies.test.ts` holds the
  budget, which may only fall.
- State that must survive `/resume` and `/tree` lives in tool-result `details` or a
  custom entry, rebuilt from the branch. Widgets are derived, never authoritative.
- A rejected tool call returns an error carrying the previous state; never half-apply.
- A path is data: resolve before comparing, join with the platform joiner, canonicalize
  before using one as a key. A literal `a/b` assertion fails on Windows.
- A trust boundary two extensions answer gets one policy module in `lib/http/`: two
  copies is how a `Host` rule drifts.
- Host packages (`@earendil-works/pi-*`, `typebox`) stay in `peerDependencies` with a
  `"*"` range.

## Rules

Three are gated; the fourth is review-only.

- **One body, one owner.** A helper two extensions need lives in `lib/`, never in both;
  `test/shared-helpers.test.ts` fails a body identical to an existing one.
- **No module grows.** One job per module, its name saying which. Past 600 lines a module
  is named in `LONG_MODULES` in `test/module-sizes.test.ts` with that responsibility, at a
  line count that may only fall.
- **One owner per concept.** Every `lib/` module has a row in `lib/README.md`, held by
  `test/drift.test.ts`.
- **A cross-cutting change is its own task.** It does not ride on another: no test can
  tell it from a feature.

## Code quality

- `unknown` at a boundary, never `any`. A cast names the guarantee it relies on, about a
  value you did not build.
- A behaviour change lands with a test that fails without it. "No behaviour change" names
  its inputs: a difference only on values this build never makes is untested.
- No dead branch, commented-out code, or comment that restates its line.
  `test/conventions.test.ts` fails `TODO` markers, suppression comments, `any`, and
  commented-out statements.

## TUI and rendering

- Build a surface from the `lib/tui/` kit ([`#conventions`](./CONTRIBUTING.md#conventions)):
  colors from a role, text sanitized at the boundary, width in terminal columns.
- Do work once per render, not per frame; keep nothing that grows with the transcript.
  `bun run bench:render` measures it.
- Verify a surface by rendering it — `bun run capture:screens`,
  `bun run render:tools html <out>`, `bun run capture:plan`, `bun run capture:file-browse`
  — and `bun test` renders all screens at three widths, so an overflowing frame fails.

## Surfaces and documentation

- Add an extension by [`#adding-an-extension`](./CONTRIBUTING.md#adding-an-extension) and a
  skill by [`#adding-a-packaged-skill`](./CONTRIBUTING.md#adding-a-packaged-skill); a missed
  row fails a gate: `REQUIREMENTS` in `lib/requirements.ts`, `test/suite-manifest.ts`, the
  catalog in both entry READMEs (`test/naming.test.ts`, `test/docs-parity.test.ts`), and a
  skill's own page at `docs/skills/<name>.md` (`test/skill-docs.test.ts`).
- An extension's doc is `docs/extensions/<name>.md` on the
  [`#writing-an-extension-page`](./CONTRIBUTING.md#writing-an-extension-page) template; no
  Markdown beside the code.
- Prompt fields: [`#tool-and-prompt-surface`](./CONTRIBUTING.md#tool-and-prompt-surface)
  owns every one; `test/prompt-budget.test.ts` the ceilings.
- A tool rename updates `test/naming.test.ts` and the catalog table in both entry READMEs;
  a command rename updates its `docs/extensions/` page.
- A behaviour change updates the catalog in both entry READMEs, the relevant `docs/`
  guide, and `CHANGELOG.md` under `## [Unreleased]`. A removal also sweeps the `docs/` and
  `lib/` READMEs naming what it took away.
- Renaming a heading or moving a file means fixing every relative link and `#anchor`;
  `test/doc-links.test.ts` resolves them.

## Git workflow

[`CONTRIBUTING.md#branch-flow`](./CONTRIBUTING.md#branch-flow) owns the flow: a worktree
per task, before plan mode; a `--no-ff` merge, no rebase, no branch head pushed to `main`.

- Never commit unless the user asks; then commit as each step finishes.
- Stage explicit paths; never `git add -A`, `git add .`, `git reset --hard`,
  `git checkout .`, `git clean -fd`, `git stash`, `git commit --no-verify`, or force-push
  `main`.
- A card closes only after its landing records the merge.

## Release

Follow [`CONTRIBUTING.md#release`](./CONTRIBUTING.md#release): it is normative, and landing
is not a release.

- Publish only through `publish.yml`, after the user approves that dispatch — an earlier
  approval expires — and wait on the environment review.
- The `[Unreleased]` bullet lands with its change.
