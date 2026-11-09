# Contributing

Thanks for wanting to improve `my-pi-agent`. This page is the contributor entry
point: the setup, the branch flow, the checks, the conventions, and the release
process. The repo's rules and their gates live in [`AGENTS.md`](./AGENTS.md); the
test tiers and determinism rules in [`test/README.md`](./test/README.md); the dev
tooling in [`scripts/README.md`](./scripts/README.md). The user documentation is
the site under [`docs/`](./docs/), which GitHub Pages builds.

## Before you start

- Install [Bun](https://bun.sh) and make sure `git` is on `PATH`.
- Read [`AGENTS.md`](./AGENTS.md) for the rules and the gates that hold them.
- For a large change, open an issue first so the approach can be agreed before
  code is written.

## Setup

```bash
bun install
bun run check
```

`bun run check` is the one command that must pass: format check, typecheck, and
the full test suite.

## Branch flow

`main` is treated as protected. Do all work on a branch in its own worktree, one
worktree per task, and enter it before you plan: plan mode is read-only, so it
will not create one.

```bash
# Under Pi with this package loaded, call the worktree tool's enter action:
#   action "enter", name "<name>"

# Otherwise:
git worktree add .pi/worktrees/<name> -b worktree-<name>
```

The branch is cut from `origin/main`, which lags the local `main` when pushes are
infrequent. Leave it there: the branch stays where it was cut, and divergence is
settled once, by the merge.

`main` moves while you work. Commit as each step finishes and let the branch fall
behind; when it is time to land, merge `main` into the branch (or merge the branch
on the `main` checkout), resolve the divergence once, and run `bun run check` on
that merge. Replaying the branch onto `main` with `git rebase main` instead pays a
conflict per commit, and the `--no-ff` merge gives up linear history anyway, so
the replay buys nothing: rebase is only worth it for a private branch of one or
two commits.

With the work committed and the merge checked, ask how to reconcile the branch
(commit, merge, keep, or discard) before `worktree` exits. Exiting with
`remove: true, keepBranch: true` drops the clean worktree, keeps the branch, and
reports the commits ahead plus the merge command; merge on the main checkout with
`git merge --no-ff <branch>`, push, and delete the branch. Never `git add -A` or
`git add .`; stage explicit paths. Never `git reset --hard`, `git checkout .`,
`git clean -fd`, `git stash`, `git commit --no-verify`, or force-push `main`.

## Checks

| Command | What it does |
|---|---|
| `bun run check` | check:format + check:types + the tests |
| `bun run format` | Rewrite formatting with Biome |
| `bun run check:types` | `tsc --noEmit` |
| `bun run check:tests` | Unit tests |
| `bun run check:tests --slow` | The gated git suites: `worktree`, `rewind`, and `session-bus` |

A scope narrows the tests without running the whole suite: `--changed` (what this
change reaches), `--ext <name>`, `--lib <area>`, `--root`, `--static`, `--serial`,
`--watch`, `--dry-run`. [`test/README.md`](./test/README.md#running) lists what
each one covers, and [`scripts/README.md`](./scripts/README.md) owns the command
surface itself.

## Commit format

```
type(scope): summary
```

`scope` is the extension name (`plan`, `worktree`, `bytefly`, …) or the shared
area (`lib`, `docs`, `test`, `ci`). Keep the summary imperative, add a short why-body
for non-trivial changes, and use no emojis.

## Conventions

These are enforced or reviewed; the full list is in [`AGENTS.md`](./AGENTS.md):

- **Extension boundary.** An extension factory only registers. Long-lived
  resources start in `session_start` and are released in an idempotent
  `session_shutdown`.
- **`lib/` is value-only.** Extensions load with isolated module caches, so a
  module-level variable would be duplicated. No extension imports another
  extension's modules.
- **Shared names.** Tool and parameter names that more than one extension agrees
  on live in [`lib/tool-names.ts`](./lib/tool-names.ts); glyphs and status keys
  in [`lib/tui/glyphs.ts`](./lib/tui/glyphs.ts).
- **Prompt budget.** Always-on model-facing text is capped; see
  [`test/prompt-budget.test.ts`](./test/prompt-budget.test.ts) and the tool
  surface section below.
- **TUI.** Follow Pi's built-in design system and the `lib/tui/` kit:
  [`tokens.ts`](./lib/tui/tokens.ts) roles, [`chrome.ts`](./lib/tui/chrome.ts),
  [`rules.ts`](./lib/tui/rules.ts), [`rows.ts`](./lib/tui/rows.ts),
  [`columns.ts`](./lib/tui/columns.ts), [`gauge.ts`](./lib/tui/gauge.ts),
  [`glyphs.ts`](./lib/tui/glyphs.ts), and [`cursor.ts`](./lib/tui/cursor.ts).
  Colors come from a role, never a literal. Width is terminal columns, and
  model- or file-authored text is sanitized at the boundary.

## Adding an extension

1. Add the entrypoint to the `extensions` list in
   [`package.json`](./package.json)'s `pi` manifest.
2. Add the capability suites to [`test/suite-manifest.ts`](./test/suite-manifest.ts)
   and write them (see [`test/README.md`](./test/README.md)).
3. Write `docs/extensions/<name>.md` on the page template below, and list it in
   `docs/extensions/README.md`. Nothing is written beside the code.
4. Add the extension to the catalog table in both entry READMEs — `README.zh-CN.md`
   mirrors `README.md` row by row and `test/docs-parity.test.ts` compares them —
   then update [`test/naming.test.ts`](./test/naming.test.ts) and the
   [`lib/tool-names.ts`](./lib/tool-names.ts) contract if it shares a tool name.

## Writing an extension page

Every extension has one page, `docs/extensions/<name>.md`, listed in
[`./docs/extensions/README.md`](./docs/extensions/README.md). It is written for a
reader who uses the pack, not for someone changing it: `test/extension-docs.test.ts`
holds the shape, and refuses a contributor section, a missing section, or a page
past 120 lines.

1. `# <name> — <tagline>`, a sentence or three, and the hero image when the
   extension has one.
2. `## What you can do` — a table, `| What you want | What to do |`, one row per
   thing the reader wants, ordered by how often it is wanted. Every tool and
   command the extension registers appears somewhere on the page.
3. `## Try it` — the shortest path to seeing it work: one or two commands, or a
   sentence to type, and a link to the tutorial.
4. `## Reference` — the technical half: actions, keys, routes, where its state
   lives in the reader's spelling (`~/.pi/agent/…`), and what it refuses.
5. `## Limits` (optional) — what it will not do, and the two or three edges a
   reader hits.
6. `## Settings` (optional) — the keys they are most likely to change, with a
   link to the configuration reference, and how to switch the extension off.
7. `## Learn more` — at least one relative link onward.

A flow that needs a walkthrough gets one page in `docs/tutorials/` and a link from
the extension page, rather than growing the page into a manual. A doc states no
total for the pack's tools; the entry README's catalog is compared with the
registered set by `test/naming.test.ts`, which is the fact held exactly.

## Adding a packaged skill

A skill is `skills/<name>/SKILL.md` whose frontmatter carries `name` and
`description`, plus its row in both entry READMEs' skill tables. It also ships
the reader's page, `docs/skills/<name>.md`, on the template above — a skill
registers no tool, so its page names `/skill:<name>` and how the skill starts
instead of a tool table — listed in [`docs/skills/README.md`](./docs/skills/README.md)
and in `docs/_data/docs.json`. `test/skill-docs.test.ts` holds the page set, the
template's order, and the 120-line cap.

## One doc per audience

Do not duplicate across these:

- `README.md` — the end-user front door: what the package is, install, the
  grouped catalog, configuration, and links onward. `README.zh-CN.md` mirrors it
  section for section: the two entry READMEs stay in sync, and
  `test/docs-parity.test.ts` enforces the shared headings, table rows, and
  relative links. Deep docs stay English until a translation owner exists.
- `docs/` — the documentation site: `index.md` (the front door), `install.md`,
  `tutorials/` (one walkthrough per flow), `configuration.md` and its
  `configuration-reference.md`, `security.md`, `multi-session.md` and
  `minimal-install.md` (the concepts no single extension owns),
  `extensions/<name>.md`, and `skills/<name>.md`. The page template and the guard
  that holds it are above. Navigation is `docs/_data/docs.json`, so a new page is
  a row there.
- `CONTRIBUTING.md` — this file: the human contributor entry point, this file's
  sections, and the release process.
- `AGENTS.md` — the machine-facing entry point: the rules, the gates that hold
  them, and the traps with no other home.
- `lib/README.md`, `lib/tui/README.md`, `lib/board/README.md`, `scripts/README.md`,
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
  default, parallel) when calls are independent: a read, a process each call
  spawns, an application each call launches. The mode answers a different
  question from the hints — `readOnlyHint: false` keeps a side effect out of plan
  mode's allowance, not calls out of a batch.
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
[`../.github/workflows/publish.yml`](./.github/workflows/publish.yml): a manual
dispatch of the tag, an environment review for approval, the same checks CI runs,
and `npm publish --provenance`. No npm publish token is stored anywhere — the job
authenticates with npm trusted publishing (OIDC). See
[one-time setup](#one-time-publish-setup).

1. Work on a branch in a worktree (see [the branch flow](#branch-flow)).
2. Read `[Unreleased]` against `git log <last-tag>..main`: every user-visible
   change needs exactly one scoped bullet, and no bullet may describe a state
   reverted earlier in the same window. Each version — including `[Unreleased]`
   — holds **one** subsection set in Keep a Changelog's order — `Added`,
   `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` — with nothing empty:
   two sessions merging in the same cycle join the section that already exists
   rather than open a second one, and `test/release.test.ts` fails on a repeated,
   out-of-order, unknown, or empty subsection. Then bump `version` in
   [`../package.json`](./package.json), move the `Unreleased`
   entries in [`../CHANGELOG.md`](./CHANGELOG.md) under
   `## [X.Y.Z] - YYYY-MM-DD`, leave `## [Unreleased]` in place and empty, and
   update the link refs at the bottom of that file. Bump the `@vX.Y.Z` install
   pin in both entry READMEs in the same commit — they are the only docs that
   offer a pin; `test/release.test.ts` fails on a stale pin. This step is the
   only one that renders the screens: recapture `assets/screens/` here, never
   while a feature or fix is in flight; an `assets/cards/` poster instead follows
   its page, recaptured in the change that makes it stale. The hero has to be
   recaptured here because nothing else can: `bun run capture:screens chrome`
   re-renders `assets/screens/chrome.png` from the new `package.json`, because the
   capture needs macOS and Terminal.app — see [`scripts/README.md`](./scripts/README.md#when-an-asset-is-recaptured).
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
   bun run report:notes X.Y.Z > section.md
   gh release create vX.Y.Z --title X.Y.Z --notes-file section.md
   rm section.md
   ```

   `report:notes` prints the `## [X.Y.Z]` section (heading included) and exits
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
   `package.json` is that version, runs `bun run check --serial`, and publishes with
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
so a release that skips a step fails CI. It holds the changelog's shape with them:
in `[Unreleased]` a change is one bullet, so two bullets that open on one scope and
carry the same sentence — a second landing superseding the first — fail naming both,
before the section a release is cut from can say one thing twice.
