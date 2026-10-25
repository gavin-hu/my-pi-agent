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
| `bun run check:static` | `format:check` + `typecheck`, the static half of `check`. |
| `bun run check` | `format:check` + `typecheck` + `test`. The one command a change must pass. |
| `bun run test` | Unit tests (`bun test --parallel=4`, 30s timeout). |
| `bun run test:serial` | Unit tests, one file at a time. |
| `bun run test:watch` | Unit tests in watch mode. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run format` | `biome format --write .`. |
| `bun run format:check` | `biome format .`, check only. |
| `bun run check:serial` | `bun run check` with the serial suite. |
| `bun run config:migrate [--project <dir>]` | Move each per-extension `<name>.json` into the shared `bytefly.json`, once per machine and repository; `--dry-run` previews and `--keep` leaves the old files. How it behaves is in [`configuration.md`](./configuration.md#migrating-from-older-versions). |
| `bun run compat:versions` | Print the Pi peer versions this tree resolves to; the compat job records them, and it writes a markdown table to `$GITHUB_STEP_SUMMARY` when GitHub sets one. |
| `bun run bench:render` | Render 500 and 2000 tool blocks at 80 and 120 columns through the real renderers and report lines, median/p95 frame time, heap per frame, and memo hits. Gates determinism; the timings are a pre-release reading. |
| `bun run probe:wechat [holdMs]` | Hold one WeChat poll open for the stated milliseconds (default 3000) and report what the server did with it, so a stalled bridge can be diagnosed without a phone; [`extensions/wechat.md`](./extensions/wechat.md) says when to reach for it. |
| `bun run release:notes X.Y.Z` | Print one changelog section for `gh release create`. |
| `bun run screenshots [name…]` | Regenerate the screenshots and hero under `assets/screens/` (macOS only); naming screens captures only those. |
| `bun run screenshot:board [--out <dir>]` | Render the board page and capture both tabs as full-page PNGs with Playwright driving the local Chrome. It starts the shipped board server over a fixture store in a temporary directory, so the image never names a real checkout; `--out`, `--width`, `--scale`, `--theme light\|dark`, `--wait`, and `--dialog card\|confirm\|new` (one modal instead of the two tabs) tune the shot. Set `PI_CHROME` for a non-default Chrome. |
| `bun run screenshot:file-browse [--root <dir>]` | Render the loopback file browser's file page and capture it as a full-page PNG with Playwright driving the local Chrome. Without `--root` it serves a generated fixture project, so the image never names a real checkout; `--file`, `-o`, `--width`, `--scale`, `--theme light\|dark`, and `--wait` tune the shot. Set `PI_CHROME` for a non-default Chrome. |
| `bun run screenshot:plan` <plan.md> | Render one plan through the browser review page and capture it as a full-page PNG with Playwright driving the local Chrome, for checking a plan's Markdown layout. `-o`, `--width`, `--scale`, `--theme light\|dark`, and `--wait` tune the shot, and `--as owner\|reviewer` picks the owner's page or the one a shared link opens. `--post <name>` posts one comment as that reviewer before the capture, so the frame shows the name bound to her link, and `--draft <text>` starts the tab with one unsaved comment, the state a reload restores; `--share` opens the owner's Share dialog with two links instead of the plan, so the per-person list is what the frame shows. Set `PI_CHROME` for a non-default Chrome. |
| `bun run screenshot:plan-flow [flow\|graphic]` | Capture the posting cards at 1200×675, 2× by default: `assets/cards/plan-flow.html` and `assets/cards/plan-flow-graphic.html` — the plan-then-execute flow, one prose-led and one graphic-led. Naming one card captures only it and honours `-o`; `--scale` and `--wait` tune the shot, and a card whose content outgrows its box fails the run instead of being captured clipped. Set `PI_CHROME` for a non-default Chrome. |
| `bun run tools:render <list\|render\|html\|gallery\|tools>` | The tool-renderings CLI: `list` names every rendering, `render <name> --width n` prints one block as ANSI on any OS, `html <out>` writes the gallery page, and `gallery <out>` / `tools <dir>` capture PNGs with Playwright driving the local Chrome. `screenshot:tools` and `screenshot:tool-pngs` are the last two with their asset paths filled in. Set `PI_CHROME` for a non-default Chrome. |
| `bun run screenshot:tools` | Regenerate the tool call/result gallery (`assets/screens/tool-renderings.png`) with Playwright driving the local Chrome: every tool the package registers plus Pi's built-ins, each rendered by its real renderer through the shipped block frame. It is `bun run tools:render gallery assets/screens/tool-renderings.png`. |
| `bun run screenshot:tool-pngs` | Regenerate the one-PNG-per-tool files under `assets/tools/` from the same renderings. |

## Screenshots

`assets/` holds three directories, one per thing that writes them: `screens/`
every captured frame — the terminal surfaces, the browser pages, and the tool
gallery — `cards/` the two posting posters with their stylesheet, and
`tools/` the one-PNG-per-tool files. A file belongs where its writer puts it,
which is also the command in the table above that regenerates it.

`bun run screenshots` captures the terminal surfaces and the `chrome.png` hero on
macOS: each frame is drawn by the shipped component with the `bytefly-dark`
theme inside a real Terminal.app window, then captured with `screencapture`, so
the docs show the product rather than a mock. Naming screens captures only
those; with no argument it captures every entry in the `SCREENS` map of
`scripts/screens/index.ts`, the `chrome` hero among them. To check a layout without a
capture, `bun run screenshots render <name>` prints one frame as ANSI
on any OS; `--width` and `--rows` override the terminal.

A screen is an asset stem, a window title, and a `render(width, rows)` that
builds its real component around fixtures. It may also set `bounds` and `size`,
and a row-budgeted screen has to: Terminal.app snaps a resize to whole cells and
enforces a minimum window width, so a capture that depends on its rows or wraps
a hint row would otherwise shoot whatever geometry the window reached.
`scripts/screenshots.test.ts` renders every entry at three widths and fails when
a frame leaves the terminal or outgrows its `rows`.

Four assets come from a headless browser instead of the terminal: the two
browser pages and the tool galleries (`screenshot:tools`, `screenshot:tool-pngs`).
`scripts/capture/chrome.ts` drives Playwright against the Chrome the machine already
has — `PI_CHROME`, else the usual bundles — so a refresh downloads no browser,
and it sizes the window to the document before capturing, so a page wider than the
window is photographed at its own layout. Both page captures have a fixture or a
fixture project, so a refresh reproduces the same examples:

```bash
bun run screenshot:plan scripts/examples/plan-review.md -o assets/screens/plan-review.png --width 1280 --scale 1 --theme dark
bun run screenshot:file-browse -o assets/screens/file-browse.png --theme dark
```

`file-browse` serves a generated project in a temporary directory unless given
`--root`; the page prints the served root, so that default keeps a maintainer's
own checkout out of the image. Both scripts set the theme through the page's own
toggle, which keeps the header glyph and the page in step.

Not every headless capture is a screenshot of the product. `assets/cards/plan-flow.html`
and `assets/cards/plan-flow-graphic.html` are the bilingual cards for posting the
plan-then-execute flow — one prose-led, one graphic-led. Both are captured at
1200×675 by `screenshot:plan-flow`, and they share `assets/cards/plan-flow.css`,
whose shell — palette, `.card`, `.title`, `.foot` — is what keeps the pair from
drifting apart. A card whose content outgrows its box fails the capture rather
than being clipped.

The screenshot grid in the root `README.md` is a curated set rather than the
full list; each screen is shown on its extension's page under
[`docs/extensions/`](./extensions/).

[`../scripts/README.md`](../scripts/README.md) owns the rest: the layout of the
directory, which mechanism a new asset uses, who owns which fixture directory, and
when an asset is recaptured — including why the hero prints the pack's version and
the compatibility floor.

## Tests

The suite is organized by tier; the full contract is in
[`../test/README.md`](../test/README.md). In short:

1. **Capability suites** — grouped by behaviour in `extensions/<name>/`, with
   registration, lifecycle, fields, width bounds, ordering, and glyphs in the
   same suite where they share a capability. The declared layout is
   `test/suite-manifest.ts`.
2. **Library suites** — the same grouping over a `lib/` subsystem, keeping
   pure-unit and platform-seam contracts.
3. **Package-level tests** — cross-cutting contracts (`naming`,
   `extension-load`, `config-docs`, `settings-coverage`, `reference-coverage`,
   `prompt-budget`, `release`, `structure`, `drift`, `theme`, `dependencies`).
   `dependencies` walks each extension
   entrypoint's static import graph, so a parser library loads in the function
   that needs it rather than on every start — the `extract/xlsx.ts` pattern.
   `reference-coverage` derives the user guide's reference tables from the code:
   the command rows from the registrations, each extension's tools, commands, and
   flags from one load of the manifest, the launch rows from the registered flags
   and `lib/env.ts`, and the files-on-disk rows from the modules that place a
   store. A new command, tool, flag, or store with no row therefore fails the
   check instead of waiting for a reader to notice, and the modules that anchor a
   path on the agent directory are listed there so a store cannot ship unnoticed.

Tests are deterministic by construction: inject `now`, `spawn`, `kill`,
`liveness`, and a clock rather than stubbing globals. Real git is allowed only
inside a tracked temp directory.

### Slow suites

The git-heavy `rewind`, `worktree`, and `session-bus` real-repository tests are
gated: they skip unless `CI` is set or `PI_SLOW_TESTS=1` is exported. A local
`bun run check` stays fast; run them with:

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

The same run prints a second table for session pricing: one re-price of a
branch's usage records at 500, 3,000, and 10,000 records, plus 3,000 records
against a 100-key rate table. The footer memoizes that total on the session leaf,
so it is paid when an entry is appended, not every frame — which is why the block
table cannot see it. The gate is the same kind: two re-prices of the same records
must produce the same totals, and `scripts/render-bench.test.ts` asserts that on
every platform. Treat **10 ms for one re-price** as the point worth investigating,
and keep the per-record column near a microsecond; a rate table that is re-scanned
per record shows up here as hundreds of microseconds per record.

## Cross-platform

The package and its checks run on Windows, macOS, and Linux; CI runs the full
`bun run check` on all three. Symlink-dependent tests skip automatically when
the host cannot create symlinks (unprivileged Windows without Developer Mode),
so an unprivileged Windows checkout still passes with skips instead of failures.

`@earendil-works/pi-*` and `typebox` are `peerDependencies` supplied by the Pi
host; they are installed as dev dependencies here only for typechecking and
tests.

### Compatibility floor

The dev dependencies pin a floor (`^1.4.0`, resolved by `bun.lock`); `bun run
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

