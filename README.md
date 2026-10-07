# @gavin-hu/my-pi-agent

Personal [Pi](https://pi.dev) customizations, packaged as one installable Pi
package. Everything is discovered through the `pi` manifest in
[`package.json`](./package.json), so Pi loads only what is declared here.

## Install

```bash
pi install ./            # personal, from this checkout
pi install ./ -l         # project-local (.pi/settings.json)
pi install git:github.com/gavin-hu/my-pi-agent   # from git (once pushed)
pi -e .                  # try it for a single run, no settings change
```

## Contents

| Resource | Path | What it does |
|---|---|---|
| Extension | [`extensions/worktree/`](./extensions/worktree/) | `pi-worktree`: isolated `git worktree` workflow (`worktree_enter` / `worktree_exit` / `worktree_prune` / `worktree_status`, `/worktree*` commands, `--worktree <name>`). |
| Extension | [`extensions/ask-user-question/`](./extensions/ask-user-question/) | `ask_user_question`: ask the user one or more structured questions (labelled options + free-form “Other”) and wait for the answer. |

More extensions, skills, prompts, and themes can be added under the conventional
directories and listed in the `pi` manifest.

## Development

```bash
bun install
bun test          # unit + git-integration tests
bun run typecheck # tsc --noEmit
bun run smoke     # real-runtime load + enter/status/exit (no model call)
bun run check     # typecheck + transpile + tests + smoke
```

Extensions are plain TypeScript loaded by Pi through `jiti`, so there is no
build step to run an extension. `@earendil-works/pi-*` and `typebox` are
`peerDependencies` supplied by the Pi host; they are installed as dev
dependencies here only for typechecking and tests.

## Package conventions

- `keywords: ["pi-package"]` and a `pi` manifest in `package.json`.
- Host-provided packages (`@earendil-works/pi-*`, `typebox`) stay in
  `peerDependencies` with a `"*"` range, never in `dependencies`.
- `files` allowlists what a published tarball ships.
- See the [Pi Packages docs](https://github.com/earendil-works/pi/blob/main/docs/packages.md).

## License

MIT
