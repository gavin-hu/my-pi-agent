# keep-awake — hold the machine awake while Pi works

`keep-awake` holds a transient OS inhibitor so a long agent run is not cut short
by system sleep or the display turning off. The configured mode decides when it
engages, `/keep-awake` overrides it for the session, and a `✦` status chip shows
while an inhibitor is held. Other extensions can also hold the machine awake
over the shared event bus — the WeChat bridge does this while it polls — without
importing this one, so `keep-awake` stays a self-contained extension.

```bash
pi --extension ./extensions/keep-awake   # load just this extension
pi -e .                                  # load the whole @gavin-hu/my-pi-agent package
pi install ./                            # install the package
```

## What it does

- Holds the platform inhibitor while Pi needs it: `caffeinate` on macOS,
  `systemd-inhibit` on Linux, and `SetThreadExecutionState` on Windows.
- `auto` (the default) engages only between `agent_start` and `agent_settled`, so
  the machine can sleep normally while Pi waits for you.
- `always` keeps the machine awake for the whole session, from `session_start` to
  `session_shutdown`.
- Honours wake holds announced by other extensions on `pi.events` (through
  `lib/wake-hold.ts`), so a polling bridge can keep the host reachable without
  importing this extension; `/keep-awake off` still wins.
- Releases the inhibitor and clears the chip on shutdown; teardown is
  idempotent and each command also self-terminates when Pi exits.
- Records why it could not start (an unsupported platform, a missing binary,
  or an inhibitor that exits on its own) and stays inert instead of failing the
  session or retrying.

## Commands

| Command | Effect |
|---|---|
| `/keep-awake on` | Force the inhibitor on for the rest of the session. |
| `/keep-awake off` | Never hold an inhibitor for the rest of the session. |
| `/keep-awake auto` | Clear the override and follow the configured mode. |
| `/keep-awake` or `/keep-awake status` | Report the current state, mode, holders, and platform support. |

While an inhibitor is held, a `✦ <label>` chip appears in the footer, where the
label is `on`, `auto`, `always`, or `hold` when an external hold is the reason.

## Behaviour by mode

The extension is active in every mode; the chip is only visible in interactive
(`tui`) sessions. In RPC, JSON, and print modes the inhibitor still engages and
releases, but `setStatus` is a no-op.

## Configuration

Read from `~/.pi/agent/keep-awake.json` and `<session-cwd>/.pi/keep-awake.json`;
project values override global ones, and missing or malformed files are ignored.
The effective config is loaded at `session_start` from the session's working
directory, so a project file and a re-rooted worktree are honoured.

```json
{
  "mode": "auto",
  "keepDisplay": false
}
```

| Key | Default | Meaning |
|---|---|---|
| `mode` | `"auto"` | `"auto"` engages only while the agent runs; `"always"` for the whole session. |
| `keepDisplay` | `false` | `true` also prevents display sleep/blanking, not just system sleep. |

## Limitations

- Platform support is best-effort. macOS uses `caffeinate` and Linux expects
  `systemd-inhibit` (so a non-systemd Linux host reports unavailable);
  `/keep-awake status` names the reason.
- The extension only controls the inhibitor it holds. It does not read the OS
  power state, and the chip reflects only what the extension itself is holding.
- A hard `kill -9` of Pi on Linux could briefly orphan the `sh` loop; the loop
  notices the missing Pi process within a few seconds and exits.

## Pi integration

| Contract | Detail |
|---|---|
| Registration | The default export registers one command and four event handlers; no tools. |
| Events | `pi.on("session_start" / "agent_start" / "agent_settled" / "session_shutdown")` drive the state machine. |
| Wake holds | `onWakeHoldChange` (`lib/wake-hold.ts`) subscribes on `pi.events`; a hold forces a wake in `auto` while the agent is idle. The runtime owns the owner set and clears it on `session_start` and `session_shutdown`. |
| Status chip | `ctx.ui.setStatus(STATUS_KEYS.keepAwake, …)`, cleared with `undefined`; `lib/ui.ts` owns the key and the `✦` glyph. |
| State | Session-scoped in memory; nothing is appended to the session and nothing is reconstructed on resume. |
| Config | `loadConfig(cwd)` through `lib/config.ts` at `session_start` (from the session cwd); `KeepAwakeDeps.config` injects a fixed config in tests. |
| Process seam | `extensions/keep-awake/process.ts` injects `spawn` / `killTree`, so tests never launch a real inhibitor. |
| Modes | Active in `tui`, RPC, JSON, and print; the chip is interactive-only. |

## Design notes

- **Reconcile, do not toggle.** `desired()` combines session-active,
  agent-running, mode, and override; every transition calls one idempotent
  `reconcile`, so a missed or duplicated event cannot leave an inhibitor
  running.
- **`auto` is the default.** Pi sessions often sit idle while the user reads or
  steps away; holding the machine awake for the whole session is the surprising
  choice, so it is opt-in through `mode: "always"`.
- **Self-terminating commands.** Every command watches the Pi pid (`caffeinate
  -w`, the Linux `kill -0` loop, the PowerShell `Get-Process` loop), so a hard
  crash does not leave the machine pinned awake, even before `session_shutdown`
  runs.
- **The chip follows the process, not intent.** The runtime observes the
  child's `error`/`close` events, so a binary that never starts or an inhibitor
  that dies on its own clears the chip and is reported instead of leaving a
  stale `✦` (and is not respawned, to avoid a retry loop).
- **Holds are just another reason to hold, not a second runtime.** An external
  owner announces `{ owner, held }` on the bus and `keep-awake` keeps a `Set` of
  live owners; `desired()` treats a non-empty set like `always`. Duplicate
  requests are idempotent, one owner's release cannot clear another's, and
  `/keep-awake off` still wins because an explicit command outranks a passive
  hold. The owner id is never trusted for more than attribution.
- **Pure command builders.** `inhibitor.ts` turns a platform and two options
  into a command string with no side effects, so every platform path — including
  Windows' UTF-16LE `-EncodedCommand` — is unit-tested without a process.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: env guard, config load, runtime construction, event wiring. |
| `types.ts` | `KeepAwakeMode`, `KeepAwakeOverride`, `KeepAwakeConfig`, `KeepAwakeStatus`. |
| `config.ts` | `DEFAULT_CONFIG`, `normalizeConfig`, `loadConfig`. |
| `inhibitor.ts` | Pure per-platform command builders. |
| `process.ts` | `SpawnedProcess`, `SpawnFn`, `KillTreeFn`, `defaultSpawn`, `defaultKillTree`. |
| `runtime.ts` | State machine, acquire/release, status chip. |
| `commands.ts` | The `/keep-awake` command. |
| `format.ts` | Pure chip label and notice text. |
