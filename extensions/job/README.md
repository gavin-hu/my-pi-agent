# job — background shell-command jobs for Pi

Run long-lived shell commands (builds, test suites, dev servers, watchers) in
the background and manage them without blocking the turn. A job starts
immediately and keeps running across tool calls; poll it, tail its output, wait
for it, or kill it.

```
pi --extension ./extensions/job    # load just this extension
pi -e .                            # load the whole @gavin-hu/my-pi-agent package
pi install ./                      # install the package
```

## What it does

- Registers one model-callable tool, `job`, with actions `start`, `list`,
  `status`, `logs`, `kill`, `wait`, and `clear`.
- Runs each command in its own process group, streaming stdout and stderr to an
  append-only log file under `~/.pi/agent/jobs/<project>/`.
- Shows a `▸ N` running status chip and a separate `✗ N` unreported-failure
  chip for this session's jobs, plus a `/jobs` screen for selecting, tailing,
  killing, and clearing.
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
| `timeoutMs` | `start`: kill the job after this many ms. `wait`: how long to block (default 30s). |
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
leaves the job running. Validation is pure and runs before any side effect, so
`codemode` callers that bypass the TypeBox schema cannot start a process with
missing arguments.

Each result carries a `JobDetails` object in tool-result `details`:

```
JobDetails {
  action: JobAction
  job?: JobRecord           // start/status/logs/kill/wait
  jobs?: JobRecord[]        // list/clear
  logs?: string             // sanitized tail for `logs`
  truncated?: boolean
  cleared?: number
  signalled?: boolean       // kill sent a signal to a running job
  timedOut?: boolean        // wait hit its timeout
  cancelled?: boolean       // wait was aborted; job still running
  error?: string
}
```

### Transcript

The call line names the action and its target. The result is themed and reuses
the slot's component: `list` draws the same row rail as `/jobs`, `logs` draws a
blank line and the sanitized tail, and a single-job action draws one outcome
line.

```
job list

  ▸ j1  tests                            3.2s
  ✗ j2  build                            0.4s
```

```
job logs j1

… 412 earlier lines
compiled successfully
```

```
job status j1
✓ j1 tests · exit 0 · 12.0s
```

### Command: `/jobs`

`/jobs` opens an interactive list in the TUI, and prints a text summary
elsewhere. The list is **session-scoped**: it shows the jobs this session
started, plus a dead session's records adopted into it, not a live peer's. On
the screen: `↑`/`↓` or `j`/`k` select, `PgUp`/`PgDn` page, `Home`/`End` jump,
`Enter`/`l` opens the log pane, `d` (or `K`) kills the selected running job,
`x` clears finished jobs, `Esc`/`q` closes. `d` and `x` ask for a `y`/`N`
confirmation before acting, so a stray key cannot kill a build; when `x` would
drop an unreported result, the prompt says how many. In the log pane, `↑`/`↓`,
`PgUp`/`PgDn`, `Home`/`End`, and `g`/`G` scroll; the view follows the tail
until you scroll up, and `Esc`/`Backspace`/`q` returns to the list. The pane's
subheader names the job's log file and notes when only a bounded tail is
loaded.

The screen shows a counts summary (`N jobs · R running · F failed`), running
jobs first then recent finished jobs, and a focused detail pane (command, cwd,
outcome, and the last output line). Selection is tracked by job id, so the live
re-sort cannot move the cursor or switch the open log out from under the user.
Any dock screen (`/todos`, `/jobs`, `/rewind`, or the
ask-user-question questionnaire) hides the above-editor goal/todo rails for its
lifetime and restores them on close.

## Behaviour by mode

The tool and `/jobs` work in every mode. The status chip and the interactive
`/jobs` screen need a UI; RPC and non-interactive runs receive tool results and
notifications instead.

## Configuration

Merged from `~/.pi/agent/jobs.json` (global) and `<cwd>/.pi/jobs.json`
(project); project values win.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Track jobs at all. |
| `showStatus` | `true` | Show the `▸ N` / `✗ N` status chips. |
| `wakeOnFinish` | `false` | Wake the agent when any job finishes. |
| `detachedByDefault` | `false` | Leave jobs running when the session ends. |
| `maxJobs` | `20` | Finished jobs kept before the oldest are pruned. |
| `maxLogLines` | `100` | Log lines returned by `logs`. |
| `killGraceMs` | `5000` | Grace before SIGTERM escalates to SIGKILL. |
| `repaintMs` | `1000` | Status-chip refresh interval while jobs run. |
| `sessionTtlMs` | `60000` | How long a session heartbeat is trusted before its jobs may be reaped. |
| `registryDir` | — | Override the registry/log directory. |

