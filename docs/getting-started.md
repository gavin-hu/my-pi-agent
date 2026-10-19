# Getting started

`my-pi-agent` is a single [Pi](https://pi.dev) package: 16 extensions and two
themes that layer planning, isolation, memory, and web access onto the agent
you already run. This page is meant to end in a decision. By the time you reach
the bottom you will know whether the pack belongs in your setup, and if it does,
it will be installed, verified, and running one real workflow.

Nothing here changes your repository, and every step can be undone.

- **Still deciding?** Read [Is this pack for you?](#is-this-pack-for-you), then
  [try it without installing](#try-it-without-installing).
- **Already decided?** Jump to [Install](#install).

## Is this pack for you?

A filter, not a pitch: five conditions for, four against.

**It fits if you want the agent to...**

- **plan before it writes.** Plan mode takes the writing tools away until you
  approve a plan; the model reads and drafts under `.pi/plans`, then waits.
  [plan](../extensions/plan/)
- **delegate the work.** Specialist subagents run in their own Pi processes, and a
  long build goes to a background job or a watcher instead of blocking the thread.
  [subagent](../extensions/subagent/), [job](../extensions/job/),
  [watch](../extensions/watch/)
- **keep tasks isolated and turns undoable.** Each task runs on its own branch
  in a `git` worktree, and every prompt is snapshotted, so a bad turn is one
  `/rewind` away. [worktree](../extensions/worktree/),
  [rewind](../extensions/rewind/)
- **remember between sessions.** Notes are plain markdown you can read and edit,
  injected into each run. [memory](../extensions/memory/)
- **reach the web and your own documents.** Keyless search, page fetch,
  PDF/DOCX/XLSX text, a read-only file browser, and native file opening.
  [web-access](../extensions/web-access/),
  [document](../extensions/document/)

**It does not fit if you...**

- **do not run Pi.** Nothing here is standalone.
- **want Pi's stock terminal and tool list.** Installing redraws the transcript
  and adds 21 tools to the model's surface.
- **need isolation without `git`.** `worktree` and `rewind` require it; `plan`
  still works, saving plans into Pi's agent directory instead.
- **run the agent unattended.** The value is interactive: approvals, questions,
  toggles, rewind.

Deciding costs a clone, one command that writes nothing, and about ten minutes.
[Try it without installing](#try-it-without-installing).

## Requirements

**Required.** A current [Pi](https://pi.dev) installation on `PATH`
(`pi --version`), on Windows, macOS, or Linux. This is a Pi package, not a fork
or a patch, and it loads the way any other package does. There is no build step:
the extensions are plain TypeScript that Pi loads through `jiti`.

**Optional, per extension.** Each one degrades or disables cleanly, and
`/bytefly doctor` names what is missing.

- `git` on `PATH` for [`worktree`](../extensions/worktree/) and
  [`rewind`](../extensions/rewind/). The rest of the pack loads without it.
- The `unpdf` package for PDF text in `read_doc` and `web_fetch`. An npm install
  brings it; a checkout without dependencies names the package instead.
- A WeChat bot account and login for [`wechat`](../extensions/wechat/).

## Try it without installing

From a clone, load the pack into one Pi run. Nothing is added to your settings
and no theme changes:

```bash
git clone https://github.com/gavin-hu/my-pi-agent
cd my-pi-agent
pi -e .
```

`-e` / `--extension` loads a path for one run, so this session has the pack and
the next one does not. Two commands produce the evidence:

- `/bytefly` lists every resolved extension with its enable checkbox and runtime
  health; the pack's 16 extensions appear as rows, with a missing
  prerequisite spelled out.
- `/plan <a small real task>` runs the flagship workflow: the model plans
  read-only, you review, it writes.

## Install

```bash
# Published release from npm
pi install npm:@gavin-hu/my-pi-agent

# Personal install from git, tracking the default branch
pi install git:github.com/gavin-hu/my-pi-agent

# Pin a release (npm versions and git tags name the same version)
pi install git:github.com/gavin-hu/my-pi-agent@v0.14.0

# Project-local install (.pi/settings.json in the current project)
pi install ./ -l
```

Releases are published to npm and annotated as `vX.Y.Z` tags in git; both name
the same version, so either source pins a stable setup.

An install writes one entry to Pi's settings — Global by default, the project's
`.pi/settings.json` with `-l` — and fetches the package into Pi's cache rather
than into your repository. `pi list` confirms the entry,
`pi update --extensions` moves it to the newest release, and a checkout can be
loaded for a single run with `pi -e .` instead.

## Verify the load

`/bytefly` opens the Extensions screen: one row per resolved extension with its
enable checkbox and runtime health, and the focused row's findings underneath.
`Space` toggles a row, `x` clears a project override, `r` re-probes, and
`/bytefly doctor` prints the same report as text.

The verdicts are read-only: `missing` means an enabled extension cannot work — a
binary not on `PATH`, an optional package never installed; `degraded` means it
works with less; `info` is a note. The `run_doctor` tool gives the model the same
report, and an enabled extension that cannot work says so once at session start.

### What install changes in your terminal

Your theme does not change, and the startup header is opt-in — `/bytefly` →
**Settings** → **Bytefly startup TUI** (Pi's `quietStartup`). The rest of the
transcript chrome is always there — the `You` nameplate, the rule that closes a
completed turn, and the frame around each tool block.

<img src="../assets/chrome.png" alt="A Pi session with the bytefly header, hint row, context and loaded extensions, a turn separator, and the status bar" width="100%">

- 21 tools join the model's tool list, each with a one-line description.
- At most one npm request per interactive session checks for a newer release;
  `PI_OFFLINE` skips it, and nothing about the session is sent.
- Two surfaces serve `127.0.0.1`-only HTTP: `file-browse`'s browser and `plan`'s
  browser review. [security](./security.md) covers the boundaries.

## Your first workflow

Three habits in the order most people pick them up; each extension's README has
the full surface.

**Plan before writing.** `/plan <task>` in a repository. The model reads and
drafts under `.pi/plans`, then shows you the plan: `n` / `p` jump between
sections, `a` approves and runs, `r` asks for a refinement, `Esc` keeps planning.
[plan](../extensions/plan/README.md)

**Isolate the task.** `/worktree enter <name>` puts the session in
`.pi/worktrees/<name>` on its own branch, and the read/write/edit/bash tools
follow. `/worktree exit` refuses to discard a worktree that still holds work.
[worktree](../extensions/worktree/README.md)

**Undo a bad turn.** `/rewind` lists your prompts newest first, diamonds the ones
with a code snapshot, and restores code, conversation, or both. The `↺ N` chip in
the status bar counts the prompts you can rewind to.
[rewind](../extensions/rewind/README.md)

## Turn parts off

**For good.** `/bytefly` → **Extensions**: `Space` writes the toggle to Global or
Project settings (the scope selector says which), `x` clears a project override,
and the screen offers the reload that applies it.

**For one run.** `PI_DISABLED_EXTENSIONS` takes a comma- or whitespace-separated
list of extension names — the directory names under `extensions/` — and applies
only to that process:

```bash
PI_DISABLED_EXTENSIONS=todo,job pi -e .
```

Pi still imports each entrypoint; a disabled factory registers nothing. Names are
case-insensitive and unknown names are ignored.

**Settings and looks.** Every setting lives in one `bytefly.json`, read from Pi's
agent directory and optionally the project's `.pi/`
([configuration](./configuration.md)). Pick `bytefly-dark` or `bytefly-light`
through `/settings` → **Theme**, or switch with
`"theme": "bytefly-light/bytefly-dark"`; `pi --use-theme bytefly-dark` picks one
for a single run. A theme cannot set the terminal background, so the canvas stays
your terminal's color — `#0d1117` is the intended dark look.

## Remove it

`pi remove <source>` (alias `pi uninstall`) drops the package and its settings
entry; add `-l` for a project-local install. `pi list` confirms it is gone.

It leaves state in three places, all inert and safe to delete:

- In the repository, under the gitignored `.pi/`: `plans/`, `subagents/`,
  `worktrees/`, and `memory.md`.
- Snapshot refs: `git for-each-ref refs/pi/rewind` lists them, and
  `git update-ref -d <ref>` deletes one.
- In Pi's agent directory: `bytefly.json` and `memory.md`.

## Where to go next

- [Extensions](./extensions.md) — every extension, and the names it registers.
- [Configuration](./configuration.md) — `bytefly.json`, environment variables,
  and the [full reference](./references/bytefly-config.md).
- [Security](./security.md) — the trust boundaries behind the loopback servers,
  the shell guard, and the WeChat bridge.
- [Architecture](./architecture.md) and [Development](./development.md) — how the
  package fits together, and how to work on it.