## Drift rules

Three rules in `AGENTS.md` are gates; the fourth, a cross-cutting change is its
own task, is review, since no test can tell one from a feature. The gates and the
lists behind them are a backlog rather than a blessing, and every list is pinned
to its size so it can only shrink:

- **One body, one owner** is `test/shared-helpers.test.ts`: an extension or a
  capture script may not declare a helper `lib/` already exports, and a body
  identical to one in `lib/` or in any other file is a copy — two extensions, two
  modules of one extension, two `lib/` modules, and two `scripts/` modules all
  count, and a copied `lib/` body is reported at the copy rather than at the
  library. The two exception maps carry the reason a
  same-name wrapper is legitimate (a different shape, an injected seam), and the
  guard reads declarations through the TypeScript AST, so an annotated arrow or a
  nested helper is in scope. Its map sizes are pinned: a new copy is extracted,
  not excepted.
- **No module grows** is `LONG_MODULES` in `test/structure.test.ts`: every module
  past 600 lines — under `extensions/`, `lib/`, or `scripts/` — carries the one
  responsibility that keeps it whole and its own height. One added line fails. A height is lowered with the file, deleted once the
  module fits the bar, and the total (`LONG_MODULE_TOTAL`) may only fall — raising
  either number is the refactor this gate exists to prevent.
