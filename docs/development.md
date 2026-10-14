# Development

Local setup, the checks a change must pass, and the release process. The
contributor workflow itself is in [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Setup

```bash
bun install
bun run check
```

`git` must be on `PATH`; the `worktree` and `rewind` suites create real
repositories.

## Scripts

| Command | What it does |
|---|---|
| `bun run check` | `format:check` + `typecheck` + `test`. The one command a change must pass. |
| `bun run test` | Unit tests (`bun test --parallel=4`, 30s timeout). |
| `bun run test:serial` | Unit tests, one file at a time. |
| `bun run test:watch` | Unit tests in watch mode. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run format` | `biome format --write .`. |
| `bun run format:check` | `biome format .`, check only. |
| `bun run check:serial` | `bun run check` with the serial suite. |

## Tests

The suite is organized by tier; the full contract is in
[`../test/README.md`](../test/README.md). In short:

1. **Pure-module tests** — one per source module, beside it.
2. **Extension-surface tests** — registration, lifecycle, and integration
   through the shared `createFakePi` / `fakeCtx`.
3. **Surface / TUI tests** — fields, width bounds, ordering, and glyphs, never
   literal column padding.
4. **Package-level tests** — cross-cutting contracts (`naming`,
   `prompt-budget`, `release`, `structure`, `theme`).

Tests are deterministic by construction: inject `now`, `spawn`, `kill`,
`liveness`, and a clock rather than stubbing globals. Real git is allowed only
inside a tracked temp directory.

### Slow suites

The git-heavy `rewind` and `worktree` suites are gated: they skip unless `CI` is
set or `PI_SLOW_TESTS=1` is exported. A local `bun run check` stays fast; run
them with:

```bash
PI_SLOW_TESTS=1 bun run test
```

CI runs the macOS job through `bun run check:serial` because a `--parallel`
worker on macOS can drop the subprocess exit notification for its first spawn
and hang a git-using test.

## Cross-platform

The package and its checks run on Windows, macOS, and Linux; CI runs the full
`bun run check` on all three. Symlink-dependent tests skip automatically when
the host cannot create symlinks (unprivileged Windows without Developer Mode),
so an unprivileged Windows checkout still passes with skips instead of failures.

`@earendil-works/pi-*` and `typebox` are `peerDependencies` supplied by the Pi
host; they are installed as dev dependencies here only for typechecking and
tests.

## Release

Distribution is git-only; nothing is published to npm. A release is an annotated
`vX.Y.Z` tag on `main` plus a matching GitHub release whose body is the
changelog section.

1. Work on a branch in a worktree (see [`../CONTRIBUTING.md`](../CONTRIBUTING.md)).
2. Bump `version` in [`../package.json`](../package.json), move the `Unreleased`
   entries in [`../CHANGELOG.md`](../CHANGELOG.md) under
   `## [X.Y.Z] - YYYY-MM-DD`, leave `## [Unreleased]` in place and empty, and
   update the link refs at the bottom of that file.
3. Run `bun run check`.
4. Commit as `chore(release): X.Y.Z` and merge the branch into `main`.
5. Tag `main`'s HEAD and push it:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main && git push origin vX.Y.Z
   ```

6. Create the GitHub release with that changelog section (heading included) as
   its body:

   ```bash
   awk -v h='## [X.Y.Z]' 'index($0,h){p=1} p && /^## \[/ && !index($0,h){exit} p' CHANGELOG.md > section.md
   gh release create vX.Y.Z --title X.Y.Z --notes-file section.md
   rm section.md
   ```

GitHub marks the release with the newest creation date as "Latest", so after
creating a release for an older version run `gh release edit vX.Y.Z --latest` on
the newest tag. Publishing a draft does not change which release is latest.

`test/release.test.ts` ties the package version, the newest dated changelog
heading, and the newest `vX.Y.Z` tag together, so a release that skips a step
fails CI.
