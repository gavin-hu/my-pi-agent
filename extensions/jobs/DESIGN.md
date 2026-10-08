# `jobs` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Let the agent start a long-running shell command and keep working: launch it in
the background, check on it, tail its output, wait for it, or stop it. Pi's
built-in shell tool resolves only when the command finishes, and the `subagent`
guidelines explicitly leave "recurring background or long-running work" to the
normal tools — which is exactly the gap this extension fills.

## Non-goals

- **No cron/scheduling.** Jobs run when started, not on a timer.
- **No durable task queue.** Persisted work items are `todo`'s domain; a job is
  an OS process, and mixing the two would blur both.
- **No subagent-job wrapping.** Subagents already have a purpose-built result
  pipeline; a job wrapper adds surface for little gain.
- **No stdin to running jobs.** Jobs are fire-and-observe; interactive programs
  (a REPL, a debugger prompt) are out of scope.
- **No log rotation.** Logs are append-only files; `logs` reads a bounded tail.
- **Windows is best-effort.** Tree-kill uses `taskkill /T`; POSIX uses process
  groups.

## Decisions

**Shell commands only, one action-based tool.** A single `job` tool with seven
actions mirrors `rewind` and keeps the model surface small. Validation is
pure and runs before any side effect, so `codemode` callers that bypass the
TypeBox schema cannot start a process with missing arguments.

**`child_process.spawn`, not `pi.exec`.** `pi.exec` resolves on exit, which is
the opposite of a background job. Jobs are spawned with a shell in their own
process group (`detached: true` on POSIX) and their output piped to files.
Signals go to the whole group (`process.kill(-pid, …)`) so a shell and its
descendants die together; Windows uses `taskkill /pid <pid> /T`.

**Durable registry under the agent dir.** A job outlives a tool call and, when
detached, a session. `~/.pi/agent/jobs/<projectKey>/registry.json` records every
job (pid, status, timestamps, log path, flags, `seen`, cached `lastLine`), and
log files sit beside it. `projectKey` hashes the effective cwd (honoring
`PI_WORKTREE_ROOT`), so each project has its own table. Writes are atomic
(tmp + rename) and best-effort: a job still works in-process if the registry is
unwritable.

**Sessions heartbeat; reconciliation is owner-aware.** Because the registry is
shared per project, each session writes a liveness marker beside it
(`session-<hash>.json`: session id, host pid, last-seen time) on load, on start,
and on every repaint tick. Reconciliation keeps a live non-detached job whose
owner marker is alive instead of killing a peer's work, and the poll reaps such
a job once its owner's marker expires. Markers older than `sessionTtlMs` (or
whose pid is gone) are pruned. `persist` merges onto a fresh read and drops ids
this session deleted, so a peer's concurrent additions survive.

**Reconcile on load; kill by default.** At session start no process is owned by
the new runtime, so each running record is checked with `process.kill(pid, 0)`:
a dead pid becomes `unknown`; a live detached job is reattached; a live
non-detached job whose owning session is gone is an orphan and is killed. This
means an abandoned build cannot keep running unnoticed, while a dev server
started `detached` survives. Session-owned jobs are likewise killed in
`session_shutdown`, with a SIGTERM → grace → SIGKILL escalation.

**Notify by default, wake opt-in.** Finished jobs are drained by
`takePending()` and injected as a hidden `job-context` message at the next
`before_agent_start`, deduplicated like `goal`'s context. A job started with
`wake: true` (or `wakeOnFinish`) additionally triggers one turn with
`pi.sendMessage(..., { triggerTurn: true })` when the agent is idle. Auto-wake
is not the default because it is the easiest way to loop and burn tokens; the
explicit `wait` action covers "I must have the result now" deterministically.

**Pid reuse is guarded by a start-time token.** Liveness alone cannot tell a
reattached job from an unrelated process that reused its pid. Each job stores a
best-effort start token (`ps -o lstart=`); before signalling an unowned pid —
reaping an orphan on load or killing a reattached job — the token is re-checked
and a mismatch is treated as gone (`unknown`) instead of a signal. Where the
platform cannot produce a token (Windows, or a gone process), the check
degrades to liveness.

**Reattached jobs are polled.** A reattached detached job has no child handle,
so its `close` event never fires. The repaint clock polls unowned running jobs
and transitions them to `unknown` when their pid disappears, so the widget,
chip, and `wait` stay honest.

**Pure logic split from IO.** `format.ts` and the reconciliation in
`registry.ts` are pure; `process.ts` and the runtime take injectable
spawn/liveness/kill/clock functions. Tests drive a scripted `FakeChild` and a
temp registry, so the whole suite runs without launching a process.

The runtime is composition, not a monolith: `store.ts` owns the durable
registry (directory, id counter, session deletions, atomic merge-write),
`logs.ts` reads bounded log tails, `ui.ts` owns the chip and widget, and
`waiters.ts` owns `wait` resolver bookkeeping. The live `Job` map stays in the
runtime because process events mutate it (status, `owned` handle, `lastLine`),
while the store holds only what survives a session.

