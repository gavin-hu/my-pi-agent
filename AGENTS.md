# AGENTS.md

Guidance for AI coding agents working in this repository. `@gavin-hu/my-pi-agent`
is a Pi package of extensions, themes, and shared helpers. Pi discovers
resources from the `pi` manifest in `package.json` and loads each extension as
plain TypeScript, so there is no build step to run one.

This file is the entry point, not the manual: each rule is stated once, the test
that holds it is named, and the detail lives in the doc it links to.
`test/drift.test.ts` keeps it inside a word budget, so a new paragraph either
replaces one or belongs in a doc.

## Four rules that keep this repo out of refactors

Every large sweep in this repo's history is one of these rules broken at the
second copy. Rules 1 to 3 are red tests; rule 4 is review, because no test can
tell a cross-cutting change from a feature. The habits alone did not hold.

1. **Reuse before you write.** A helper a second extension needs belongs in
   `lib/`; a copy inside an extension is a bug. `lib/README.md` is the index —
   read it before writing one. `test/drift.test.ts` fails when one function body
   appears in two owners; the accepted list and an `allow:dup` comment are the
   only exceptions, and the list may only shrink.
2. **No module grows.** A new module stays at most 600 lines. A module already
   past that is named in `LONG_MODULES` in `test/structure.test.ts` at its own
   height, which may only fall: a split costs twenty lines at 620 and a week at
   1,088.
3. **One owner per concept.** A concept two extensions share has exactly one
   implementation, in `lib/`. A new `lib/` module ships with a co-located test (a
   subdirectory may be covered through its barrel, as `lib/git/index.test.ts`
   covers `git/read.ts`) and a row in `lib/README.md`, in the same commit — the
   row is compared against the tree, so a module nobody indexed fails instead of
   being rewritten by the next session.
4. **A cross-cutting change is its own task.** A plan names every extension it
   touches. When one concept has to change in two extensions, that is an
   extraction first, proposed and approved as its own task — never folded into a
   feature, which is how a nine-commit migration happens.

## Commands

```bash
bun install     # once per worktree: it has no node_modules of its own
bun run check   # format:check + typecheck + test
bun run format  # biome format --write .
bun run test    # bun test --parallel=4 --timeout 30000
```

- Run `bun run check` after code changes and fix every failure. A fresh worktree
  has no `node_modules`, so install once first; otherwise typecheck stops on
  `scripts/theme.ts` and says nothing about your change. Run any test you add or
  change and iterate until it passes.
- That check skips the gated `rewind` and `worktree` suites unless `CI` or
  `PI_SLOW_TESTS=1` is set. Run `PI_SLOW_TESTS=1 bun run test` when touching
  either; CI runs them. On macOS, fall back to `bun run check:serial` when a
  git-using test hangs.
- A new package-level test file also goes into `ROOT_TEST_FILES` in
  `test/structure.test.ts`: that set is compared exactly, and listing the file
  there is the whole registration.
- A peer change is proved against the newest Pi, not just the locked one: the
  `compat` CI job installs the newest published peers and runs typecheck plus the
  serial suite. Reproduce it locally as `docs/development.md` describes; do not
  commit the peer bump.
- An ad-hoc render or screenshot script drives a picker against injected fixtures
  (`test/helpers/fixtures/picker.ts`) inside `useAgentDir()` (`test/helpers/env.ts`),
  never against a real `discoverExtensions` result: the rows persist to the live
  agent `settings.json`, so a stray Space or Enter edits the user's own config.

## Git workflow (`main` treated as protected)

Treat `main` as protected against direct commits: never commit while it is
checked out. This is a repository convention, not a GitHub branch rule, so
nothing rejects a stray commit or push — the discipline is on the agent. Do all
work on a branch in its own worktree, then merge that branch into `main`. A
local merge into `main` is allowed; a pull request is optional.

- **Start every task in a worktree.** Under Pi with this package loaded, use
  `enter_worktree <name>`; otherwise
  `git worktree add .pi/worktrees/<name> -b worktree-<name>`. It branches from
  `origin/main`, which lags the local `main` here, so rebase onto `main` right
  after entering. One worktree per task; keep the `main` checkout clean.
- **Clear the worktree when the branch lands.** `prune_worktrees` (or
  `/worktree prune`) removes clean, unlocked worktrees past `pruneAfterDays`; a
  merged branch still needs its own delete. Leftovers accumulate silently —
  `extensions/worktree/README.md` has the rules. This is housekeeping after the
  exit below, never a way to skip it.
