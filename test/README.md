# Tests

Testing conventions for this package. Keep this file and the layout in sync;
`test/structure.test.ts` enforces the layout and the banned-pattern rules below.

## Running

```bash
bun test                 # whole suite (parallel workers, 30s timeout)
bun test <path>          # one file or directory
bun run check            # format + typecheck + transpile + test + smoke
```

`bun test` runs each test file in its own worker process (`--parallel`), so
`process.env` edits in one file cannot leak into another.
`test/helpers/preload.ts` additionally snapshots and restores the tracked env
vars (`PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `PI_WORKTREE_ROOT`,
`PI_WORKTREE_BRANCH`, `PI_WORKTREE_MAIN`) around every test.

POSIX-shell and symlink tests self-skip on hosts that cannot support them; the
gate is stated in the test.

## Test tiers

1. **Pure-module tests** (`<module>.test.ts`) — one per source module, beside
   it, importing `./module.ts`. Exercise the module's public contract only.
   Behaviour-named tests, Arrange–Act–Assert, table-driven where cases share a
   shape.
2. **Extension-surface tests** (`extension.test.ts`) — registration, lifecycle,
   and integration points driven through the shared `createFakePi` + `fakeCtx`.
   Split by capability so each test proves one thing.
3. **Surface / TUI tests** — assert fields, width bounds, ordering, and glyphs,
   never literal column padding. Use the shared `fakeTheme` and an injected
   clock for relative timestamps.
4. **Package-level tests** (`test/naming.test.ts`, `test/structure.test.ts`,
   `test/theme.test.ts`) — cross-cutting contracts. No extension test may
   duplicate these.

Rule of thumb: if a test needs `mock.module`, a global stub, or a real timer,
the code under test is missing a seam. Add the seam instead of the mock.

## Principles

1. **Test the contract, not the internals.** Exercise each extension through its
   `index.ts` / exported module surface. Reach into a private helper only when
   that module is itself a pure unit with its own public export.
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
9. **A test lives next to the code it covers.** The module under test is a
   sibling import (`./module.ts`), so coverage and edits stay local.

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
- No `Date.now()` / `new Date()` in tests; inject `makeClock` (`helpers/clock.ts`).
- No real network. Drive request handlers / routers directly; web-access injects
  its HTTP fetch.
- Real git only inside temp dirs tracked by the suite harness.
- The one real-process exception is the job exit-trap suite: it runs a POSIX
  shell to exercise shell `EXIT`-trap semantics, with fixed commands and exit
  codes, and is skipped on Windows.
- `PI_CODING_AGENT_DIR` is touched only through `helpers/env.ts`
  (`useAgentDir` / `withAgentDir`).

## Banned patterns (enforced)

`test/structure.test.ts` scans every `*.test.ts` under `extensions/` and `lib/`
and fails on:

- `mock.module(` / `mock.restore(`;
- `process.env.<NAME> =`, `process.env[NAME] =`, or `delete process.env.*`
  (reads are allowed);
- `setTimeout(` / `setInterval(`;
- `Date.now()` / `new Date(` used for assertions;
- padding assertions — a string literal with three or more consecutive spaces
  passed to an assertion helper;
- local theme doubles — an object literal with an `fg:` property.

Keep the scan total: a new extension is covered automatically. The check has
one exemption list in `test/structure.test.ts`. A single line may also opt out
of one ban with an `allow:<name>` comment when the match is genuine content
(for example a whitespace-normalisation assertion) and not layout padding. Add
to either only with a stated reason; do not silently widen a regex.

## Layout

Tests are co-located with the source they cover. `test/` holds only shared
infrastructure and package-level contracts.

```
extensions/<name>/<module>.test.ts     # one per source module
extensions/<name>/<sub>/<module>.test.ts
lib/<module>.test.ts
lib/git/<module>.test.ts
test/
  README.md
  helpers/                 # ALL shared doubles and fixtures
    fakes.ts  context.ts  process.ts  env.ts  entries.ts
    git.ts    platform.ts  preload.ts  clock.ts
    fixtures/<name>.ts     # extension-specific fixtures
  naming.test.ts           # package-level contract
  structure.test.ts        # layout + banned-pattern guard
  theme.test.ts            # themes/*.json contract
```

Rules:

- Every directory under `extensions/` contains at least one co-located test.
- Helper files live only under `test/helpers/`.
- Root-level `test/*.test.ts` is limited to `naming.test.ts`,
  `structure.test.ts`, and `theme.test.ts`.
- A co-located test's file stem matches the source module it covers. The only
  exceptions are the documented aggregates in `structure.test.ts`.

## Imports

| From | Source under test | Shared helper | Fixture |
| --- | --- | --- | --- |
| `extensions/<name>/x.test.ts` | `./x.ts` | `../../test/helpers/<module>.ts` | `../../test/helpers/fixtures/<name>.ts` |
| `lib/x.test.ts` | `./x.ts` | `../test/helpers/<module>.ts` | `../test/helpers/fixtures/<name>.ts` |
