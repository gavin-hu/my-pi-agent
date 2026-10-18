# AGENTS.md

Guidance for AI coding agents working in this repository. `@gavin-hu/my-pi-agent`
is a Pi package of extensions, themes, and shared helpers. Pi discovers
resources from the `pi` manifest in `package.json` and loads each extension as
plain TypeScript, so there is no build step to run one.

Keep this file short and universally applicable. Detail belongs in the docs it
links to, not here.

## Commands

```bash
bun install     # once per worktree: it has no node_modules of its own
bun run check   # format:check + typecheck + test
bun run format  # biome format --write .
bun run test    # bun test --parallel=4 --timeout 30000
```

- Run `bun run check` after code changes and fix every failure. A fresh worktree
  has no `node_modules`, so install once first; otherwise typecheck stops on
  `scripts/theme.ts` and says nothing about your change.
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
- Run any test you add or change and iterate until it passes.
- An ad-hoc render or screenshot script drives a picker against injected fixtures
  (`test/helpers/fixtures/picker.ts`) inside `useAgentDir()` (`test/helpers/env.ts`),
  never against a real `discoverExtensions` result: the rows persist to the live
  agent `settings.json`, so a stray Space or Enter edits the user's own
  configuration.

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
  spans two (`fix(plan,rewind): …`). Add a short why-body for non-trivial
  changes.

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
  exactly one scoped bullet, and no bullet may describe a state that was
  reverted earlier in the same window.

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
  terminal; `lib/tui/README.md` names the helper for each case.
- A path is data, not a string. Compare it as a resolved path, build it with the
  platform joiner (`resolve`, `join`, or `path.posix` for repo-relative docs),
  and canonicalize it before it becomes a state key. Never assert a literal
  `a/b` against a value the code built with `join`: macOS stays green and only
  Windows fails.
- A rejected tool call returns an error carrying the previous state; never
  half-apply.
- Host packages (`@earendil-works/pi-*`, `typebox`) stay in `peerDependencies`
  with a `"*"` range, never `dependencies`.
- Adding or renaming a tool also means updating `test/naming.test.ts` and the
  catalog in `docs/extensions.md` (and the group it belongs to in `README.md`).
  Adding or renaming a command or flag means updating the catalog too, and
  registering it with a string literal: `test/docs-truth.test.ts` compares the
  two lists in both directions.
- Adding an extension is more than the code: the `pi` manifest, the catalog,
  `README.md` and its `README.zh-CN.md` mirror (compared row by row), and
  `lib/tool-names.ts` if it shares a name. `CONTRIBUTING.md` lists the steps.
- Always-on model-facing text (`description`, parameter docs, `promptSnippet`,
  `promptGuidelines`, injected context) is budgeted. Keep each channel to its
  one job; `test/prompt-budget.test.ts` holds the injected-context ceilings.

## Code quality

Extension code is read far more often than it is written. Leave every module
tidy: one job per file, logic a second extension would need in `lib/` rather
than copied, names that say what the thing does, no dead branches or
commented-out code, and no comment that restates the line it sits on.
Readability beats cleverness — an obvious loop beats a dense one-liner.

Performance is part of the same bar. Do work once per render rather than per
frame, take the cheap path before allocating, and keep nothing that grows with
the transcript or the session unbounded. A change that makes a long session feel
slow is a bug even when every test passes; `bun run bench:render` is how a
renderer change is measured, and its determinism gate runs in the suite.

## TUI design conventions

Follow Pi's built-in TUI design system; do not invent a private visual
language. Pi's [Terminal UI](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/tui.md)
and [Themes](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/themes.md)
docs are normative, and [`lib/tui/README.md`](./lib/tui/README.md) is this
package's contract for them: host components before custom code, the block
grammar, the shared primitives, color roles, width math, sanitizing at the
boundary, keyboard bindings, and the render rules.

Three traps are worth repeating here because each one fails silently:

- Reserve the name `focused` for a real focus `get` / `set` pair. Pi's
  `setFocus` duck-types with `"focused" in component` and then assigns a boolean
  there, so any other member of that name is shadowed and the first call throws.
- A widget is derived from state, never authoritative: read live state on each
  render and call `requestRender()` only after a change.
- A component that derives its lines from another component's output memoizes
  them with `RenderCache` and drops the memo in `invalidate()`. Re-deriving every
  line per frame is what makes a long transcript feel slow.

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
  grouped catalog, configuration, and links onward. `README.zh-CN.md` mirrors it
  section for section: the two entry READMEs stay in sync, and
  `test/docs-parity.test.ts` enforces the shared headings, table rows, and
  relative links. Deep docs stay English until a translation owner exists.
- `CONTRIBUTING.md` — the human contributor entry point; points at `AGENTS.md`
  for the invariants rather than restating them.
- `docs/` — repo-level guides: `getting-started`, `extensions` (the full
  catalog), `configuration`, `architecture`, `development`, `security`, and
  `references/` for exhaustive listings a hand edit is checked against.
- `ROADMAP.md` — the horizon list, hand-maintained: `test/roadmap.test.ts` pins
  its ids, links, citations, and bucket caps, and shipping an item means
  renumbering or removing it in the same commit.
- `AGENTS.md` (this file) — the machine-facing contract and the repo
  invariants.
- `extensions/<name>/README.md`, `lib/README.md`, `lib/tui/README.md`,
  `test/README.md` — the deep per-area contracts.

When behavior changes, update the catalog (`docs/extensions.md`), the relevant
`docs/` guide, and `CHANGELOG.md` under `## [Unreleased]`.

Renaming a heading or moving a file also means fixing the links to it:
`test/structure.test.ts` resolves every relative link and `#anchor` in the root
docs, `docs/`, `lib/`, `test/`, `.github/`, and `extensions/`.

## Read more

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — setup, the branch flow, checks, and
  commit format for human contributors.
- [`docs/README.md`](./docs/README.md) — the index of user and contributor
  guides.
- [`test/README.md`](./test/README.md) — test principles, co-located layout,
  and helper conventions.
- [`lib/README.md`](./lib/README.md) — shared helpers, host seams, module rules.
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
- Ask before removing functionality that looks intentional; do not add backward
  compatibility unless asked.
- If an explicit user instruction conflicts with this file, ask before
  overriding.
