# jobs — background shell-command jobs for Pi

Run long-lived shell commands (builds, test suites, dev servers, watchers) in
the background and manage them without blocking the turn. A job starts
immediately and keeps running across tool calls; poll it, tail its output, wait
for it, or kill it.

```
pi --extension ./extensions/jobs    # load just this extension
pi -e .                             # load the whole @gavin-hu/my-pi-agent package
pi install ./                       # install the package
```

## What it does

- Registers one model-callable tool, `job`, with actions `start`, `list`,
  `status`, `logs`, `kill`, `wait`, and `clear`.
- Runs each command in its own process group, streaming stdout and stderr to an
  append-only log file under `~/.pi/agent/jobs/<project>/`.
- Shows a persistent widget above the editor while jobs run and a `▸N` status
  chip, plus a `/jobs` screen for selecting, tailing, killing, and clearing.
- Reports finished jobs to the model at the start of the next turn, or — for
  jobs started with `wake: true` — by triggering one turn.
- Kills session-owned jobs on shutdown so no process is left behind; start a
  job with `detached: true` to keep it running and reattach next session.

## Tool

| Field | Value |
|---|---|
| `name` | `job` |
| `action` | `start` \| `list` \| `status` \| `logs` \| `kill` \| `wait` \| `clear` |
| `command` | Shell command to run (`start`). |
| `cwd` | Working directory (`start`); defaults to the session cwd. |
| `label` | Short display label (`start`); defaults to the command. |
| `wake` | Wake the agent with one triggered turn when it finishes (`start`). |
| `detached` | Leave it running when the session ends (`start`). |
| `id` | Job id such as `j1` (`status`/`logs`/`kill`/`wait`/`clear`). |
| `lines` | Log lines to return (`logs`, 1–2000). |
| `signal` | `SIGTERM` \| `SIGKILL` \| `SIGINT` (`kill`; default `SIGTERM`). |
| `timeoutMs` | How long `wait` blocks (default 30s). |
| `all` | With `clear`, also remove running jobs. |

Example: start a test suite, then poll it.

```
job start  { "command": "bun test", "label": "tests" }   → j1
job status { "id": "j1" }
job logs   { "id": "j1", "lines": 50 }
job wait   { "id": "j1", "timeoutMs": 120000 }
job kill   { "id": "j1" }
job clear
```

`wait` honours the tool's abort signal: pressing Escape cancels the wait but
leaves the job running.

## Command

| Command | What it does |
|---|---|
| `/jobs` | Interactive list (TUI) or a text summary elsewhere. |

On the `/jobs` screen: `↑`/`↓` or `j`/`k` select, `PgUp`/`PgDn` page,
`Home`/`End` jump, `Enter`/`l` opens the log pane, `d` (or `K`) kills the
selected running job, `x` clears finished jobs, `Esc`/`q` closes. `d` and `x`
ask for a `y`/`N` confirmation before acting, so a stray key cannot kill a
build. In the log
pane, `↑`/`↓`, `PgUp`/`PgDn`, `Home`/`End`, and `g`/`G` scroll; the view follows
the tail until you scroll up, and `Esc`/`Backspace`/`q` returns to the list.

The screen shows a counts summary (`N jobs · R running · F failed`), running
jobs first then recent finished jobs, and a focused detail pane (command, cwd,
outcome, and the last output line). Opening `/jobs` temporarily hides the
widget so the same running jobs are not listed twice; the widget returns when
the screen closes. More generally, any dock screen (`/todos`, `/jobs`,
`/rewind`, `/plans`, or the ask-user-question questionnaire) hides all three
above-editor rails for its lifetime and restores them on close.

## Status chip and widget

While jobs run, the footer shows `▸N` (running), `✗N` (an unreported failure),
or `▸N·✗N` when both are present. The combined form is a single whitespace-free
token so a narrow status bar keeps both counts. The persistent widget is a
single line above the editor:

```
Jobs · 2 running · 1 failed
```

It stays mounted while a job runs or a failure is waiting to be reported, and
disappears once nothing is running and no unreported failure remains. The
`/jobs` screen is the expanded view (per-job rows, detail pane, and logs). Job
output is sanitized before it is rendered: ANSI escapes and control characters
are stripped and carriage-return progress rewrites collapse to their final
state, so a background process cannot corrupt the terminal. The raw log file is
untouched.

## Behaviour by mode

The tool and `/jobs` work in every mode. The widget, the chip, and the
interactive `/jobs` screen need a UI; RPC and non-interactive runs receive tool
results and notifications instead.

## Configuration

Merged from `~/.pi/agent/jobs.json` (global) and `<cwd>/.pi/jobs.json`
(project); project values win.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Track jobs at all. |
| `showStatus` | `true` | Show the `▸N` chip. |
| `showWidget` | `true` | Show the jobs widget. |
| `wakeOnFinish` | `false` | Wake the agent when any job finishes. |
| `detachedByDefault` | `false` | Leave jobs running when the session ends. |
| `maxJobs` | `20` | Finished jobs kept before the oldest are pruned. |
| `maxLogLines` | `100` | Log lines returned by `logs`. |
| `killGraceMs` | `5000` | Grace before SIGTERM escalates to SIGKILL. |
| `repaintMs` | `1000` | Widget repaint interval while jobs run. |
| `sessionTtlMs` | `60000` | How long a session heartbeat is trusted before its jobs may be reaped. |
| `registryDir` | — | Override the registry/log directory. |

## Files

```
index.ts      Extension factory; registers the tool/command and wires events.
schema.ts     Parameter schema and pure validation.
config.ts     jobs.json loading and clamping.
format.ts     Pure formatting, sanitization, and duration helpers.
process.ts    Injectable spawn/liveness/kill-tree primitives.
registry.ts   On-disk registry and pure liveness reconciliation.
session.ts    Per-session heartbeat markers and owner-liveness rules.
runtime.ts    Job table, handles, logs, chip/widget, repaint clock.
tui.ts        JobsWidget and the /jobs screen.
tools.ts      The `job` tool and its transcript rendering.
commands.ts   The `/jobs` command.
types.ts      Shared types.
```