- **One owner per concept** is `test/drift.test.ts`: every `lib/` module needs a
  row in `lib/README.md`, so the next session reads the index instead of writing a
  fourth copy. The same file keeps `AGENTS.md` inside its word budget, so it stays
  an entry point rather than a second manual.

A module holding two jobs is a refactor waiting for a release: the split costs a
few lines at the bar and a rewrite a thousand lines later.

## Extension conventions

`AGENTS.md` states the rules and names their gates; this section is the detail
behind the ones a contributor hits most often, and the place a new rule lands
when it outgrows a line.

### One doc per extension

Each extension has one doc, `docs/extensions/<name>.md`, listed in
[`./extensions/README.md`](./extensions/README.md). The extension directory
holds code and tests only: no `README.md` beside the code, and no `DESIGN.md`.
Follow this section order, omitting an empty optional section:

1. `# <name> — <tagline>`, a 1–3 sentence intro, then the hero image when the
   extension has one.
2. `## Capabilities` — the key section, a capability table.
3. `## Quickstart` — `pi --extension ./extensions/<name>`, `pi -e .`,
   `pi install ./`, then a first command.
4. Surface — `## Tool` / `## Tools` / `## Commands` / `## Commands and flags` /
   `## Routes`.
5. `## Behaviour by mode` (optional) — `tui`, RPC, JSON, print.
6. `## Configuration` (optional) — the keys this extension answers to, and a
   link to `../configuration.md` for resolution.
