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
| `bun run bench:render` | Render 500 and 2000 tool blocks at 80 and 120 columns through the real renderers and report lines, median/p95 frame time, heap per frame, and memo hits. Gates determinism; the timings are a pre-release reading. |
| `bun run release:notes X.Y.Z` | Print one changelog section for `gh release create`. |
| `bun run screenshots [name…]` | Regenerate the screenshots and hero under `assets/` (macOS only); naming screens captures only those. |
| `bun run screenshot:plan <plan.md>` | Render one plan through the browser review page and capture it as a full-page PNG with headless Chrome, for checking a plan's Markdown layout. `-o`, `--width`, `--scale`, `--theme light\|dark`, and `--wait` tune the shot; set `PI_CHROME` for a non-default Chrome. |
| `bun run screenshot:tools` | Regenerate the tool call/result gallery (`assets/tool-renderings.png`) with headless Chrome: every tool the package registers plus Pi's built-ins, each rendered by its real renderer through the shipped block frame. `bun run scripts/tool-renderings.ts list` names them all, `render <name> --width n` prints one block as ANSI on any OS, and `html <out>` writes the page. Set `PI_CHROME` for a non-default Chrome. |
| `bun run screenshot:tool-pngs` | Regenerate the one-PNG-per-tool files under `assets/tools/` from the same renderings. |

## Screenshots

`bun run screenshots` captures the terminal surfaces and the `chrome.png` hero on
macOS: each frame is drawn by the shipped component with the `bytefly-dark`
theme inside a real Terminal.app window, then captured with `screencapture`, so
the docs show the product rather than a mock. Naming screens captures only
those; with no argument it captures every entry in the `SCREENS` map of
`scripts/screenshots.ts` and then the hero. To check a layout without a
capture, `bun run scripts/screenshots.ts render <name>` prints one frame as ANSI
on any OS; `--width` and `--rows` override the terminal.

A screen is an asset stem, a window title, and a `render(width, rows)` that
builds its real component around fixtures. It may also set `bounds` and `size`,
and a row-budgeted screen has to: Terminal.app snaps a resize to whole cells and
enforces a minimum window width, so a capture that depends on its rows or wraps
a hint row would otherwise shoot whatever geometry the window reached.
`scripts/screenshots.test.ts` renders every entry at three widths and fails when
a frame leaves the terminal or outgrows its `rows`.

Two kinds of asset come from headless Chrome instead of the terminal:
`plan-review.png` from `screenshot:plan`, and the tool galleries from
`screenshot:tools` and `screenshot:tool-pngs`. `file-browse.png` has no
generator: it was captured by hand from the loopback browser, so a change to
that page needs a manual refresh or a new harness beside `screenshot:plan`.

The screenshot grid in the root `README.md` is a curated set rather than the
full list; each screen is shown in its own extension README.

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
and hang a git-using test. The cause is upstream: `oven-sh/bun#41024` and
`#39709` are open against Bun 1.4.3, and `#45483` (filed 2026-10-16) describes
the same lost-exit path. When both close, delete the `check:serial` step and run
`bun run check` on all three systems; [`ROADMAP.md`](../ROADMAP.md)
*Deliberately left thin* records the same condition.

## Performance

A frame re-renders every block in the transcript, so the cost that makes a long
session feel slow is per block, per frame. `bun run bench:render` measures that:
it builds 500 and 2000 tool blocks from the gallery fixtures through the real
renderers — the same code a session draws — and prints, per width, the lines, the
median and p95 frame time, heap per frame, and how many blocks came back from
their render memo instead of being rebuilt.

```bash
bun run bench:render
```

Two different things come out of it:

- **The gate, which is deterministic:** the same input must produce the same line
  array, and every line must fit the width. `scripts/render-bench.test.ts` asserts
  both at 500 blocks on every platform, so a renderer that reads a clock or grows
  state between frames fails CI.
- **The numbers, which are a pre-release reading:** wall-clock and heap depend on
  the machine, so no CI job gates on them. On the author's laptop a 2000-block
  frame takes about 2 ms at 80 and 120 columns; treat **10 ms for 2000 blocks**
  as the point worth investigating, and the memo staying above ~85% of components
  as the healthy baseline (the fixture mix is ~89% today). The fixtures average
  about two lines per block, so compare shapes of the same session size rather
  than raw line counts.

When a change makes a renderer allocate per frame, the memo column is where it
shows: Pi's own `Container` builds a fresh array on every call, so the built-in
`bash` result legitimately misses, but a block bytefly frames should not start
to.

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