### UI decisions

**Width-1 glyphs.** The status chip is `▸N`/`✗N`, with no space, because the
status bar compacts each status to its first whitespace token. `▸` and `✗` are
single-column text glyphs, unlike emoji-ambiguous symbols such as `⚙` that
would break footer alignment; `format.test.ts` asserts the width. When jobs run
*and* an unreported failure waits, the chip is the combined `▸N·✗N` — still one
whitespace-free token, so the compact form keeps both counts instead of dropping
the failure behind the running count (the widget is hidden while a dock screen
is open, and may be disabled, so the chip is then the only signal).

**Untrusted output is sanitized at every boundary.** Logs are arbitrary program
output: ANSI/OSC escapes, carriage-return progress rewrites, control characters.
`sanitizeLogLine` strips escapes, resolves `\r` to the trailing segment, and
collapses whitespace; it runs before text reaches the widget, the `/jobs` pane,
the model-facing `logs` result, and completion notes. The raw file is never
rewritten.

**The widget is stateless and one line.** Elapsed time is computed at render, so
the runtime only calls `tui.requestRender()` on a clock that runs (only in
`tui` mode, only while a job runs) and is cleared on shutdown. The widget is a
single header line (`Jobs · 2 running · 1 failed`) and auto-hides when there is
nothing running and no unreported failure. The latest output line is cached from
the stdout stream (throttled) for `status`/`wait`/completion notes and the
`/jobs` detail pane; the widget header never reads it, and nothing on the render
path touches the file — only the `/jobs` log pane reads a bounded tail, on a poll.

**The widget is the collapsed view of the screen.** It reuses the `todo`/`goal`
rails grammar (`Jobs · 2 running · 1 failed`) and stays mounted while a job runs
or an unreported failure waits, so a failure is not hidden between completion
and the next turn (matching the `✗N` chip and the report-at-next-turn model).

**The jobs rail is the bottom rail.** Pi re-inserts a widget on every set, so a
`goal` or `todo` update would otherwise sink those rails below this one.
`_shared/rails.ts` keeps the stack `Goal / Todos / Jobs`: `jobs` re-asserts
itself whenever an upper rail announces, and — being the bottom rail — never
announces. See [`_shared/rails.ts`](../_shared/rails.ts) and
[goal](../goal/DESIGN.md).

**A dock screen hides every rail.** Any `ctx.ui.custom` screen mounted in the
dock editor slot (`/todos`, `/jobs`, `/rewind`, `/plans`, or the
ask-user-question questionnaire) emits a suppression signal via
`withRailsSuppressed`; each rail hides for the screen's lifetime and re-syncs
on close. See [`_shared/rails.ts`](../_shared/rails.ts).

**The `/jobs` screen is the expanded view.** It shares `screenHeader` and
`viewportRows` with `rewind`/`plan-mode`, adds a `❯` selection marker, a
counts summary (`N jobs · R running · F failed`), running jobs first then recent
finished jobs, and a focused detail pane (command, cwd, outcome, elapsed, last
line). Destructive keys (`d`/`K` kill, `x` clear) ask for a `y`/`N`
confirmation first, matching `plan-mode`'s confirm-before-delete convention.
Selection is tracked by job id, and the open log pane pins its job id, so the
screen's live re-sort (running first) cannot move the cursor or switch the log
out from under the user. While it owns the editor the runtime suppresses the widget via
`setUiSuppressed`, so the collapsed and expanded lists are never shown at once;
the footer chip is untouched, so the running signal survives the detour.

**UI calls are guarded.** Every `ctx.ui.*` call is behind `ctx.mode === "tui"`
and wrapped, and a `disposed` flag makes late `close` callbacks no-ops, so a
job finishing after shutdown cannot touch a dead UI. In non-TUI modes the tool
and `/jobs` degrade to text.

## Model surface

| Field | Value |
|---|---|
| `name` | `job` |
| `action` | `start` \| `list` \| `status` \| `logs` \| `kill` \| `wait` \| `clear` |
| `exposure` | `direct` (default) |
| `executionMode` | `sequential` — calls share the in-memory job table |
| `annotations` | `readOnlyHint: false`, `destructiveHint: true` — plan mode blocks it |

## Result shape

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

## Known limitations

- **Concurrent sessions in the same project share a registry.** The on-disk
  registry is per project, not per session, and has no cross-process lock. A
  session is no longer assumed dead just because another session is starting:
  each session writes a heartbeat marker (`session-*.json`, refreshed while it
  has running jobs), reconciliation reaps a live non-detached job only when its
  owner marker is gone, and `persist` merges onto a fresh read so a peer's
  records are preserved instead of clobbered. A residual simultaneous
  read-modify-write race remains (two sessions writing at the exact same
  instant); a true fix needs per-session registry files or a lock file.
- **`unknown` has no exit code.** A job observed only after its process is gone
  cannot recover its exit status; the registry records the transition but not
  the code.