7. `## Security` (optional) — only with a real trust boundary.
8. Deep dives (optional) — one section per capability that needs the detail.
9. `## Limitations` (optional).
10. `## Non-goals` (optional).
11. `## Pi integration` — the contract, derived from source: integration
    points, tool `exposure`/`executionMode`/`annotations`/`outputSchema`, state
    storage, and lifecycle hooks (`session_start`/`session_shutdown`).
12. `## Design notes` — a short why, not a design doc.
13. `## Files` — module responsibility table.
14. `## Testing` (optional).

`## Pi integration`, `## Design notes`, `## Files`, and `## Testing` come last,
in that order, after every deep dive: user-facing content stays above the
contributor sections.

A `## Files` row names something that exists, and every non-test module under
`extensions/<name>/` has one; `test/extension-docs.test.ts` holds both
directions, so a page cannot keep describing a file the tree has dropped.

**Capabilities is the key section.** It is what a reader arrives for and what
the rest of the page elaborates, so it comes first and is a table:

| Capability | How | What you get |
|---|---|---|
| Whole-list tracking | `todo`, `/todos` | The model replaces the list in one call; the list follows the session branch. |

- One row per capability, ordered by user value, highest first; `Capability` is
  a two- or three-word noun phrase.
- `How` names the exact tool, command, route, or key in backticks, comma
  separated when several deliver it. Every tool and command the extension
  registers appears in that column, which `test/extension-docs.test.ts` holds by
  loading the factory. A capability with no trigger — one that happens on its own
  — opens the cell with `automatic:` and names what sets it off.
- `What you get` is one sentence of outcome, not mechanism.
- A page may add a fourth `Status` column when some capabilities are not in a
  tagged release: `Shipped`, `Unreleased`, or `Partial`. The guard accepts the
  three-column form or this four-column form.
- The surface sections below elaborate the rows, and a deep dive with no row is
  either missing from the table or not worth a section.
- A page with many capabilities groups the rows under `###` headings — one table
  per group, always the same columns.

