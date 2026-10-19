# my-pi-agent

**English** · [简体中文](./README.zh-CN.md)

[![CI](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40gavin-hu%2Fmy-pi-agent)](https://www.npmjs.com/package/@gavin-hu/my-pi-agent)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![built for Pi](https://img.shields.io/badge/built%20for-Pi-5A4FCF)](https://pi.dev)

`my-pi-agent` is a single [Pi](https://pi.dev) package that adds a curated set
of extensions and themes to the agent you already use — install the pack, turn
off what you do not want, and keep using Pi unchanged.

![A terminal window running the Pi TUI with the bytefly header, hint row, context and loaded extensions, a turn separator, and the status bar](assets/chrome.png)

## Contents

- [Why this pack](#why-this-pack)
- [Quick start](#quick-start)
- [What you get](#what-you-get)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Why this pack

Pi ships a small, sharp core. This package is the layer on top for people who
want the agent to *think first and work safely*:

- **Plan, then execute.** A read-only planning mode turns a task into a reviewed
  plan file that the agent then follows step by step.
- **Delegate and parallelize.** Run specialist subagents in their own Pi
  processes, push a long build into a background job, and let a watcher tail a
  log until it matters — all while you keep the thread.
- **Never wreck the checkout.** Isolation is one command: the task moves onto its
  own branch in a `git worktree`, and every prompt is snapshotted so a bad turn
  is one `/rewind` away.
- **Remember across sessions.** Durable notes live in plain markdown that you
  can read, edit, and version.
- **Reach the web and your files.** Search, fetch, browse, open, and read
  documents from inside the session, and answer a WeChat chat through a bridge to
  the live session.

Everything is optional and independently toggleable. Nothing is patched or
forked: Pi discovers the resources through the `pi` manifest in
[`package.json`](./package.json), so the package upgrades with Pi like any
other.

## Quick start

Requires a working [Pi](https://pi.dev) installation.

```bash
pi install npm:@gavin-hu/my-pi-agent
```

[Getting started](./docs/getting-started.md) has the other sources — git, a
pinned release, a project-local install, and a trial that writes nothing — plus
the fit decision, the first workflows, and how to remove the pack.

`git` on `PATH` is needed by [`worktree`](./extensions/worktree/) and
[`rewind`](./extensions/rewind/); everything else degrades or disables cleanly,
and `/bytefly doctor` names what is missing, including optional runtime pieces.
Windows, macOS, and Linux all work, and the full check suite runs on each in CI.

Then, from inside Pi:

- `/bytefly [extension] [refresh]` opens the control center on Extensions, lists
  every loaded extension with its runtime health, enables or disables one, and
  clears a project override with `x`.
- `/bytefly settings` opens the control center's Settings section: bytefly
  startup TUI, desktop notifications and their delivery method, the proactive
  health check, the currency and cost precision, the transcript
  rail glyph, output padding, and the hardware cursor, with `Space`/`Enter` to
  change a value and `Tab` for Global/Project scope.
- `/bytefly doctor [extension] [refresh]` prints the doctor report —
  `run_doctor`'s text — and checks that each enabled extension has what it needs
  at runtime.
- `/settings` or `/bytefly settings` → **Theme** selects a theme.
- `/plan <task>` starts a task in read-only planning mode.

One thing the pack does on its own: once per interactive session, `bytefly` asks
npm for the newest published version and marks the header when yours is older.
Nothing about the session is sent, and `PI_OFFLINE` skips the request;
[`docs/security.md`](./docs/security.md) covers the trust boundaries.

## What you get

Sixteen extensions, grouped by what you are trying to do, plus two themes. Each
extension's own `README.md` has the full tool and command surface.

### Plan and delegate

| Extension | Tools and commands | What it does |
|---|---|---|
| [`plan`](./extensions/plan/) | `enter_plan_mode`, `write_plan`, `exit_plan_mode`, `set_plan_steps`, `/plan`, `--plan` | Read-only planning: the model investigates, saves a plan under `.pi/plans`, and you approve it before anything is written. Review in the TUI, or open it in a browser to leave inline comments. |
| [`subagent`](./extensions/subagent/) | `subagent` | Delegate a task to a specialist agent (`explorer`, `planner`, `reviewer`, `worker`, `researcher`, `tester`, `debugger`, `documenter`) in its own Pi process — single, parallel, or chained. |
| [`todo`](./extensions/todo/) | `todo`, `/todos` | A persistent task list (`pending` / `in_progress` / `completed`) with a one-line widget. |
| [`goal`](./extensions/goal/) | `goal`, `/goal` | A persistent session objective, kept in a widget and restated before each turn. |
| [`question`](./extensions/question/) | `ask_user_question` | Ask you one or more structured questions (labelled options plus free-form "Other") and wait. |
| [`job`](./extensions/job/) | `job`, `/jobs` | Run long-lived shell commands in the background; inspect logs, wait, or kill them. |
| [`watch`](./extensions/watch/) | `watch`, `/watch` | Tail a file or command output, match lines against patterns, and alert you or hand matching lines to the agent. |

### Keep your work safe

| Extension | Tools and commands | What it does |
|---|---|---|
| [`worktree`](./extensions/worktree/) | `enter_worktree`, `exit_worktree`, `prune_worktrees`, `list_worktrees`, `/worktree*`, `--worktree` | Work inside an isolated `git worktree` on its own branch; the built-in read/write/edit/bash tools follow, and cleanup refuses to throw work away. |
| [`rewind`](./extensions/rewind/) | `/rewind`, `↺ N` status chip | Snapshot the repo on every prompt under `refs/pi/rewind` and restore code, conversation, or both. |
| [`memory`](./extensions/memory/) | `memory`, `/memory` | Durable cross-session notes as human-editable markdown, injected into each run and managed through the `/memory` picker. |

### Reach the world

| Extension | Tools and commands | What it does |
|---|---|---|
| [`web-access`](./extensions/web-access/) | `web_search`, `web_fetch` | Search the web (keyless DuckDuckGo by default, optional SearXNG or Brave) and fetch a page as readable text, with paging, `find`, per-hop SSRF checks, and optional PDF support. |
| [`file-browse`](./extensions/file-browse/) | `/browse` | Start a loopback, read-only file browser rooted at the working directory, with Markdown preview and a fuzzy quick-open palette. |
| [`document`](./extensions/document/) | `read_doc` | Extract text from a local PDF, DOCX, DOC, ODT, RTF, or XLSX in process, paged. |
| [`file-open`](./extensions/file-open/) | `/open`, `open_path` | Open or reveal a file or directory in the OS-native application. |
| [`wechat`](./extensions/wechat/) | `/wechat`, `send_wechat` | Bridge a WeChat chat to the live session over the Weixin iLink bot API; inbound text, images, and files become turns. |

### Chrome and upkeep

| Extension | Tools and commands | What it does |
|---|---|---|
| [`bytefly`](./extensions/bytefly/) | `/bytefly` (with the `doctor` and `settings` subcommands), `run_doctor` | The visible layer: a themed header with a width-adaptive footer, a live run line on Pi's working row (tool, tool count, and elapsed time), and a transcript where every tool block leads with its call line and rails its result under it. `/bytefly` switches extensions and holds the curated settings; opt-in `notify` raises OS notifications when a run, a job, or a question needs you. `bytefly.json` is the config document every extension reads. |

### Themes

[`bytefly-dark`](./themes/bytefly-dark.json) is a GitHub-inspired dark palette
and [`bytefly-light`](./themes/bytefly-light.json) its light companion, with
optional automatic light/dark switching. Installing the pack does not change
your theme: pick one through `/settings` → **Theme** (or `/bytefly settings` →
**Theme**), or set
`"theme": "bytefly-light/bytefly-dark"` for switching. The screenshots in this
README use `bytefly-dark`.

### Screens

<table>
<tr>
<td width="50%"><img src="assets/todo.png" alt="The /todos screen: a Todos title rule, a 3/7 completed summary, and the list with check, spinner, and circle glyphs" width="100%"></td>
<td width="50%"><img src="assets/question.png" alt="The ask_user_question dialog: Auth and Scope tabs, a question, four numbered options with descriptions, and the navigation hint" width="100%"></td>
</tr>
<tr>
<td width="50%"><img src="assets/job.png" alt="The /jobs screen: a summary line, the job rows with status glyphs and elapsed times, and the focused job's command, cwd, and last output line" width="100%"></td>
<td width="50%"><img src="assets/rewind.png" alt="The /rewind screen: prompt rows newest first, a diamond marking prompts with a code snapshot, and the focused prompt's snapshot detail" width="100%"></td>
</tr>
</table>

### Tool renderings

Every tool block as the transcript draws it — the tool's own call line as the
headline, then the result body two columns under it behind the transcript rail —
each tool's own renderer (or bytefly's generic fallback): the user nameplate and
a notice, Pi's built-ins, and every tool this package registers. The rail glyph
is the `chrome.rail` setting.

![A full-page reference of every tool block: the user nameplate, a notice, the turn rule, Pi's read, write, edit, bash, grep, find, and ls renderers, and every package tool — todo, goal, memory, job, watch, subagent, web_search, web_fetch, read_doc, open_path, run_doctor, send_wechat, ask_user_question, the plan tools, and the worktree tools](assets/tool-renderings.png)

`bun run screenshot:tools` regenerates it; `bun run screenshot:tool-pngs` writes
one image per tool under [`assets/tools/`](./assets/tools).

## Configuration

Most extensions need no configuration. Every setting lives in one shared
document, `bytefly.json`, read from `<agent-dir>/bytefly.json` and merged with
`<cwd>/.pi/bytefly.json` (project wins), under a top-level section named for the
extension. Each extension's `README.md` covers the behaviour around its keys,
[`docs/configuration.md`](./docs/configuration.md) indexes the sections, and
[`docs/references/bytefly-config.md`](./docs/references/bytefly-config.md) lists
every key with its type, default, and bounds.

Every extension is on by default. To load the pack without some of them, set
`PI_DISABLED_EXTENSIONS` to a comma- or whitespace-separated list of extension
names (the directory names under [`extensions/`](./extensions/)):

```bash
PI_DISABLED_EXTENSIONS=todo,job pi -e .
```

Names are compared case-insensitively and unknown names are ignored. This only
stops the factories from registering; to drop the whole package, use Pi's
`--no-extensions` or remove the package from your settings.

## Documentation

| Guide | What it covers |
|---|---|
| [Getting started](./docs/getting-started.md) | Whether the pack fits, a trial run, install options, verifying the load, first workflows, and removal. |
| [Extensions](./docs/extensions.md) | The full catalog of every extension and theme. |
| [Configuration](./docs/configuration.md) | Config-file resolution, the per-extension index, environment variables. |
| [Configuration reference](./docs/references/bytefly-config.md) | Every `bytefly.json` section and key, with its type, default, and bounds. |
| [Architecture](./docs/architecture.md) | How the package, its extensions, and `lib/` fit together. |
| [Development](./docs/development.md) | Local setup, checks, tests, cross-platform notes, and the release process. |
| [Security](./docs/security.md) | Trust boundaries for the loopback and remote surfaces. |
| [Roadmap](./ROADMAP.md) | Where the pack is going, grouped by the README's promises, with the evidence behind each item. |

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
the setup, the worktree branch flow, and the checks a change must pass. AI
coding agents should read [`AGENTS.md`](./AGENTS.md).

## License

MIT