## Security

Job output is arbitrary program output and is sanitized at every boundary
before it reaches a terminal or the model: ANSI/OSC escapes and control
characters are stripped, and carriage-return progress rewrites collapse to
their final state. This runs before text reaches the `/jobs` pane, the
model-facing `logs` result, and completion notes. The raw log file is never
rewritten.

## Limitations

- **`unknown` still has no exit code on some paths.** A POSIX job is wrapped in
  an `EXIT` trap that writes `$?` to a per-job `.status` file, so a job
  reattached after its session died reports its real exit code. `exec cmd`
  replaces the shell and bypasses the trap, and Windows has no equivalent, so
  those jobs settle as `unknown`.
- **A live peer session's jobs are hidden.** Records are still merged from
  every session file so ids stay unique and a peer's job is not reaped, but
  `list` and `/jobs` show only this session's jobs (a dead session's records
  are adopted into it). A peer's job can still be reached by an explicit id
  (`status`/`logs`/`kill`; `kill` adopts it).
- **No stdin to running jobs.** Jobs are fire-and-observe; interactive programs
  (a REPL, a debugger prompt) are out of scope.
- **No log rotation.** Logs are append-only files; `logs` reads a bounded tail.
- **Windows is best-effort.** Tree-kill uses `taskkill /T`; POSIX uses process
  groups.

## Non-goals

- **No cron/scheduling.** Jobs run when started, not on a timer.
- **No durable task queue.** Persisted work items are `todo`'s domain; a job is
  an OS process, and mixing the two would blur both.
- **No subagent-job wrapping.** Subagents already have a purpose-built result
  pipeline; a job wrapper adds surface for little gain.

## Pi integration

| Integration point | Details |
|---|---|
| Tool | `pi.registerTool` name `job`; `exposure` defaults to `direct`. |
| Execution mode | `sequential` — actions share the in-memory job table. |
| Annotations | `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: true` — plan mode blocks it. |
| `outputSchema` / `structuredContent` | None. Results return `JobDetails` in tool-result `details` only. |
| State storage | One durable registry file per session, `~/.pi/agent/jobs/<projectKey>/registry-<sessionHash>.json`, merged from every session file on load; a dead session's records are adopted and a legacy shared `registry.json` is migrated once. Ids are reserved with an atomic `O_EXCL` `<id>.lock` before `start`, and a POSIX job's exit code is written to a per-job `.status` file. Tool results carry `JobDetails`; unreported completions arrive as hidden `job-context` messages at `before_agent_start`. |
| Lifecycle | `session_start` loads and reconciles the registry and arms `onFinish`; `session_shutdown` kills session-owned jobs and clears both status chips. `session_tree` repaints; `agent_start`/`agent_settled` track busy; `context` prunes stale `job-context` messages. |

## Design notes

- **Shell commands only, one action-based tool.** A single `job` tool with
  seven actions mirrors `rewind` and keeps the model surface small. Validation
  is pure and runs before any side effect.
- **`child_process.spawn`, not `pi.exec`.** `pi.exec` resolves on exit, the
  opposite of a background job. Jobs are spawned with a shell in their own
  process group, and signals go to the whole group so a shell and its
  descendants die together; Windows uses `taskkill /pid <pid> /T`.
- **One registry file per session, merged on load.** A job outlives a tool
  call and, when detached, a session, so each session writes only its own
  `registry-<sessionHash>.json` (atomic tmp + rename, best-effort) and every
  file is merged on load. A dead session's records are adopted and rewritten
  into this session's file before its file is deleted, while a live peer's are
  kept for id reservation and reaping without being shown; a legacy shared
  `registry.json` is migrated once.
- **Session-scoped surface, project-wide storage.** The registry merges every
  session file for id reservation and adoption, but `list`, the chips, and the
  `/jobs` screen show only this session's jobs. A job the session cannot clear
  or report is never presented as its own.
- **Ids are reserved atomically.** Because ids are project-global but files are
  per session, `start` claims the next `j<n>` with an `O_EXCL` `<id>.lock`
  before spawning, so two sessions cannot pick the same id from a stale read;
  the reservation is pruned once the id is committed to a registry file.
- **Sessions heartbeat; reconciliation is owner-aware.** Each session writes a
  liveness marker, so a peer's live non-detached job is not reaped until its
  owner's marker expires. `persist` merges onto a fresh read and drops ids this
  session deleted.
