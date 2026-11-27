# Contributing

`my-pi-agent` is a Pi package of extensions, themes, skills, and shared helpers. The
rules and their gates are in [`AGENTS.md`](./AGENTS.md), the test tiers and determinism
rules in [`test/README.md`](./test/README.md), the dev tooling in
[`scripts/README.md`](./scripts/README.md), and the user documentation in [`docs/`](./docs/),
which GitHub Pages builds.

## Before you start

- Install [Bun](https://bun.sh) and put `git` on `PATH`.
- Read [`AGENTS.md`](./AGENTS.md) — the rules and what holds them.
- For a large change, open an issue so the approach is agreed.

## Checks

```bash
bun install              # once per worktree
bun test --changed=main  # what this branch touches, by Bun's own graph
bun run check            # the landing gate
bun run check:all        # the full sweep: what CI and a release owe
```

| Command | What it does |
|---|---|
| `bun run format` | Rewrite formatting with Biome |
| `bun run check:types` | `tsc --noEmit`, incremental into `.pi/cache/` |
| `bun test` | The tests alone, one file at a time |
| `bun test <dir>` | One slice — `bun test extensions/board/`, `bun test test/` |
| `PI_SLOW_TESTS=1 bun test` | The gated git suites: `worktree`, `rewind`, and `session-bus` |

The landing gate adds `bun test test/`, the package-level contracts, and widens to
`check:all` for a runner change or an unnarrowable one. [`test/README.md`](./test/README.md#running)
covers each invocation and the size gate a card's `verify` names — 600 for a module, 400
for a suite; [`scripts/README.md`](./scripts/README.md) owns the surface.

## Branch flow

`main` is treated as protected. Do all work on a branch in its own worktree, one
worktree per task, and enter it before you plan: plan mode is read-only, so it will
not create one.

```bash
# Under Pi with this package loaded, call the worktree tool's enter action:
#   action "enter", name "<name>"

# Otherwise:
git worktree add .pi/worktrees/<name> -b worktree-<name>
```

The branch is cut from `origin/main`, which lags the local `main` when pushes are
infrequent; leave it there.

`main` moves while you work. Commit as each step finishes; when it is time to land, merge
`main` into the branch (or the branch on the `main` checkout), resolve the divergence
once, and run `bun run check` on that merge. Do not replay the branch with `git rebase`:
it pays a conflict per commit for a history the `--no-ff` merge gives up anyway.

With the work committed and the merge checked, ask how to reconcile the branch before
`worktree` exits (commit, merge, keep, or discard). Exiting with
`remove: true, keepBranch: true` drops the clean worktree, keeps the branch, and reports
the commits ahead plus the merge command; merge on the main checkout with
`git merge --no-ff <branch>`, push, and delete the branch. Stage explicit paths;
[`AGENTS.md`](./AGENTS.md) lists the commands never to run.

## Commit format

```
type(scope): summary
```

`scope` names the surface a reader looks for, not the module a change happens to live
in: an extension name whenever one extension owns the change, even if all its code sits
in `lib/` — a change to the review page reads `code-review`, never `view`. A shared area
only when no extension owns it: `lib` for kit plumbing several pages consume, `docs` for
prose no extension owns, `test` for suite scaffolding, `ci` for the workflows. The
changelog bullet takes the same scope, so one landing reads `merge(board): …` carrying a
`- board: …` bullet. Keep the summary imperative, add a short why-body for a non-trivial
change, and use no emojis.

## Adding an extension

1. Add the entrypoint to the `extensions` list in
   [`package.json`](./package.json)'s `pi` manifest.
2. Add the capability suites to [`test/suite-manifest.ts`](./test/suite-manifest.ts) and
   write them (see [`test/README.md`](./test/README.md)).
3. Write `docs/extensions/<name>.md` on the page template below, and list it in
   `docs/extensions/README.md`. Nothing is written beside the code.
4. Add the extension to the catalog table in both entry READMEs — `README.zh-CN.md`
   mirrors `README.md` row by row, and `test/docs-parity.test.ts` compares them — then
   update [`test/naming.test.ts`](./test/naming.test.ts) and the
   [`lib/tool-names.ts`](./lib/tool-names.ts) contract if it shares a tool name.

## Writing an extension page

Every extension has one page, `docs/extensions/<name>.md`, listed in
[`./docs/extensions/README.md`](./docs/extensions/README.md) and written for a reader who
uses the pack, not for someone changing it. `test/extension-docs.test.ts` holds the shape
and refuses a contributor section, a missing section, or a page past 140 lines.

1. `# <name> — <tagline>`, a sentence or three, and the hero image when it has one.
2. `## What you can do` — a table, `| What you want | What to do |`, one row per thing
   the reader wants, most-wanted first. Every tool and command the extension registers
   appears somewhere on the page.
3. `## Try it` — the shortest path to seeing it work: one or two commands, or a sentence
   to type, and a link to the tutorial.
4. `## Reference` — actions, keys, routes, where its state lives in the reader's spelling
   (`~/.pi/agent/…`), and what it refuses.
5. `## Limits` (optional) — what it will not do, and the two or three edges a reader hits.
6. `## Settings` (optional) — the keys they are most likely to change, a link to the
   configuration reference, and how to switch the extension off.
7. `## Learn more` — at least one relative link onward.

A flow that needs a walkthrough gets one page in `docs/tutorials/` and a link, rather
than growing the page into a manual.

## Adding a packaged skill

A skill is `skills/<name>/SKILL.md` whose frontmatter carries `name` and `description`,
plus its row in both entry READMEs' skill tables. It ships the reader's page too,
`docs/skills/<name>.md`, on the template above — a skill registers no tool, so its page
names `/skill:<name>` and how the skill starts instead of a tool table — listed in
[`docs/skills/README.md`](./docs/skills/README.md) and in `docs/_data/docs.json`.
`test/skill-docs.test.ts` holds the page set, the template's order, and the 120-line cap.

## Conventions

A TUI surface is built from Pi's built-in design system and `lib/tui/`, and neither
keeps its list here: [`docs/design-system.md`](./docs/design-system.md) is what a screen
must do, and [`lib/README.md`](./lib/README.md)'s `tui/` row is every module in the kit.

## Tool and prompt surface

Everything an extension puts in front of the model — `description`, `promptSnippet`,
`promptGuidelines`, parameter docs, injected context — is always-on context. Give each
channel one job, and never put the same instruction in two of them.

- `description`: what the tool is and what it guarantees — contract, limits, side
  effects, prerequisites. Not "use it when…".
- `promptSnippet`, required on every registered tool: the one line in the system prompt's
  Available tools list.
- `promptGuidelines`: when, when not, and in what order; one idea per bullet, imperative.
- Parameter descriptions: meaning, default, and bounds only.
- Injected context: the current facts and the single next action, short, and matched by
  `customType` rather than by marker text.
- Tool errors: name the problem and the corrective action; a rejected call returns the
  unchanged state.

The remaining fields are a contract a permission extension and the plan-mode policy read,
so keep them uniform across extensions:

- `annotations`: declare `readOnlyHint` and `openWorldHint` on every tool. A mutating tool
  also declares `destructiveHint`, and `idempotentHint` is omitted on a read-only one,
  because it only describes repeating a mutation. Missing hints default to the restrictive
  MCP values, so leaving one out is never a shortcut.
- `executionMode`: `"sequential"` on a tool that mutates session, UI, or in-memory runtime
  state, or whose calls are order-dependent; omitted (the host default, parallel) when
  calls are independent — a read, a process each call spawns, an application each call
  launches.
- `exposure` / `defaultActive`: set only when they differ from the default (`direct`,
  active on registration); `model-only`, `codemode`, and a tool activated later from
  `session_start` say so explicitly.
- `outputSchema`: declare it exactly when the result carries a `structuredContent` mirror;
  the two are one contract.
- `getArgumentCompletions`: implemented for every command that takes subcommands or flags.

## One doc per audience

Do not duplicate across these:

- `README.md` — the front door: what the package is, install, the grouped catalog,
  configuration, and links onward. `README.zh-CN.md` mirrors it section for section; deep
  docs stay English until a translation owner exists.
- `docs/` — the site GitHub Pages builds: one walkthrough per flow in `tutorials/`, the
  concepts no extension owns, and one page per extension and skill on the template above.
  Its navigation is `docs/_data/docs.json`, so a new page is a row there, and a page off
  the template fails its test.
- `CONTRIBUTING.md` — this file: the contributor entry point and the release.
- `AGENTS.md` — the machine-facing entry point: the rules, their gates, and the traps.
- `lib/README.md`, `lib/tui/README.md`, `lib/workflow/README.md`, `scripts/README.md`,
  `test/README.md` — the deep per-area contracts, with no copy beside the code.

## Release

Distribution is git and npm: `main` is installable as a git Pi package, and every release
is published to npm. A release is an annotated `vX.Y.Z` tag on `main` plus a matching
GitHub release whose body is the changelog section.

Publishing runs in CI, in
[`../.github/workflows/publish.yml`](./.github/workflows/publish.yml): a manual dispatch
of the tag, an environment review for approval, the same checks CI runs, and
`npm publish --provenance`. No npm publish token is stored anywhere — the job
authenticates with npm trusted publishing (OIDC). Read
[one-time setup](#one-time-publish-setup) before the first release.

1. Work on a branch in a worktree (see [the branch flow](#branch-flow)).
2. Land the version:
   - Read `[Unreleased]` against `git log <last-tag>..main`: one scoped bullet per
     user-visible change, and none describing a state reverted in the same window.
   - One subsection set in Keep a Changelog's order — `Added`, `Changed`, `Deprecated`,
     `Removed`, `Fixed`, `Security` — with nothing empty. Two sessions in one cycle join
     the section that exists; `test/release.test.ts` fails a repeated, out-of-order,
     unknown, or empty subsection, and a second bullet opening on one scope with the same
     sentence as the first.
   - Bump `version` in [`../package.json`](./package.json), move the `Unreleased` entries
     in [`../CHANGELOG.md`](./CHANGELOG.md) under `## [X.Y.Z] - YYYY-MM-DD`, leave
     `[Unreleased]` in place and empty, and repoint the link refs at its foot.
   - Bump the `@vX.Y.Z` pin in both entry READMEs in the same commit — they are the only
     docs that offer one, and `test/release.test.ts` fails a stale pin.
   - Recapture `assets/screens/` here, and never while a feature or fix is in flight:
     `bun run capture:screens chrome` re-renders the hero from the new `package.json`,
     which needs macOS and Terminal.app — see
     [`scripts/README.md`](./scripts/README.md#when-an-asset-is-recaptured). An
     `assets/cards/` poster instead follows its page, recaptured in the change that makes
     it stale.
3. Run `bun run check:all`, commit as `chore(release): X.Y.Z`, and merge the branch into
   `main`.
4. Tag `main`'s HEAD and push the tag with `main` — one push, never after it:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z main
   ```

   A `main`-first push races CI's `fetch-depth: 0` checkout: a job that starts before the
   tag arrives fails `test/release.test.ts` with "newest git tag is the package version";
   re-running it clears that.

5. Create the GitHub release from that changelog section:

   ```bash
   bun run report:notes X.Y.Z > section.md
   gh release create vX.Y.Z --title X.Y.Z --notes-file section.md
   rm section.md
   ```

   `report:notes` prints the `## [X.Y.Z]` section with its heading and exits non-zero when
   the version has none, so a mistyped version fails before `gh` runs.

6. Dispatch the publish, only after the user approves that specific run — a publish is
   irreversible and public, and approval for an earlier release does not carry over. The
   run then waits for the `npm` environment review:

   ```bash
   gh workflow run publish.yml -f version=X.Y.Z -f confirm=X.Y.Z
   gh run watch "$(gh run list --workflow publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

   The run checks out `vX.Y.Z` and publishes with `--provenance`. There is no local
   publish path: `publishConfig.provenance` is `true`, so a developer-machine publish
   fails instead of shipping an unsigned tarball. `publishConfig.access` is `public`, and
   the workflow names the registry explicitly: a machine whose default registry is a
   read-only mirror (`registry.npmmirror.com`) serves reads but rejects a publish with
   `E401`.

GitHub marks the newest creation date as "Latest": after releasing an older version, run
`gh release edit vX.Y.Z --latest` on the newest tag, which a draft does not change.

If the tagged tree is broken and nothing is published yet, move the tag onto the fix
(`git push --force-with-lease origin vX.Y.Z`, then recreate the notes) — the tag is the
artifact. After a dispatch the version is public, so the fix is the next version, and read
that window first: one that has accumulated feature bullets is a mis-numbered minor, not
the patch its number claims.

### One-time publish setup

1. **npmjs.com** → the package → Settings → Trusted publishing → GitHub Actions:
   organization `gavin-hu`, repository `my-pi-agent`, workflow `publish.yml`, environment
   `npm`, and tick **Allow npm publish** — an entry created after 2026-09-03 defaults to
   stage-publish only and would reject the workflow. The first publish must succeed within
   two days of saving, or the entry expires and has to be recreated, first publish and all.
2. **GitHub** → Settings → Environments → create `npm` and add a required reviewer. That
   reviewer is the per-release approval, and the workflow names the version twice, so a
   dispatch copied from the previous release fails on the confirmation.
3. After the first successful run, set the package's access to **Require two-factor
   authentication and disallow tokens**: trusted publishing keeps working over OIDC, and a
   leaked token stops being a publish path. The setup needs npm CLI 11.5.1 and Node
   22.14+, and the workflow pins Node 24 (npm 11).

### When a publish fails

None of the setup is checked when saved: a wrong repository, workflow filename, or
environment is accepted silently and fails at publish time as `ENEEDAUTH`, which reads
like a missing credential. `NPM_CONFIG_LOGLEVEL=verbose` on a publish tells them apart,
answering `package not found` when no entry matched this run; a token in `.npmrc` gives
the same error, which is why `test/release.test.ts` forbids `registry-url` and `token` on
`setup-node`. An existing entry cannot be edited: delete it and create it again, up to ten
per package.
