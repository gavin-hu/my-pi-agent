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
| `bun run compat:versions` | Print the Pi peer versions this tree resolves to; the compat job records them, and it writes a markdown table to `$GITHUB_STEP_SUMMARY` when GitHub sets one. |
| `bun run release:notes X.Y.Z` | Print one changelog section for `gh release create`. |
| `bun run screenshots` | Regenerate the screenshots and hero under `assets/` (macOS only). |
| `bun run screenshot:plan <plan.md>` | Render one plan through the browser review page and capture it as a full-page PNG with headless Chrome, for checking a plan's Markdown layout. `-o`, `--width`, `--scale`, `--theme light\|dark`, and `--wait` tune the shot; set `PI_CHROME` for a non-default Chrome. |
| `bun run screenshot:tools` | Regenerate the tool call/result gallery (`assets/tool-renderings.png`) with headless Chrome: every tool the package registers plus Pi's built-ins, each rendered by its real renderer through the shipped block frame. `bun run scripts/tool-renderings.ts list` names them all, `render <name> --width n` prints one block as ANSI on any OS, and `html <out>` writes the page. Set `PI_CHROME` for a non-default Chrome. |
| `bun run screenshot:tool-pngs` | Regenerate the one-PNG-per-tool files under `assets/tools/` from the same renderings. |

## Tests

The suite is organized by tier; the full contract is in
[`../test/README.md`](../test/README.md). In short:

1. **Pure-module tests** — one per source module, beside it.
2. **Extension-surface tests** — registration, lifecycle, and integration
   through the shared `createFakePi` / `fakeCtx`.
3. **Surface / TUI tests** — fields, width bounds, ordering, and glyphs, never
   literal column padding.
4. **Package-level tests** — cross-cutting contracts (`naming`, `docs-truth`,
   `extension-load`, `config-docs`, `prompt-budget`, `release`, `structure`,
   `theme`).

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

### Compatibility floor

The dev dependencies pin a floor (`^1.0.4`, resolved by `bun.lock`); `bun run
check` proves the package against exactly that. The floor is not the ceiling: the
`compat` CI job installs the **newest published** peers and runs `typecheck` and
the serial suite against them, so a Pi release that breaks the package is visible
without waiting for someone to bump the lockfile.

- It runs on every push to `main`, on a weekly schedule, and on demand — never on
a pull request, because an upstream release must not fail a change that did not
touch it. A red `compat` run against `main` is the signal.
- Its first step after installing prints the resolved versions, and the job
summary carries the same table, so a run names what it was tested against.
- `test/extension-load.test.ts` is the registration half: it loads every entry in
`package.json`'s `pi.extensions` through the fake runtime, so a host change that
breaks loading fails on every platform and on every pull request.

Reproduce it locally (the peer bump is not committed — this is a measurement,
not an upgrade):

```bash
bun add --dev @earendil-works/pi-agent-core@latest @earendil-works/pi-ai@latest \
  @earendil-works/pi-coding-agent@latest @earendil-works/pi-tui@latest typebox@latest
bun run compat:versions
bun run typecheck && bun run test:serial
git checkout package.json bun.lock && bun install --frozen-lockfile
```

## Release

Distribution is git and npm: `main` is installable as a git Pi package, and every
release is published to npm. A release is an annotated `vX.Y.Z` tag on `main`
plus a matching GitHub release whose body is the changelog section.

The first publish needs an authenticated npm account (`npm login`); after that
`npm publish` uses the token in `~/.npmrc`. `publishConfig.access` is `public`,
so the scoped package is published publicly. Name the registry explicitly: a
machine whose default registry is a read-only mirror (for example
`registry.npmmirror.com`) serves reads but rejects the publish with `E401`.

1. Work on a branch in a worktree (see [`../CONTRIBUTING.md`](../CONTRIBUTING.md)).
2. Curate `[Unreleased]` against `git log <last-tag>..main` so every user-visible
   change has exactly one scoped bullet, with no bullet describing a state that
   was reverted earlier in the same window. Then bump `version` in
   [`../package.json`](../package.json), move the `Unreleased`
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
   bun run release:notes X.Y.Z > section.md
   gh release create vX.Y.Z --title X.Y.Z --notes-file section.md
   rm section.md
   ```

   `release:notes` prints the `## [X.Y.Z]` section (heading included) and exits
   non-zero when that version has no changelog section, so a mistyped version
   fails before `gh` runs.

7. Publish the npm package from the same commit, only after the user approves
   that specific run — a publish is irreversible and public, and approval for an
   earlier release does not carry over:

   ```bash
   npm publish --registry https://registry.npmjs.org/
   ```

GitHub marks the release with the newest creation date as "Latest", so after
creating a release for an older version run `gh release edit vX.Y.Z --latest` on
the newest tag. Publishing a draft does not change which release is latest.

`test/release.test.ts` ties the package version, the newest dated changelog
heading, and the newest `vX.Y.Z` tag together, so a release that skips a step
fails CI.