- **Exit codes survive a session boundary.** A POSIX job is spawned behind an
  `EXIT` trap that writes `$?` to a per-job `.status` file (path passed in the
  environment); a later session reads it when it finds a dead pid and reports
  `exited`/`failed` with the recovered code instead of `unknown`.
- **Reconcile on load; kill by default.** A dead pid becomes `unknown`, a live
  detached job is reattached, and a live non-detached job whose owning session
  is gone is killed. An abandoned build cannot keep running unnoticed, while a
  `detached` dev server survives.
- **Pid reuse is guarded by a start-time token.** Before signalling an unowned
  pid, its best-effort start token (`ps -o lstart=`) is re-checked; a mismatch
  is treated as gone instead of as a signal. Where no token is available the
  check degrades to liveness.
- **Reattached jobs are polled.** A reattached detached job has no child
  handle, so its `close` event never fires; the repaint clock polls it and
  settles it (recovering an exit code from the status file, else `unknown`)
  when the pid disappears.
- **Notify by default, wake opt-in.** A failed job raises one `ctx.ui.notify`
  (a clean exit is left to the list and chips). Finished jobs are also injected
  as a hidden `job-context` message at the next `before_agent_start`. A
  `wake: true` job (or `wakeOnFinish`) additionally triggers one turn when the
  agent is idle; auto-wake is not the default because it easily loops and burns
  tokens.
- **Width-1 glyphs and cached latest line.** The running chip is `▸ N` and the
  failure chip `✗ N`, each a two-token badge under its own status key, so the
  status bar compacts each independently (`▸N` / `✗N`) and an unreported
  failure is never hidden behind the running count. The latest output line is
  cached from the stdout stream for `status`/`wait`/completion notes; only the
  `/jobs` log pane reads the file.
- **Pure logic split from IO.** `format.ts` and the reconciliation in
  `registry.ts` are pure; `process.ts` and the runtime take injectable
  spawn/liveness/kill/clock functions, so the whole suite runs without
  launching a process.
- **The transcript reuses the `/jobs` grammar.** `job list` renders the same
  `jobRow` rail as the screen (running first, capped, `… N more`), `job logs`
  draws a themed tail with a `… N earlier lines` note, and single-job actions
  draw one `formatJobOutcomeLine`. A capped collapsed result ends with the
  `app.tools.expand` hint, and an expanded list shows every job. The renderers
  reuse `context.lastComponent`, and a `wait` in progress (`options.isPartial`)
  renders as a `Waiting …`
  warning.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: registers the tool/command and wires events. |
| `schema.ts` | Parameter schema and pure validation (a `JobCall` union). |
| `config.ts` | `jobs.json` loading and clamping. |
| `format.ts` | Pure formatting, sanitization, duration, and transcript outcome-line helpers. |
| `process.ts` | Injectable spawn/liveness/kill-tree primitives. |
| `paths.ts` | Session/marker/registry/status file-name helpers. |
| `registry.ts` | Per-session registry load/merge, legacy migration, and pure reconciliation. |
| `reservations.ts` | Atomic `O_EXCL` job-id reservation and release. |
| `status.ts` | `EXIT`-trap exit-status file (write path via env, read on reattach). |
| `session.ts` | Per-session heartbeat markers and owner-liveness rules. |
| `store.ts` | Durable store: registry dir, this session's atomic merge-write, deletions. |
| `logs.ts` | Bounded, sanitized log-tail reading. |
| `ui.ts` | Footer status chips. |
| `waiters.ts` | `wait` resolver bookkeeping. |
| `runtime.ts` | Composition: job table, handles, process events, repaint clock. |
| `tui.ts` | The `/jobs` screen and the transcript `JobResult` rail. |
| `tools.ts` | The `job` tool and its transcript rendering. |
| `commands.ts` | The `/jobs` command. |
| `types.ts` | Shared types. |

## Testing

`extensions/job/` covers schema validation (`schema`), pure formatting and
sanitization (`format`), the durable store (`store`), per-session reconciliation
(`registry`), id reservation (`reservations`), exit-status recovery (`status`),
session markers (`session`), bounded log reads and tail flags (`logs`), wait
bookkeeping (`waiters`), the `job` tool (`tools`), the `/jobs` screen (`tui`),
the runtime's session-scoped list and failure notification (`runtime`), and the
install/resume/shutdown lifecycle (`extension`). Tests drive a scripted
`FakeChild` and a temp registry, so the suite runs without launching a process.