- **Ask before ending the task.** When the work is done, ask the user how to
  reconcile the branch (commit, merge, keep, or discard) and only call
  `exit_worktree` (or `git worktree remove`) after they decide. Never exit on
  your own initiative, so uncommitted work is not discarded without a choice. The
  exit result ends with a `Handoff:` block naming the branch, its commits, and the
  exact merge or pull-request command — use that command rather than retyping a
  branch name.
- **Never commit unless the user asks.** Work left on a worktree is easy to
  inspect and easy to drop; a commit is neither, so leave it to the user.
- Before committing: check `git status` and stage explicit paths. Never
  `git add -A` / `git add .`.
- Another session may merge into `main` while you work. Rebase before merging,
  re-run `bun run check` on the merged tree, and remember that
  `git push origin main` publishes whatever else is on `main`, not just your
  branch.
- Never `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, or
  `git commit --no-verify`.
- Never force-push `main`. Subagents and any `pi` started from a tool inherit
  the worktree through `PI_WORKTREE_ROOT`, so they cannot edit the `main`
  checkout.
- Commit format: `type(scope): summary`, where `scope` is the extension name,
  the shared area (`lib`, `docs`, `test`, `ci`), or a comma list when one change
  spans two (`fix(plan,rewind): …`), and `lib` for a change with no
  per-extension surface. Add a short why-body for non-trivial changes.
## Release

Distribution is git and npm: `main` is installable as a git Pi package, and every
release is published to npm. A release is an annotated `vX.Y.Z` tag on `main`, a
matching GitHub release whose body is that version's `CHANGELOG.md` section with
the heading included, and a dispatch of the `publish.yml` workflow for that tag.

The steps are normative in
[`docs/development.md`](./docs/development.md#release) — read them there before
starting, and prepare the release on a branch in a worktree like any other
change. This section holds only what an agent must not get wrong:

- Publishing is irreversible and public, and it happens only through
  `publish.yml` — never `npm publish` locally, which `publishConfig.provenance`
  refuses anyway. Get the user's approval for that specific dispatch, treat
  approval for an earlier release as expired, and wait for the `npm` environment
  review to complete. Stop and ask rather than skipping ahead to keep the steps
  in sequence.
- Push the tag with `main`, never after it: `git push origin vX.Y.Z main`. A
  `main`-first push races CI's `fetch-depth: 0` checkout, and the first release
  job to start before the tag arrives fails `test/release.test.ts` with "newest
  git tag is the package version". Re-running that job clears it.
- The `[Unreleased]` bullet lands in the same commit as the change it describes,
  which makes the release commit mechanical. Read `[Unreleased]` against
  `git log <last-tag>..main` before making it: every user-visible change needs
  exactly one scoped bullet (`lib` is the scope for a change with no
  per-extension surface), and no bullet may describe a state that was
  reverted earlier in the same window.
- The hero image prints the package version, so the bump and
  `bun run screenshots chrome` are one step; the capture needs macOS, so CI
  cannot catch a stale one. See [`docs/development.md`](./docs/development.md#screenshots).

## Invariants

Easy to get wrong and cheap to break silently. The gate column is the test that
notices; `review` means nothing downstream will.

| Invariant | Held by |
|---|---|
| `lib/` is value-only, no module-level state: each extension loads its own module cache | `test/structure.test.ts` "lib value-only" |
| No extension imports another's modules; shared tool and parameter names live in `lib/tool-names.ts`, shared glyphs and status keys in `lib/tui/glyphs.ts` | `test/structure.test.ts` "extension boundaries" |
| An extension factory only registers; long-lived resources start in `session_start` and stop in an idempotent `session_shutdown` | review |
| State that must survive `/resume` and `/tree` lives in tool-result `details` (or a custom entry) and is rebuilt from `ctx.sessionManager.getBranch()`; widgets are derived, never authoritative | review |
| Sanitize model text at the boundary, before it reaches a widget or the terminal; `lib/tui/README.md` names the helper for each case | review |
| A path is data, not a string: compare it resolved, build it with `resolve`/`join` (`path.posix` for repo-relative docs), canonicalize it before it becomes a state key. A literal `a/b` assertion stays green on macOS and fails only on Windows | review; `test/structure.test.ts` doc links |
| A trust boundary two extensions answer — a loopback server, a served page — has one policy module in `lib/`, never a copy each: two copies are how a header, a `Host` rule, or an allowlist drifts apart. `lib/http/` is that module for the two local servers | review |
| A rejected tool call returns an error carrying the previous state; never half-apply | review |
| Host packages (`@earendil-works/pi-*`, `typebox`) stay in `peerDependencies` with a `"*"` range, never `dependencies` | review |
| A new or renamed tool updates `test/naming.test.ts` and the catalog table in `README.md`; a new command or flag also updates that table, registered with a string literal | `test/naming.test.ts` |
| A new extension also touches the `pi` manifest, the catalog in `README.md` and `README.zh-CN.md`, and `lib/tool-names.ts` if it shares a name | `test/docs-parity.test.ts` |
| Always-on model-facing text (`description`, parameter docs, `promptSnippet`, `promptGuidelines`, injected context) is budgeted, one job per channel | `test/prompt-budget.test.ts` |

## Code quality

Extension code is read far more often than written; these are rules, not
preferences.

- One job per module, and a name that says it. Past 600 lines a module either
  splits or is named in `LONG_MODULES` in `test/structure.test.ts` with the one
  responsibility holding it together, and with the module's own height, so a new
  oversized module fails instead of joining a silent pile.
- The second copy of a helper goes in `lib/`, not the third — rule 1 above, and
  `lib/README.md` lists what is already there.
- No dead branch, no commented-out code, no comment that restates its line. A
  comment carries the why the code cannot: a host quirk, a trap, a limit.
- `unknown` at a boundary, never `any`. A cast is a claim about a value you did
  not build, so it names the guarantee it relies on.
- An obvious loop beats a dense one-liner, and a name beats a comment.

`test/structure.test.ts` fails a `TODO` marker, a suppression comment, an `any`,
and a commented-out statement in `extensions/*/` and `lib/` **source** — not in
`scripts/` and not in `*.test.ts` — plus a module over the line bar that
`LONG_MODULES` does not name. A genuine match stays with `allow:<name>` on the
line or in the comment block above it. The rest of this section is review.

Performance is the same bar: work once per render, not per frame; take the cheap
path before allocating; keep nothing that grows with the transcript. Measure with
`bun run bench:render` against the budget in [`docs/development.md`](./docs/development.md#performance), and
keep its determinism gate green.

## TUI design conventions

Follow Pi's built-in TUI design system; do not invent a private visual language.
Pi's [Terminal UI](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/tui.md)
and [Themes](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/themes.md)
docs are normative, and [`lib/tui/README.md`](./lib/tui/README.md) is the
package's contract for them.

Three fail silently, so know them before opening the doc: never name a member
`focused` unless it is a real focus `get`/`set` pair (Pi's `setFocus` assigns a boolean there, so the first call
throws); a widget derives its state on each render and calls `requestRender()`
only after a change; and a component that derives lines from another component's
output memoizes them with `RenderCache` and drops the memo in `invalidate()`.

## Docs and conventions

A screen that lists rows and opens a pane subclasses
[`lib/tui/dock-screen.ts`](./lib/tui/dock-screen.ts) rather than re-assembling
the frame; `/jobs`, `/watch`, `/agents`, and `/check` all do. Extend the base
with an opt-in member whose default is the current behaviour, and prove the seam
by leaving the existing subclasses and their tests untouched — that is the test
of whether it belongs in the base at all.

The contributor contracts live in [`docs/development.md`](./docs/development.md):

- [Extension conventions](./docs/development.md#extension-conventions) — the one
  doc per extension, its section order, the `## Pi integration` contract, and
  where each repo doc belongs.
- [Drift rules](./docs/development.md#drift-rules) — the accepted-copy list, the
  named modules and their heights, and why neither list may grow.
- [Tool and prompt surface](./docs/development.md#tool-and-prompt-surface) — the
  prompt channels, the tool metadata a permission or plan-mode policy reads, and
  what a new command implements.

When behavior changes, update the catalog table in `README.md` (and its
`README.zh-CN.md` mirror), the relevant `docs/` guide, and `CHANGELOG.md` under
`## [Unreleased]`. A moved heading is a broken link, which
`test/structure.test.ts` fails on rather than reports.

## Read more

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — setup, the branch flow, checks, and
  commit format for humans; [`docs/README.md`](./docs/README.md) indexes the
  user and contributor guides.
- [`test/README.md`](./test/README.md) — test principles, co-located layout,
  and helper conventions.
- [`lib/README.md`](./lib/README.md) — the shared helper index, host seams,
  module rules.
- [`lib/tui/README.md`](./lib/tui/README.md) — the terminal design system every
  interactive surface draws with.
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
- Ask before removing functionality that looks intentional; never add backward
  compatibility unasked.
- If an explicit user instruction conflicts with this file, ask before
  overriding.
