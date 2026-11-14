# my-pi-agent

**English** · [简体中文](./README.zh-CN.md)

[![CI](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40gavin-hu%2Fmy-pi-agent)](https://www.npmjs.com/package/@gavin-hu/my-pi-agent)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![built for Pi](https://img.shields.io/badge/built%20for-Pi-5A4FCF)](https://pi.dev)

`my-pi-agent` is a single [Pi](https://pi.dev) package that adds a curated set
of extensions, skills, and themes to the agent you already use — install the pack, turn
off what you do not want, and keep using Pi unchanged.

This page is the catalog and the setup instructions. Each feature's own page
under [`docs/extensions/`](./docs/extensions/) carries the keys, the commands, and
what you should see.

![A terminal window running the Pi TUI: the bytefly header naming Pi and bytefly's versions, three key-hint rows, a nameplated message with its answer and an edit diff behind the rail, a notice that two background jobs finished, naming the test run that passed and the build that failed, the turn rule, the goal and todo rails, the input editor with a half-typed request between its two rules, and the two-line footer — the plan chip and the branch above, the context gauge, the priced cost against its $5 budget, and the model below](assets/screens/chrome.png)

## Contents

- [Why this pack](#why-this-pack)
- [Install](#install)
- [What you get](#what-you-get)
- [What runs on its own](#what-runs-on-its-own)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Why this pack

Pi ships a small, sharp core. This package is the layer on top for people who
want the agent to *think first and work safely*:

- **Plan, then execute.** A read-only mode turns a task into a reviewed plan
  file that the agent then follows step by step.
- **Delegate and parallelize.** Specialist subagents in their own Pi processes,
  long builds in background jobs, and several sessions on one repository through
  a shared bus.
- **Never wreck the checkout.** Isolation is one command: the task moves onto its
  own branch in a `git worktree`, and each prompt's first change is snapshotted,
  so a bad turn is one `/rewind` away.
- **Remember across sessions.** Durable notes live in plain markdown that you
  can read, edit, and version.
- **Reach the web and your files.** Search, fetch, browse, open, and read
  documents and spreadsheets from inside the session — and answer a WeChat chat
  through a bridge to the live session.

## Install

Requires a working [Pi](https://pi.dev) installation.

```bash
pi install npm:@gavin-hu/my-pi-agent                        # the latest release
pi install git:github.com/gavin-hu/my-pi-agent@v0.27.0      # a pinned release
```

`git` on `PATH` is needed by [`worktree`](./docs/extensions/worktree.md) and
[`rewind`](./docs/extensions/rewind.md); everything else degrades or disables
cleanly, and `/bytefly doctor` names what is missing, including optional runtime
pieces. Windows, macOS, and Linux all work, and the full check suite runs on each
in CI.

Everything is optional and independently toggleable. Nothing is forked, and no
installed Pi file is written to: Pi discovers the resources through the `pi`
manifest in [`package.json`](./package.json), so the pack upgrades with Pi like
any other.

Then, from inside Pi:

- `/bytefly` opens the control center: the sixteen preferences a session changes,
  every loaded extension and skill with its checkbox, and the doctor report that
  names anything missing at runtime.
- `/plan <task>` starts a task in read-only planning mode.
- `/skill:init` creates or updates the instruction file Pi reads through a short
  interview and a plan you review first.

## What you get

21 extensions, 3 packaged skills, and 2 themes, grouped by the work they serve.
Each extension's own page in `docs/extensions/` has the full tool
and command surface, opening with its capabilities.

### Plan and delegate

| Extension | Tools and commands | What it does |
|---|---|---|
| [`plan`](./docs/extensions/plan.md) | `plan`, `/plan`, `--plan` | Read-only planning: the model investigates, then you approve the plan before anything is written. |
| [`subagent`](./docs/extensions/subagent.md) | `subagent`, `/agents` | Delegate to a specialist agent in its own Pi process — single, parallel, chained, or in the background. |
| [`todo`](./docs/extensions/todo.md) | `todo`, `/todos` | A persistent task list with one item in progress, drawn as a one-line widget. |
| [`goal`](./docs/extensions/goal.md) | `goal`, `/goal` | A durable session objective, kept in a widget and restated before each turn. |
| [`question`](./docs/extensions/question.md) | `question` | Ask you structured questions with labelled options, and wait for the answer. |
| [`job`](./docs/extensions/job.md) | `job`, `/jobs` | Run long-lived shell commands in the background; read the log, wait, or kill them. |
| [`watch`](./docs/extensions/watch.md) | `watch`, `/watch` | Tail a file or a command's output, and alert you or hand a matching line to the agent. |
| [`session-bus`](./docs/extensions/session-bus.md) | `session`, `/sessions` (screen) | Coordinate parallel sessions on one repository: peers, short messages, an inbox, and path claims. |
| [`serve`](./docs/extensions/serve.md) | — | The session's one loopback server, so `/board`, `/browse`, and a plan review share one port. |
| [`board`](./docs/extensions/board.md) | `board`, `/board` | One shared feature board per repository, two signatures before a card ships. |
| [`team`](./docs/extensions/team.md) | `team`, `/team` | The lead's round over that board: assign, offer, ask — spawning nothing. |
| [`context`](./docs/extensions/context.md) | `/context` | Show where the context window goes, and compact from the report. |

### Keep your work safe

| Extension | Tools and commands | What it does |
|---|---|---|
| [`worktree`](./docs/extensions/worktree.md) | `worktree`, `/worktree` (screen), `/worktree enter\|exit\|prune`, `--worktree` | Work in an isolated `git worktree` on its own branch; the built-in tools follow. |
| [`rewind`](./docs/extensions/rewind.md) | `/rewind`, `↺ N` status chip | Snapshot before each prompt's first change, then restore code, conversation, or both. |
| [`memory`](./docs/extensions/memory.md) | `memory`, `/memory` | Durable cross-session notes as markdown you can read, edit, and version. |

### Reach the world

| Extension | Tools and commands | What it does |
|---|---|---|
| [`web-access`](./docs/extensions/web-access.md) | `web_search`, `web_fetch` | Search the web and fetch a page as readable text, with paging, `find`, and SSRF checks. |
| [`file-browse`](./docs/extensions/file-browse.md) | `/browse` | A loopback, read-only browser for the working directory, with Markdown preview and quick open. |
| [`file-read`](./docs/extensions/file-read.md) | `read_doc` | Extract text from a local PDF, DOCX, DOC, ODT, RTF, or XLSX in process, paged. |
| [`file-open`](./docs/extensions/file-open.md) | `/open`, `open_path` | Open or reveal a file or directory in the OS's own application. |
| [`wechat`](./docs/extensions/wechat.md) | `/wechat`, `send_wechat` | Bridge one WeChat chat to the live session: inbound message in, streamed answer out. |

### Chrome and upkeep

| Extension | Tools and commands | What it does |
|---|---|---|
| [`bytefly`](./docs/extensions/bytefly.md) | `/bytefly` (with the `doctor`, `settings`, `skills`, `update`, and `upgrade` subcommands), `run_doctor` | The visible layer: header, footer, transcript blocks, the settings screen, notifications — and `bytefly.json`, the config every extension reads. |

### Skills

Packaged workflows loaded on demand: each skill's name and description are
advertised to the model, and its instructions load only when the task matches
(`/skill:<name>` forces one).

| Skill | What it does |
|---|---|
| [`init`](./skills/init/SKILL.md) | Creates or updates the instruction file Pi reads, through an interactive interview and a plan you review. |
| [`refactor`](./skills/refactor/SKILL.md) | Audits for duplication, oversized modules, coupling, and drift, then carries the refactor you pick. |
| [`next`](./skills/next/SKILL.md) | Suggests what to do next from this conversation, or from the tree when it is empty. |

### Themes

[`bytefly-dark`](./themes/bytefly-dark.json) is a GitHub-inspired dark palette
and [`bytefly-light`](./themes/bytefly-light.json) its light companion, with
optional automatic light/dark switching. Installing the pack does not change
your theme: pick one through `/settings` → **Theme** (or `/bytefly settings` →
**Theme**), or set `"theme"` in Pi's `settings.json` to
`"bytefly-light/bytefly-dark"` for switching. The screenshot above
uses `bytefly-dark`.

Frames come from [`assets/screens/`](./assets/screens/), and the pages under
[`docs/extensions/`](./docs/extensions/) use them where a screen shows what the
extension does. The tools are one gallery,
[`assets/screens/tool-renderings.png`](./assets/screens/tool-renderings.png):
`bun run capture:tools` regenerates it, and `bun run capture:tool-pngs` writes one
PNG per tool into [`assets/tools/`](./assets/tools).

## What runs on its own

Once per interactive session, `bytefly` asks Pi's package manager which
configured packages are behind and posts one themed notice naming
`pi update --extensions`; a newer Pi gets one naming `pi update`. Nothing about
the session is sent, and `PI_OFFLINE` skips the check —
[`bytefly`'s page](./docs/extensions/bytefly.md) has the header marker and the
cache, [`docs/security.md`](./docs/security.md) the trust boundaries.

## Configuration

Most extensions need no configuration. Every extension setting lives in one
shared document, `bytefly.json`, read from `<agent-dir>/bytefly.json` and
merged with `<cwd>/.pi/bytefly.json` (project wins), under a top-level section
named for the extension. Each extension's page under `docs/extensions/` covers
the behaviour around its keys, and
[`docs/configuration.md`](./docs/configuration.md) has the resolution rules, the
settings screen walkthrough, and every section's keys with their type, default,
and bounds.

Every extension is on by default. To load the pack without some of them, name them
in `PI_DISABLED_EXTENSIONS` (the directory names under [`extensions/`](./extensions/)):

```bash
PI_DISABLED_EXTENSIONS=todo,job pi -e .
```

The variable only stops those factories from registering, and
[configuration](./docs/configuration.md#environment-variables) has its rules; to
drop the whole package, use Pi's `--no-extensions` or remove it from your settings.

## Documentation

| Guide | What it covers |
|---|---|
| [Documentation site](https://gavin-hu.github.io/my-pi-agent/) | The browser edition: a home page, install and configuration, and a sidebar over every extension page. |
| [Install](./docs/install.md) | Adding the pack, pinning a release, upgrading, and removing it. |
| [Configuration](./docs/configuration.md) | Resolution and the settings screen; [`configuration-reference.md`](./docs/configuration-reference.md) lists every key with its default and bounds. |
| [Extension docs](./docs/extensions/) | One page per extension: what it does, how to try it, and the reference half — with a tutorial for each workflow. |
| [Tools and commands](./docs/tools-and-commands.md) | Every tool and slash command the pack registers, by name, with the page that owns it. |
| [Security](./docs/security.md) | Trust boundaries for the loopback and remote surfaces. |
| [Contributing](./CONTRIBUTING.md) | Setup, the branch flow, the checks, and the release process. |

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
the setup, the worktree branch flow, and the checks a change must pass. AI
coding agents should read [`AGENTS.md`](./AGENTS.md).

## License

MIT
