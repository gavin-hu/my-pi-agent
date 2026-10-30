# Tests

Testing conventions for this package. Keep this file and the layout in sync;
`test/layout.test.ts` and `test/conventions.test.ts` enforce the layout and the
banned-pattern rules below.

## Running

```bash
bun test                 # whole suite (isolated per-file globals, 30s timeout)
bun test <path>          # one file or directory
bun run check            # format + typecheck + test
```

The always-on model-facing prompt size is budgeted. `test/prompt-budget.test.ts`
covers the pure per-turn injected-context builders, which are re-injected every
turn, so a regression in that text fails fast.

`bun test` runs the suite through `bun run test` with `--parallel=4` (which
implies `--isolate`), so each test file runs in its own worker process and
`process.env` edits in one file cannot leak into another. The worker count is
capped at four so the git-heavy worktree and rewind suites are not starved.

The git-heavy `rewind`, `worktree`, and `session-bus` real-repository tests create
real repositories and real git commands, so `test/helpers/slow-suite.ts` gates
them: they skip unless `CI` is set (GitHub Actions sets it) or `PI_SLOW_TESTS=1`
is exported. A local `bun run check` therefore stays fast while CI keeps the
coverage. Run them locally with `PI_SLOW_TESTS=1 bun run test` or
`PI_SLOW_TESTS=1 bun test <path>`; a new slow suite opts in with
`describe.skipIf(!runSlowSuites)("...", () => { ... })`.
CI runs the macOS job through `bun run check:serial` instead: a `--parallel`
worker on macOS can drop the subprocess exit notification for its first spawn
(`oven-sh/bun#41024`, `#39709`) and hang the first git-using test of a file until
its timeout, which showed up as a rotating red macOS job. Use `bun run
test:serial` to reproduce that shape locally.
`test/helpers/preload.ts` additionally snapshots and restores the tracked env
vars (`PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `PI_WORKTREE_ROOT`,
`PI_WORKTREE_BRANCH`, `PI_WORKTREE_MAIN`) around every test, and clears them for
the test itself: a suite run inside a worktree session inherits its root, which
would re-root every test that resolves an effective cwd.

POSIX-shell and symlink tests self-skip on hosts that cannot support them; the
gate is stated in the test.

## Test tiers

1. **Capability suites** (`extensions/<name>/<capability>.test.ts`) — grouped by
   behaviour, not by module. A suite may cover several source modules, and a
   module may be covered by more than one suite. Exercise the public contract,
   use one setup per capability, and table-drive cases that share a shape. The
   declared suite list is `test/suite-manifest.ts`.
2. **Library suites** (`lib/<area>.test.ts`, `lib/tui/<area>.test.ts`) — the
   same grouping over a `lib/` subsystem, keeping pure-unit and platform-seam
   contracts.
3. **Package-level tests** (`test/naming.test.ts`, `test/release.test.ts`,
   `test/layout.test.ts`, `test/conventions.test.ts`, `test/theme.test.ts`,
   `test/prompt-budget.test.ts`,
   `test/tool-render.test.ts`,
   `test/docs-parity.test.ts`, `test/extension-load.test.ts`,
   `test/drift.test.ts`, `test/shared-helpers.test.ts`,
   `test/doc-counts.test.ts`,
   `test/config-docs.test.ts`, `test/settings-coverage.test.ts`,
   `test/dependencies.test.ts`, `test/skill-bank.test.ts`,
   `test/scripts-surface.test.ts`) — cross-cutting
   contracts. No capability suite may duplicate these. `shared-helpers.test.ts`
   fails an extension that reimplements what `lib/` owns, by name or by body, a
   test that re-declares or copies a `test/helpers` export, and one test file
   that carries a body another test file already carries, and pins its exception
   maps; `drift.test.ts` keeps every `lib/` module in the `lib/README.md`
   index and `AGENTS.md` inside its word budget; the module line bar and its
   `LONG_MODULES` heights live in `module-sizes.test.ts`, and the suite bar in
   `suite-sizes.test.ts`.
   `tool-render.test.ts` renders every registered tool's call
   and result through bytefly's frame at 80/48/40 and asserts the shared shape,
   and that a second render of the same component at the same width returns the
   same line array — the deterministic half of the render-cache contract, since
   a renderer that rebuilds its lines every frame is correct but slow. The
   states it covers are the ones a row really renders: streaming arguments, a
   settled call, and a collapsed, expanded, or partial result.
   `dependencies.test.ts` walks each extension entrypoint's static import graph
   through the TypeScript AST and fails when one of `package.json`'s
   `dependencies` loads at registration; a dynamic `import()` ends the walk,
   because deferring the load is the fix, and an exception names its reason in
   the file. The same walker holds the local-module budget: five handler-only
   surfaces are named in `DEFERRED_FROM_REGISTRATION`, and the total static
   evaluations across every entry may not exceed `MODULE_BUDGET`.
   `release.test.ts` ties `package.json`, the newest dated changelog heading,
   and the newest `vX.Y.Z` tag together. CI checks out with `fetch-depth: 0` so
   the tag is present; the tag assertion is skipped in a clone that has none.
   The tool names in both entry READMEs are pinned by
   `naming.test.ts`, and the configuration reference is pinned by
   `config-docs.test.ts`.

Rule of thumb: if a test needs `mock.module`, a global stub, or a real timer,
the code under test is missing a seam. Add the seam instead of the mock.

## Principles

1. **Test the contract, not the internals.** Exercise each capability through
   the public surface of the modules it covers. Reach into a private helper only
   when that module is itself a pure unit with its own public export.
2. **One behaviour per test; Arrange–Act–Assert.** Name `test("...")` as a
   sentence about behaviour, not a method name. No multi-phase mega-tests.
3. **Deterministic by construction.** No real clock, network, process, or
   filesystem outside the OS temp root. Inject seams (spawn/kill/liveness/now)
   instead of stubbing globals. Real git inside a tracked temp dir is allowed.
   `--isolate` covers module state, but helpers must still avoid cross-test
   shared mutable state — the same value-only rule `lib/` follows.
4. **Prefer fakes to mocks.** One shared `ExtensionAPI` double
   (`helpers/fakes.ts`); fake child processes over spies; never assert on call
   counts when the observable effect is available.
5. **DRY belongs in the helper layer only.** Share doubles, fixtures, and setup.
   Do not abstract assertions behind custom matchers; a test should read
   top-to-bottom without chasing indirection.
6. **Assert the contract, not incidental formatting.** Check width/fields/
   ordering, not space padding; no self-referential (tautological) assertions.
7. **Table-driven where cases share a shape** (config contracts, naming, glyph
   sets) to keep the case list obvious and small.
8. **Skips are explicit and reasoned.** A guarded skip states why, and the gate
   is documented. Never `.only`; never silently delete coverage.
9. **A suite lives beside the extension or `lib/` subsystem it covers.** Its
   imports name the module under test (`./module.ts`), not a copy, so coverage
   and edits stay local.

## Fixtures

An extension that needs an extension-specific `FakePi` / `fakeCtx` pair or
suite harness owns one fixture module under `test/helpers/fixtures/<name>.ts`.
An extension that needs only the shared `FakePi`/`fakeCtx` pair may build it
inline from `test/helpers/` instead of adding a fixture. A fixture must:

- build the `FakePi` / `fakeCtx` pair with that extension's defaults;
- expose a **suite harness** returning `{ repo/dir, pi, ctx, ...actions }` and
  owning teardown, so tests never use `try/finally` to clean up;
- export only the recorders and actions its tests read;
- stay value-only (no module-level mutable state).

Shared doubles live in `test/helpers/` and are value-only. Extension fixtures
wrap them; tests must not re-declare a theme double, a `makeFakePi` wrapper, or
`PI_CODING_AGENT_DIR` save/restore.

## Determinism and seams

- Inject `now`, `spawn`, `kill`, `liveness`, and `startToken` (the job pattern);
  extend the same idea to timestamps and identifiers.
- No `setTimeout` / `setInterval` in tests; use `settle()` to drain pending
  work.
- A deadline is a seam, not a short real timer. A test that gives a reload 40 ms
  to reconnect fails when the runner is busy, which says nothing about the code;
  inject the one-shot timer (`lib/timer.ts`), fire it from the test, and assert
  what the code did with it. `settle()` stays for draining work whose completion
  point is already known.
- A wait on the *host* is the one thing a turn count cannot express: a run writes
  a temp prompt file through the process-wide file queue before it spawns, and a
  loaded runner takes longer over that write than any fixed number of ~1 ms
  turns. `waitFor` therefore takes an elapsed-time budget (2 s by default) — not
  an attempt count — and times out loudly rather than turning runner load into a
  coin flip. Reach for it only when the completion point is genuinely outside
  the test; otherwise `settle()` plus an assertion.
- No `Date.now()` / `new Date()` in tests; inject `makeClock` (`helpers/clock.ts`).
  `waitFor` is the exception, for the reason above.
- No real network. Drive request handlers / routers directly; web-access injects
  its HTTP fetch.
- Real git only inside temp dirs tracked by the suite harness.
- The one real-process exception is the job exit-trap suite: it runs a POSIX
  shell to exercise shell `EXIT`-trap semantics, with fixed commands and exit
  codes, and is skipped on Windows. A child is the one thing `settle()` cannot
  drain, so both of its waits are bounded with `waitFor`: the shell's exit at
  10 s, which reports "the shell did not exit within 10000ms", and the status
  file the trap writes as the shell exits, which lands after the child's `close`
  (2 s). An unbounded wait there is what a rotating `--parallel` failure looked
  like — a 30 s timeout on the test, with no reason in it.
- `PI_CODING_AGENT_DIR` is touched only through `helpers/env.ts`
  (`useAgentDir` / `withAgentDir`).

## Banned patterns (enforced)

`test/conventions.test.ts` scans every `*.test.ts` under `extensions/`, `lib/`, and
`scripts/`, and fails on:

- `mock.module(` / `mock.restore(`;
- `process.env.<NAME> =`, `process.env[NAME] =`, or `delete process.env.*`
  (reads are allowed);
- `setTimeout(` / `setInterval(` — the one exception is the watchdog inside
  `test/helpers/git.ts`'s `execP`, which bounds a single git call so a lost
  subprocess exit notification (`oven-sh/bun#41024`) cannot hang a whole test;
- `Date.now()` / `new Date(` used for assertions;
- padding assertions — a string literal with three or more consecutive spaces
  passed to an assertion helper;
- local theme doubles — an object literal with an `fg:` property.

Keep the scan total: a new extension is covered automatically. The check has
one exemption list in `test/conventions.test.ts`. A single line may also opt out
of one ban with an `allow:<name>` comment on that line or in the comment block
directly above it, when the match is genuine content (for example a
whitespace-normalisation assertion) and not layout padding. Add to either only
with a stated reason; do not silently widen a regex.

## Source conventions (enforced)

`test/conventions.test.ts` scans extension, `lib/`, and `scripts/` **source**
(`.ts`, not `.test.ts`), so the mechanical half of `AGENTS.md` "Code quality" is a
failing test rather than a review note. The renderer rules further down are
`test/tui-conventions.test.ts`, and the line bar is `test/module-sizes.test.ts`.
The capture scripts are unshipped dev tooling, so they are in the banned-pattern
scan and the line bar but not in the renderer and boundary scans. It fails:

- a `TODO` / `FIXME` / `HACK` / `XXX` marker — the work is finished, or it is a
  card on the board;
- a suppression comment (`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`,
  `biome-ignore`, `eslint-disable`) — fix the type or the rule instead;
- `as any` / `: any` / `<any>` / `any[]` — use `unknown` at the boundary, or
  name the host type;
- a commented-out statement, in the shapes it takes (`// const`, `// return`,
  `// if (`, a bare `// }`, …). Prose is not code, so `// for the duration of a
  call` stays.

A tool renderer is also failed when it:

- defines `renderCall(` / `renderResult(` without referencing
  `context.lastComponent`;
- hardcodes the expand key (`Ctrl+O` / `ctrl+o`) instead of binding through
  `keyText(EXPAND_KEYBINDING)`;
- repeats the raw `"app.tools.expand"` id instead of importing
  `EXPAND_KEYBINDING` from `lib/tui/glyphs.ts`.

A source line takes its opt-out the same way, with the reason in the comment.
Two stand today: `allow:todo` in `extensions/todo/nudge.ts`, whose marker is
text the model reads rather than a to-do for a human, and `allow:any` in
`lib/tui/tool.ts`, whose parameter is a partial result Pi types separately for
every tool.

## Extension boundaries (enforced)

An extension never imports another extension's modules. Pi loads each extension
in isolation, so the coupling is invisible at runtime and easy to reintroduce
from a test. `test/boundaries.test.ts` scans every `.ts` file under
`extensions/<name>/` — tests included — and fails any import that resolves into
a different `extensions/<other>/`, in every form: `from`, a side-effect import,
`export ... from`, or a dynamic `import()`. Share the contract instead: tool and
parameter names in `lib/tool-names.ts`, glyphs and status keys in `lib/tui/glyphs.ts`,
everything else under `lib/`.

## lib/ is value-only (enforced)

State is the other half of the same boundary: Pi gives each extension its own
module cache, so a module variable in `lib/` is one copy per extension rather
than one shared value. `test/boundaries.test.ts` fails an unindented `let` or
`var`, and a module-scope `Map`, `WeakMap`, or empty array, anywhere under `lib/`.
A `new Set` is allowed because a keyword table is data; the state that has to
live somewhere is carried in the caller's closure, as `rails.ts` does. A `let`
inside a function is the closure and stays.

## Layout

Tests are grouped into capability suites beside the extension or `lib/`
subsystem they cover. `test/` holds only shared infrastructure, the suite
manifest, and package-level contracts.

```text
BEFORE  (~300 files, one per module)        AFTER  (~100 declared suites)
  extensions/bytefly/block/component.test.ts    extensions/bytefly/block/block.test.ts
  extensions/bytefly/block/fallback.test.ts     extensions/bytefly/chrome.test.ts
  extensions/bytefly/block/register.test.ts     extensions/bytefly/panel/component.test.ts
  extensions/bytefly/header/component.test.ts   ...
  extensions/bytefly/header/register.test.ts
  ...
```

```
extensions/<name>/<capability>.test.ts
extensions/<name>/<sub>/<capability>.test.ts
lib/<area>.test.ts
lib/git/<area>.test.ts
lib/tui/<area>.test.ts
scripts/<area>.test.ts
test/
  README.md
  suite-manifest.ts        # the declared suite layout for extensions, lib, and scripts
  helpers/                 # ALL shared doubles and fixtures
    fakes.ts  context.ts  process.ts  env.ts  entries.ts  config.ts
    git.ts    platform.ts  preload.ts  clock.ts  files.ts  comments.ts
    surface.ts             # the catalog and the registered surface, counted from the tree
    board-page.ts          # the shipped board page, served over a fixture store
    board-flow.ts          # drive a card through the board's gates, for suites about something else
    serve.ts               # a real server a suite mounts a shipped page on, LAN share included
    fixtures/<name>.ts     # extension-specific fixtures
    fixtures/files/<name>  # committed binary fixtures (a legacy .doc, etc.)
  naming.test.ts           # package-level contract
  layout.test.ts           # the test tree's shape, the root-test set, and the suite manifest
  conventions.test.ts      # the line bans: mock.module, real timers, wall clock, TODO, any, local themes
  tui-conventions.test.ts  # the focusable flag, context.lastComponent, the expand keybinding
  module-sizes.test.ts     # the 600-line bar and LONG_MODULES
  boundaries.test.ts       # no cross-extension imports, and lib/ holds no module state
  prerequisites.test.ts    # REQUIREMENTS, and the config files each extension declares
  doc-links.test.ts        # every relative link, anchor, and table cell in the doc tree
  suite-sizes.test.ts      # the 400-line suite bar: every oversized suite named at its height, and a falling total
  drift.test.ts            # lib/README index and AGENTS.md word budget
  docs-parity.test.ts      # README.md and README.zh-CN.md: sections, tables, and links
  doc-counts.test.ts       # every count a doc states, derived from the manifest, skills/, themes/, and the registered tools
  architecture-doc.test.ts # docs/architecture.md: the paths it names, and every lib/ layer
  extension-load.test.ts   # the pi manifest and every extension loading through the fake runtime
  extension-docs.test.ts   # docs/extensions/: the template's order, the capabilities table, the registered surface in it, a Files row for every module (nested ones too), and a suite behind every `## Testing` stem
  refactor-skill.test.ts   # the `refactor` skill's inventory script: measures, graph, churn, budget
  shared-helpers.test.ts   # no re-declared lib or test/helpers export, and no body two files share
  prompt-budget.test.ts    # injected-context size ceilings
  theme.test.ts            # themes/*.json contract, incl. WCAG AA per semantic role
  config-docs.test.ts      # the configuration reference against the loaders
  release.test.ts          # package version, changelog heading, and newest tag
  scripts-surface.test.ts  # the package scripts, and the docs that name them
  settings-coverage.test.ts # the settings catalogue, the loaders it shows, and the docs that count it
  tool-render.test.ts      # every tool's call and result through the shared frame
  wait-budget.test.ts      # no test waits on `waitFor` for a literal budget under a second
```

Rules:

- Every directory under `extensions/` declares at least one capability suite.
- Every `*.test.ts` file under `extensions/`, `lib/`, and `scripts/` is declared
  in `test/suite-manifest.ts`; `test/layout.test.ts` fails an undeclared one
  and a declared suite that does not exist.
- A suite groups a capability, not a module: it may cover several modules, and a
  large module may be covered by more than one suite. Keep a suite under roughly
  400 lines; split it by capability when it grows past that. `test/suite-sizes.test.ts`
  holds the bar: the suites already past it are named there at their height, and a
  named height may only fall. A suite's case count is not gated — a table-driven
  suite hides its count — so the line count stands in for the 40 cases this rule
  used to name.
- Helper files live only under `test/helpers/`.
- Root-level `test/*.test.ts` is limited to `naming.test.ts`, `layout.test.ts`,
  `conventions.test.ts`, `docs-parity.test.ts`,
  `extension-load.test.ts`, `extension-docs.test.ts`, `shared-helpers.test.ts`,
  `prompt-budget.test.ts`, `theme.test.ts`, and the other package-level contracts
  listed above.
- A test that asserts platform behaviour pins it through the injectable seam
  (`isWindows: () => false`) rather than the ambient `process.platform`: the
  suite runs on all three OSes and the seam is how the other two are simulated.
  `process.platform` stays for what genuinely needs the real host — symlink
  creation, a detached child's own output, a shell `EXIT` trap.

## Imports

| From | Source under test | Shared helper | Fixture |
| --- | --- | --- | --- |
| `extensions/<name>/<capability>.test.ts` | `./<module>.ts` or `./<sub>/<module>.ts` | `../../test/helpers/<module>.ts` | `../../test/helpers/fixtures/<name>.ts` |
| `lib/<area>.test.ts` | `./<module>.ts` | `../test/helpers/<module>.ts` | `../test/helpers/fixtures/<name>.ts` |
| `scripts/<area>.test.ts` | `./<module>.ts` | `../test/helpers/<module>.ts` | `../test/helpers/fixtures/<name>.ts` |
| `test/<name>.test.ts` | `skills/<name>/scripts/<module>.ts` | `./helpers/<module>.ts` | `./helpers/fixtures/<name>.ts` |