Publishing runs in CI, in
[`../.github/workflows/publish.yml`](../.github/workflows/publish.yml): a manual
dispatch of the tag, an environment review for approval, the same checks CI runs,
and `npm publish --provenance`. No npm publish token is stored anywhere — the job
authenticates with npm trusted publishing (OIDC). See
[one-time setup](#one-time-publish-setup).

1. Work on a branch in a worktree (see [`../CONTRIBUTING.md`](../CONTRIBUTING.md)).
2. Read `[Unreleased]` against `git log <last-tag>..main`: every user-visible
   change needs exactly one scoped bullet, and no bullet may describe a state
   reverted earlier in the same window. Each version — including `[Unreleased]`
   — holds **one** `Added`/`Changed`/`Fixed` set, in that order: two sessions
   merging in the same cycle join the section that already exists rather than open
   a second one, and `test/release.test.ts` fails on a repeated, out-of-order,
   unknown, or empty subsection. Then bump `version` in
   [`../package.json`](../package.json), move the `Unreleased`
   entries in [`../CHANGELOG.md`](../CHANGELOG.md) under
   `## [X.Y.Z] - YYYY-MM-DD`, leave `## [Unreleased]` in place and empty, and
   update the link refs at the bottom of that file. Bump the `@vX.Y.Z` install
   pin in [`getting-started.md`](./getting-started.md) in the same commit — it is
   the one page that offers a pin; `test/release.test.ts` fails on a stale pin.
3. Run `bun run check`.
4. Commit as `chore(release): X.Y.Z` and merge the branch into `main`.
5. Tag `main`'s HEAD and push it with `main`, never after it:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z main
   ```

   A `main`-first push races CI's `fetch-depth: 0` checkout: the first release
   job to start before the tag arrives fails `test/release.test.ts` with "newest
   git tag is the package version", and re-running that job clears it.

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

7. Publish from that tag with the release workflow, only after the user approves
   that specific run — a publish is irreversible and public, and approval for an
   earlier release does not carry over:

   ```bash
   gh workflow run publish.yml -f version=X.Y.Z -f confirm=X.Y.Z
   gh run watch "$(gh run list --workflow publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

   The run then waits for the `npm` environment review (the approval), checks out
   `vX.Y.Z` rather than a branch, proves the tag is on `main` and that its
   `package.json` is that version, runs `bun run check:serial`, and publishes with
   `--provenance` through npm trusted publishing. There is no token to leak and no
   local publish path: `publishConfig.provenance` is `true`, so `npm publish` from
   a developer machine fails instead of shipping an unsigned tarball.

GitHub marks the release with the newest creation date as "Latest", so after
creating a release for an older version run `gh release edit vX.Y.Z --latest` on
the newest tag. Publishing a draft does not change which release is latest.

`publishConfig.access` is `public`, so the scoped package is published publicly.
The workflow names the registry explicitly for the same reason the local flow
used to: a machine whose default registry is a read-only mirror (for example
`registry.npmmirror.com`) serves reads but rejects a publish with `E401`.

### One-time publish setup

Both settings live outside this repository and are needed exactly once.

1. **npmjs.com** → the package → Settings → Trusted publishing → GitHub Actions:
   organization `gavin-hu`, repository `my-pi-agent`, workflow `publish.yml`,
   environment `npm`, and tick **Allow npm publish** — a configuration created
   after 2026-09-03 defaults to stage-publish only and would reject the workflow.
   The first publish must succeed within two days of saving, or the configuration
   expires and has to be deleted and recreated with the first publish done again.
2. **GitHub** → Settings → Environments → create `npm` and add a required
   reviewer. That reviewer is the per-release approval; the workflow also names
   the version twice, so a dispatch copied from the previous release fails on the
   confirmation.

After the first successful run, set the package's publishing access to **Require
two-factor authentication and disallow tokens**: trusted publishing keeps working
(it uses OIDC), and a leaked token stops being a publish path.

Trusted publishing needs npm CLI 11.5.1 and Node 22.14 or newer; the workflow
pins Node 24, which ships npm 11. Provenance records the commit, the workflow, and
the runner, so `npm audit signatures` and the npmjs.com badge can verify that the
published tarball was built from this repository's tagged tree.

None of that setup is checked when it is saved. An entry naming a different
repository, workflow filename (`.yml` included), or environment — case included —
is accepted silently, and fails only at publish time as `ENEEDAUTH`: "This
command requires you to be logged in", which reads like a missing credential
rather than a refused OIDC exchange. Only verbose logging tells them apart —
`NPM_CONFIG_LOGLEVEL=verbose npm publish` prints the exchange request,
`POST …/-/npm/v1/oidc/token/exchange/package/@scope%2fname`, and it answers
`package not found` when no entry matched this run. A token in `.npmrc` produces
the same `ENEEDAUTH` by skipping the exchange, and a placeholder one fails the PUT
with `E404` — which is why `test/release.test.ts` forbids `registry-url` and
`token` on `setup-node`. An existing entry cannot be edited: delete it and create
it again, up to ten per package.

`test/release.test.ts` ties the package version, the newest dated changelog
heading, the newest `vX.Y.Z` tag, and the install pins the docs offer together,
so a release that skips a step fails CI.
