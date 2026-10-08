# @gavin-hu/my-pi-agent

Personal [Pi](https://pi.dev) customizations, packaged as one installable Pi
package. Everything is discovered through the `pi` manifest in
[`package.json`](./package.json), so Pi loads only what is declared here.

## Install

```bash
pi install ./            # personal, from this checkout
pi install ./ -l         # project-local (.pi/settings.json)
pi install git:github.com/gavin-hu/my-pi-agent   # from git
pi -e .                  # try it for a single run, no settings change
```

## Contents

| Resource | Path | What it does |
|---|---|---|
| Extension | [`extensions/worktree/`](./extensions/worktree/) | `pi-worktree`: isolated `git worktree` workflow (`worktree_enter` / `worktree_exit` / `worktree_prune` / `worktree_status`, `/worktree*` commands, `--worktree <name>`). |
| Extension | [`extensions/ask-user-question/`](./extensions/ask-user-question/) | `ask_user_question`: ask the user one or more structured questions (labelled options + free-form “Other”) and wait for the answer. |
| Extension | [`extensions/todo/`](./extensions/todo/) | `todo`: a TodoWrite-style task list (whole-list replacement, `pending`/`in_progress`/`completed`) with a persistent one-line widget and `/todos`. |
| Extension | [`extensions/goal/`](./extensions/goal/) | `goal`: a persistent session objective (`active`/`achieved`) kept in a one-line widget and restated before each turn; `/goal [text\|clear\|done]`. |
| Extension | [`extensions/git/`](./extensions/git/) | `git`: read-only git inspection with no shell — `status`, `diff`, `log`, `show`, and branch listing, annotated `readOnlyHint` so plan mode keeps git visibility. |
| Extension | [`extensions/rewind/`](./extensions/rewind/) | `rewind`: automatic per-prompt working-tree snapshots kept as git refs (`refs/pi/rewind`), plus `/rewind` — pick a prompt on the active branch and restore the code, the conversation, or both. Code rewinds never move HEAD; conversation rewinds use the session tree. |
| Extension | [`extensions/plan-mode/`](./extensions/plan-mode/) | `plan-mode`: read-only planning with `enter_plan_mode` / `write_plan` / `exit_plan_mode`; plans are saved to `.pi/plans`, reviewed from the file, and approved before execution (`/plan [prompt]` to enter, `/plans` to browse and manage, `Ctrl+Alt+P` to toggle). |
| Extension | [`extensions/subagent/`](./extensions/subagent/) | `subagent`: delegate a task to a built-in specialized agent (`explorer`, `planner`, `reviewer`, `worker`) running in its own `pi` process — single, parallel (max 8/4), or chained via `{previous}`. |
| Extension | [`extensions/jobs/`](./extensions/jobs/) | `jobs`: run long-lived shell commands in the background (`job` tool: start/list/status/logs/kill/wait/clear; `/jobs`; `▸N` chip + one-line widget) with sanitized log tails and shutdown/reconcile lifecycle. |
| Extension | [`extensions/web-search/`](./extensions/web-search/) | `web_search`: keyless, fetch-only lookup — DuckDuckGo Instant Answers with a Wikipedia fallback (no general web results). |
| Extension | [`extensions/web-fetch/`](./extensions/web-fetch/) | `web_fetch`: fetch a URL and return readable text (HTML→text, paging, SSRF guard); native `fetch`, no dependencies. |
| Extension | [`extensions/status-bar/`](./extensions/status-bar/) | `status-bar`: a two-line colorful footer — pwd + git branch + worktree, then statuses + context gauge + usage + model; width-adaptive, `/status-bar` toggles it. |
| Extension | [`extensions/turn-separator/`](./extensions/turn-separator/) | `turn-separator`: a labeled dashed line between completed turns — `agent_settled` appends an inert custom entry that an entry renderer draws as `╌╌╌ turn N ╌╌╌`; width-adaptive, TTY-only. |
| Theme | [`themes/nocturne-dark.json`](./themes/nocturne-dark.json) | `nocturne-dark`: a GitHub-inspired dark palette (deep blue-black canvas, cool gray text, blue accent, green/red/yellow status colors, purple/pink operators). |
| Theme | [`themes/nocturne-light.json`](./themes/nocturne-light.json) | `nocturne-light`: the light companion (white canvas, GitHub light accents), for `nocturne-light/nocturne-dark` auto-switching. |

More extensions, skills, and prompts can be added under the conventional
directories and listed in the `pi` manifest.

### Theme notes

Select `nocturne-dark` or `nocturne-light` through `/settings` → **Theme**, or use automatic light/dark switching with `"theme": "nocturne-light/nocturne-dark"` (`pi --use-theme nocturne-dark` for a one-off).
Pi themes cannot set the terminal's background, so the live canvas stays your
terminal's color — set it to `#0d1117` for the intended look. HTML exports use
the theme's `export.pageBg`, so they are unaffected.

## Development

```bash
bun install
bun run test      # unit + git-integration tests (bun test --isolate)
bun run typecheck # tsc --noEmit
bun run smoke     # real-runtime load + enter/status/exit (no model call)
bun run e2e:rewind # real SDK: command context → AgentSession.navigateTree + git restore
bun run check     # typecheck + transpile + tests + smoke + e2e:rewind
```

There is also one live end-to-end test for the `subagent` extension. It makes a
real model call and is skipped unless explicitly enabled:

```bash
PI_SUBAGENT_E2E=1 bun test test/subagent/live.integration.test.ts
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
