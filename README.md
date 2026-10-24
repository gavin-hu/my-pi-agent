# my-pi-agent

**English** · [简体中文](./README.zh-CN.md)

[![CI](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40gavin-hu%2Fmy-pi-agent)](https://www.npmjs.com/package/@gavin-hu/my-pi-agent)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![built for Pi](https://img.shields.io/badge/built%20for-Pi-5A4FCF)](https://pi.dev)

`my-pi-agent` is a single [Pi](https://pi.dev) package that adds a curated set
of extensions, skills, and themes to the agent you already use — install the pack, turn
off what you do not want, and keep using Pi unchanged.

This page is the catalog and the setup instructions. For how to use a feature —
the keys, the commands, and what you should see — start with the
[user guide](./docs/user-guide/).

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
  documents and spreadsheets from inside the session, and answer a WeChat chat
  through a bridge to the live session.

Everything is optional and independently toggleable. Nothing is forked, and no
installed Pi file is modified: Pi discovers the resources through the `pi`
manifest in [`package.json`](./package.json), so the package upgrades with Pi
like any other.

## Quick start

Requires a working [Pi](https://pi.dev) installation.

```bash
pi install npm:@gavin-hu/my-pi-agent
```

[User guide](./docs/user-guide/) has the other sources — git, a
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
- `/bytefly settings` opens the control center's Settings section: one flat list
  of the twelve preferences a session changes, each with its value beside the
  label, `Space`/`Enter` to change one and `Tab` for Global/Project scope. Every
  other key is a `bytefly.json` edit, listed in the configuration reference.
- `/bytefly skills` opens the control center's Skills section: one row per Pi
  skill with its enable checkbox, its declared description underneath, and
  `Space` to switch it on or off for the active scope.
- `/bytefly doctor [extension] [refresh]` prints the doctor report —
  `run_doctor`'s text — and checks that each enabled extension has what it needs
  at runtime.
- `/bytefly update` re-runs the package update check now and reports the
  updateable packages, this package's version and release URL, or a skip.
- `/plan <task>` starts a task in read-only planning mode.
- `/skill:init` creates or updates the instruction file Pi reads through a short built-in interview and a plan you review first.

One thing the pack does on its own: once per interactive session, `bytefly`
asks Pi's package manager which configured packages are behind, suppresses Pi's
own startup update blocks, and posts one themed notice naming
`pi update --extensions`, plus one for a newer Pi that names `pi update` and the
changelog; a new version also marks the header — this package's, and Pi's own.
Nothing about the session is sent — Pi's own release request is only re-rendered —
and `PI_OFFLINE` skips the check;
[`docs/security.md`](./docs/security.md) covers the trust boundaries.

## What you get

19 extensions, 5 packaged skills, and 2 themes, grouped by what you are trying
to do. Each extension's own `README.md` has the full tool and command surface.

### Plan and delegate

| Extension | Tools and commands | What it does |
|---|---|---|
| [`plan`](./extensions/plan/) | `enter_plan_mode`, `write_plan`, `exit_plan_mode`, `cancel_plan_mode`, `set_plan_steps`, `/plan`, `--plan` | Read-only planning: the model investigates, saves a plan under `~/.pi/agent/plans/<repo-key>` — one store per repository, shared by its worktrees — and you approve it before anything is written; with `plan.split` on, the approval can also split it into slices that separate sessions join by name. Review in the TUI, or open it in a browser to leave inline comments: the page follows the plan file live, and you can hand one reviewer link per teammate so each comments under their own name. The `init` skill uses the same review to create or update a project's `AGENTS.md`. |
| [`check`](./extensions/check/) | `run_check`, `/check` | Detect the project's test, lint, or typecheck command (or take `check.command`), run it in a supervised process, and turn failures into a navigable `file:line` list. |
| [`subagent`](./extensions/subagent/) | `subagent`, `/agents` | Delegate a task to a specialist agent (`explorer`, `planner`, `reviewer`, `worker`, `researcher`, `tester`, `debugger`, `documenter`) in its own Pi process — single, parallel, chained, or in the background, with a footer chip while it runs and a finish notice. |
| [`todo`](./extensions/todo/) | `todo`, `/todos` | A persistent task list (`pending` / `in_progress` / `completed`) with a one-line widget. |
| [`goal`](./extensions/goal/) | `goal`, `/goal` | A persistent session objective, kept in a widget and restated before each turn. |
| [`question`](./extensions/question/) | `ask_user_question` | Ask you one or more structured questions (labelled options plus free-form "Other") and wait. |
| [`job`](./extensions/job/) | `job`, `/jobs` | Run long-lived shell commands in the background; inspect logs, wait, or kill them. |
| [`watch`](./extensions/watch/) | `watch`, `/watch` | Tail a file or command output, match lines against patterns, and alert you or hand matching lines to the agent. |
| [`session-bus`](./extensions/session-bus/) | `session`, `/sessions` (screen) | Coordinate parallel Pi sessions on one repository: discover peers, exchange short messages/events, consume an inbox, join a slice of an approved split or claim paths before editing, with `/sessions` as a live board of peers, unread mail, and claims. Local, pull-based by default, with an opt-in inbox watch that raises this session's turn once it is idle; it never spawns an agent. |
| [`context`](./extensions/context/) | `/context` | Show where the context window goes — system prompt, tool definitions, conversation by role, injected notes — and compact from the report with the before and after numbers. |

### Keep your work safe

| Extension | Tools and commands | What it does |
|---|---|---|
| [`worktree`](./extensions/worktree/) | `enter_worktree`, `exit_worktree`, `prune_worktrees`, `list_worktrees`, `/worktree` (screen), `/worktree enter|exit|prune`, `--worktree` | Work inside an isolated `git worktree` on its own branch; the built-in read/write/edit/bash tools follow, and cleanup refuses to throw work away. |
| [`rewind`](./extensions/rewind/) | `/rewind`, `/review`, `↺ N` status chip | Snapshot the repo on every prompt under `refs/pi/rewind`, restore code, conversation, or both, and review the latest turn's changes before reverting a file. |
| [`memory`](./extensions/memory/) | `memory`, `/memory` | Durable cross-session notes as human-editable markdown, injected into each run and managed through the `/memory` picker. |

### Reach the world

| Extension | Tools and commands | What it does |
|---|---|---|
| [`web-access`](./extensions/web-access/) | `web_search`, `web_fetch` | Search the web (keyless DuckDuckGo by default, optional SearXNG or Brave) and fetch a page as readable text, with paging, `find`, per-hop SSRF checks, and optional PDF support. |
| [`file-browse`](./extensions/file-browse/) | `/browse` | Start a loopback, read-only file browser rooted at the working directory, with Markdown preview, a fuzzy quick-open palette, a `path:12-30` reference copied from a selection, live status for a page left open, and a reload hint when the folder it lists changes. |
| [`file-read`](./extensions/file-read/) | `read_doc` | Extract text from a local PDF, DOCX, DOC, ODT, RTF, or XLSX in process, paged. |
| [`file-open`](./extensions/file-open/) | `/open`, `open_path` | Open or reveal a file or directory in the OS-native application. |
| [`wechat`](./extensions/wechat/) | `/wechat`, `send_wechat` | Bridge a WeChat chat to the live session over the Weixin iLink bot API; inbound text, images, and files become turns. |

### Chrome and upkeep

| Extension | Tools and commands | What it does |
|---|---|---|
| [`bytefly`](./extensions/bytefly/) | `/bytefly` (with the `doctor`, `settings`, `skills`, and `update` subcommands), `run_doctor` | The visible layer: a themed header with a width-adaptive footer, a live run line on Pi's working row (tool, tool count, and elapsed time), and a transcript where every tool block leads with its call line and rails its result under it. `/bytefly` switches extensions and skills and holds the curated settings; opt-in `notify` raises OS notifications when a run, a job, or a question needs you, and Pi's own startup update blocks become themed notices and header markers. `bytefly.json` is the config document every extension reads. |

### Skills

Packaged workflows loaded on demand: each skill's name and description are
advertised to the model, and its instructions load only when the task matches
(`/skill:<name>` forces one).

| Skill | What it does |
|---|---|
| [`init`](./skills/init/SKILL.md) | Creates or updates the instruction file Pi actually reads (`AGENTS.md`, or `AGENTS.override.md` when it shadows it) through a built-in interactive interview and plan review, deriving commands, generated paths, packages, and purpose from repository evidence. |
| [`refactor`](./skills/refactor/SKILL.md) | Audits a project or path for refactoring opportunities: duplication, oversized modules, coupling, drift, and high-churn code with weak tests. Returns a ranked shortlist with evidence and verification commands; discovery is read-only. |
| [`changelog`](./skills/changelog/SKILL.md) | Records one user-visible bullet in the same commit as the change, audits commits since the last tag for missing or weak entries, and curates a release section from the project's own rules. |
| [`parallel-dev`](./skills/parallel-dev/SKILL.md) | Runs parallel development as a lead and a team: a lead accountable for the contract, shared files, merge order and a green baseline who also owns a workstream, one owner per disjoint workstream, a walking skeleton first, advisory path claims, a turn-boundary protocol, and independent verification. |
| [`next`](./skills/next/SKILL.md) | Suggests the next todos by priority — loose work, a broken or unfinished promise — from this conversation once it has done work, and from the tree only when it is empty, with the words and a path after the command saying what to ask and where to look. Read-only, and capped at a short numbered list with evidence and the command that starts each. |

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
<tr>
<td width="50%"><img src="assets/session.png" alt="The /sessions screen: a counts summary, session rows with unread and claim counts, the focused session's cwd, claims, and identity, and the Tab scope and watch hints" width="100%"></td>
<td width="50%"><img src="assets/watch.png" alt="The /watch screen: a summary line and watcher rows with live match counts and the focused watcher's pattern and source" width="100%"></td>
</tr>
</table>

### Tool renderings

Every tool block as the transcript draws it — the tool's own call line as the
headline, then the result body two columns under it behind the transcript rail —
each tool's own renderer (or bytefly's generic fallback): the user nameplate and
a notice, Pi's built-ins, and every tool this package registers. The rail glyph
is the `chrome.rail` setting.

![A full-page reference of every tool block: the user nameplate, a notice, the turn rule, Pi's read, write, edit, bash, grep, find, and ls renderers, and every package tool — todo, goal, memory, job, watch, subagent, web_search, web_fetch, read_doc, open_path, run_doctor, run_check, send_wechat, ask_user_question, session, the plan tools, and the worktree tools](assets/tool-renderings.png)

`bun run screenshot:tools` regenerates it; `bun run screenshot:tool-pngs` writes
one image per tool under [`assets/tools/`](./assets/tools).

Ready to use one? The [user guide](./docs/user-guide/) has a walkthrough for
each: the first run, the keys that matter, and what to expect on screen.

## Configuration

Most extensions need no configuration. Every setting lives in one shared
document, `bytefly.json`, read from `<agent-dir>/bytefly.json` and merged with
`<cwd>/.pi/bytefly.json` (project wins), under a top-level section named for the
extension. Each extension's `README.md` covers the behaviour around its keys, and
[`docs/configuration.md`](./docs/configuration.md) has the resolution rules, the
settings screen walkthrough, and every section's keys with their type, default,
and bounds.

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
| [User guide](./docs/user-guide/) | A chaptered manual: install, every feature, settings, troubleshooting, and a command reference. |
| [Configuration](./docs/configuration.md) | Resolution, the settings screen, and every `bytefly.json` key with its default and bounds. |
| [Architecture](./docs/architecture.md) | The load path, runtime model, state, process shapes, and where new code belongs. |
| [Development](./docs/development.md) | Local setup, checks, tests, cross-platform notes, and the release process. |
| [Security](./docs/security.md) | Trust boundaries for the loopback and remote surfaces. |
| [Roadmap](./ROADMAP.md) | Where the pack is going, grouped by the README's promises, with the evidence behind each item. |

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
the setup, the worktree branch flow, and the checks a change must pass. AI
coding agents should read [`AGENTS.md`](./AGENTS.md).

## License

MIT