**An image is not a capability.** There is no `## Screens` and no
`## Tool rendering`: the hero image goes under the intro, a tool-rendering image
in that tool's surface section, a screen image in the section that documents the
screen.

Use Pi's vocabulary from Pi's own `docs/extensions.md`, account for every mode,
and keep user-facing content above the contributor sections.

### One doc per audience

Do not duplicate across these:

- `README.md` — the end-user front door: what the package is, install, the
  grouped catalog, configuration, and links onward. `README.zh-CN.md` mirrors it
  section for section: the two entry READMEs stay in sync, and
  `test/docs-parity.test.ts` enforces the shared headings, table rows, and
  relative links. Deep docs stay English until a translation owner exists.
- `CONTRIBUTING.md` — the human contributor entry point; points at `AGENTS.md`
  for the invariants and here for the conventions rather than restating them.
- `docs/` — repo-level guides: `user-guide/` (the chaptered end-user manual),
  `configuration` (resolution, the settings screen, and every key with its
  default), `architecture`, `development`, and `security`. The catalog lives in
  `README.md`. Inside the guide, a chapter owns its walkthrough and the keys of
  the screen it describes, and `user-guide/reference.md` owns the one-line
  description of every command — a chapter repeats that sentence only in a
  table a reader is standing in, so the two never disagree. A page is one job
  and stays near 200–400 lines; its title carries no number, so inserting one
  costs the map and the two footers and nothing else; and every extension and
  skill has exactly one page, listed in the guide home's index, which
  `test/extension-load.test.ts` holds against the manifest and `skills/`.
- `ROADMAP.md` — the horizon list, hand-maintained: `test/roadmap.test.ts` pins
  its ids, links, citations, and bucket caps, and shipping an item means
  renumbering or removing it in the same commit.
- `AGENTS.md` — the machine-facing entry point: the four rules, the gates that
  hold them, and the traps with no other home.
- `docs/extensions/<name>.md`, `lib/README.md`, `lib/tui/README.md`,
  `test/README.md` — the deep per-area contracts, with no copy beside the code.

## Tool and prompt surface

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

The non-prompt fields of a tool definition are a contract a permission extension
and the plan-mode policy read, so keep them uniform across extensions:

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
   — holds **one** subsection set in Keep a Changelog's order — `Added`,
   `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` — with nothing empty:
   two sessions merging in the same cycle join the section that already exists
   rather than open a second one, and `test/release.test.ts` fails on a repeated,
   out-of-order, unknown, or empty subsection. Then bump `version` in
   [`../package.json`](../package.json), move the `Unreleased`
   entries in [`../CHANGELOG.md`](../CHANGELOG.md) under
   `## [X.Y.Z] - YYYY-MM-DD`, leave `## [Unreleased]` in place and empty, and
   update the link refs at the bottom of that file. Bump the `@vX.Y.Z` install
   pin in the [getting-started chapter](./user-guide/getting-started.md#install)
   in the same commit — that is the one place that offers a pin;
   `test/release.test.ts` fails on a stale pin. Recapture the hero in the same
   step: `bun run screenshots chrome` re-renders `assets/screens/chrome.png` from the new
   `package.json`, and nothing else can, because the capture needs macOS and
   Terminal.app — see [Screenshots](#screenshots). Bump the pack version in the
   edition line on the [user guide home](./user-guide/README.md) in the same
   commit, and the Pi version there if the guide was rechecked against a newer
   one, so the stamp does not lag the package. The two Pi numbers are separate
   claims: the hero prints the floor `bun.lock` resolved, so it can name a newer
   Pi than the edition line, which records the version the guide was checked on.
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

If the tagged tree turns out to be broken and nothing has been published yet, fix
it and move the tag onto the fix (`git push --force-with-lease origin vX.Y.Z`,
then recreate the release notes): the tag is the artifact, and it costs one push.
After a dispatch the version is public, so the fix is the next version — and read
that version's window first, because a tag whose window has accumulated feature
bullets is a mis-numbered minor, not the patch its number claims.

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
