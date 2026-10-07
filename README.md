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
| Extension | [`extensions/todo/`](./extensions/todo/) | `todo`: a TodoWrite-style task list (whole-list replacement, `pending`/`in_progress`/`completed`) with a persistent widget and `/todos`. |
| Extension | [`extensions/plan-mode/`](./extensions/plan-mode/) | `plan-mode`: read-only `enter_plan_mode` / `exit_plan_mode` planning (write/edit disabled, bash allowlist, approve-then-execute) with `/plan [prompt]` and `Ctrl+Alt+P`. |
| Extension | [`extensions/web-search/`](./extensions/web-search/) | `web_search`: keyless, fetch-only lookup — DuckDuckGo Instant Answers with a Wikipedia fallback (no general web results). |
| Extension | [`extensions/web-fetch/`](./extensions/web-fetch/) | `web_fetch`: fetch a URL and return readable text (HTML→text, paging, SSRF guard); native `fetch`, no dependencies. |
| Extension | [`extensions/status-bar/`](./extensions/status-bar/) | `status-bar`: a two-line colorful footer — pwd + git branch + worktree, then statuses + context gauge + usage + model; width-adaptive, `/status-bar` toggles it. |
| Extension | [`extensions/guard/`](./extensions/guard/) | `guard`: a permission/safety gate — blocks writes to protected paths (`.env`, `.git`, keys, lockfiles), blocks/confirms dangerous commands and destructive tools, fail-safe without a UI; `/guard` toggles it. |
| Theme | [`themes/nocturne.json`](./themes/nocturne.json) | `nocturne`: a GitHub-inspired dark palette (deep blue-black canvas, cool gray text, blue accent, green/red/yellow status colors, purple/pink operators). |

More extensions, skills, and prompts can be added under the conventional
directories and listed in the `pi` manifest.

### Theme notes

Select `nocturne` through `/settings` → **Theme** (or `pi --use-theme nocturne`).
Pi themes cannot set the terminal's background, so the live canvas stays your
terminal's color — set it to `#0d1117` for the intended look. HTML exports use
the theme's `export.pageBg`, so they are unaffected.

## Development

```bash
bun install
bun run test      # unit + git-integration tests (bun test --isolate)
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
