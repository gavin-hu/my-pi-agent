# check — cross-stack verification runs

Run the project's test, lint, or typecheck command from Pi, watch it live, and
turn its output into a navigable `file:line` list. The same run is available to
the model as `run_check`, with structured failures instead of a wall of log
text.

`check` is deliberately generic: it detects the project's command from its
manifest or takes `check.command`, and it does not assume Node, Bun, a test
framework, or a particular CI system.

```
pi --extension ./extensions/check   # load just this extension
pi -e .                             # load the whole @gavin-hu/my-pi-agent package
pi install ./                       # install the package
```

## Screens

<img src="../../assets/check.png" alt="The /check screen: a failed run with failure rows and the focused failure's message" width="100%">

<img src="../../assets/check-detail.png" alt="The /check failure detail: the location and message over a source excerpt with the failing line marked by >" width="100%">

## Tool rendering

How the `run_check` call and its result look in the transcript — the call line as a headline and the body indented under it:

<img src="../../assets/tools/run_check.png" alt="The run_check tool's result: a summary line and the first structured failures" width="100%">

## What it does

- **Detects a command** from `package.json`, `Cargo.toml`, `go.mod`, a pytest
  configuration, a `justfile`, or a `Makefile`, or uses `check.command`.
- **Runs it in a supervised process** with a wall-clock timeout and a bounded
  log; `Esc` cancels the process tree.
- **Shows a live tail** while the command runs, then a failure list with a
  detail view for the focused failure: a source excerpt around `path:line` when
  the file is readable, otherwise the bounded tail.
- **Returns structured failures** to the model with `path`, `line`, `column`,
  `test`, `message`, and `command`.
- **Falls back honestly**: a failed command with no recognizable failure becomes
  one “Command exited with status N” entry, with the bounded tail in its detail.
- **One line on success**: `Check passed: bun run check · 12.4s`.

## Tool

`run_check` takes optional `target`:

| Field | Value |
|---|---|
| `target` | `test`, `lint`, `typecheck`, or `all`; defaults to `all`. |
| `exposure` | `direct`, active by default. |
| `executionMode` | `sequential` — one run owns the process and the live buffer. |
| `annotations` | `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: false`. |
| `outputSchema` | `{ target, status, commands, exitCode, durationMs, truncated, failures[] }`, mirrored by `structuredContent`. |

`content` is a short summary plus up to 20 failures. `details` carries the full
bounded failure list and the tail. A failing check is a normal result
(`isError: false`) so the model can fix it; a check that cannot run — no
detected command, a spawn failure, or another run already active — is an error
with the corrective action.

## Command

| Command | What it does |
|---|---|
| `/check` | Run every detected command (or `check.command`). |
| `/check test` | Run the detected test command. |
| `/check lint` | Run the detected lint command. |
| `/check typecheck` | Run the detected typecheck command. |
| `/check all` | Same as `/check`. |

`getArgumentCompletions` offers the four targets. The command refuses while plan
mode is on: relying on tests is still writing to the project (caches, snapshots,
generated files), so the plan must be approved first.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| Interactive TUI | A live run screen with a scrolling tail and `Esc cancel`; then a failure list with `Enter` detail, `r` rerun, and `Esc` close. A pass posts one notice. |
| RPC (`hasUI`) | Runs headless and posts the summary plus the failure list; no custom screen. |
| `print` / `json` | Runs headless and posts the same report. |
| `run_check` | No UI. Returns the summary in `content` and the structured result. |

## Configuration

The `check` section of the shared `bytefly.json` (global then project, project
wins). All keys are JSON-only; none has a `/bytefly settings` row.

| Key | Default | Bounds | Meaning |
|---|---|---|---|
| `command` | `""` | | When non-empty, run this shell command for every target instead of detection. |
| `timeoutMs` | `600000` | `0`–`3600000` | Wall-clock limit per command; `0` disables it. |
| `maxLogBytes` | `1048576` | `65536`–`16777216` | Bytes of tail retained per command. |

`command` is the escape hatch for any stack without a detector. It is a shell
command and runs with the project root as its working directory.

## Detection

Detection order stops at the first family that declares a command:

| Manifest | `test` | `lint` | `typecheck` | `all` |
|---|---|---|---|---|
| `package.json` | `scripts.test` | `scripts.lint` | `scripts.typecheck` | `scripts.check`, else the detected targets |
| `Cargo.toml` | `cargo test` | `cargo clippy -- -D warnings` | `cargo check` | the detected targets |
| `go.mod` | `go test ./...` | `go vet ./...` | `go build ./...` | the detected targets |
| pytest config or `tests/` | `pytest` | `ruff check .` with `[tool.ruff]` | `mypy .` with `[tool.mypy]` | the detected targets |
| `justfile` | `just test` if declared | `just lint` if declared | `just typecheck` if declared | `just check` if declared, else the detected targets |
| `Makefile` | `make test` if declared | `make lint` if declared | — | `make check` if declared, else the detected targets |
| any other stack | — | — | — | `check.command` |

Node package managers come from the lockfile (`bun`, `pnpm`, `yarn`, `npm`;
default `npm`). Scripts run as `<pm> run <name>`; Make and Just recipes only by
their declared names. Nothing is guessed beyond those manifests.

A detector is one function returning `DetectedCommands`; adding a family is one
module entry, not a change to the runtime, screens, or tool.

## Failure parsing

Known runner lines are recognized first; the generic compiler-style location is
the fallback for everything else:

| Output shape | Parser |
|---|---|
| `path:line(:col): error …` | generic, including a Windows `C:\…` path |
| `FAIL path` and `● test` | Vitest/Jest |
| `● test` and `at … (path:line:col)` | Jest/Vitest, Java, and bare stack frames |
| `File "path", line N, in test` | Python tracebacks |
| `FAILED path::test - message` | pytest |
| `--- FAIL: Test` and `path:line:` | Go |
| `panicked at path:line` / `thread 'test'` | Cargo |
| anything else on a non-zero exit | one fallback entry with the bounded tail |

Failures are deduped and capped at 200; the model report shows 20. A miss is
never turned into an invented location.

## Security

`check` executes project scripts. That is the same trust boundary as running the
command yourself or letting the agent call `bash`: a project with a hostile
`test` script can do anything your user can do. The extension does not add a
sandbox. `/check` is user-invoked and refuses in plan mode; `run_check` declares
`readOnlyHint: false`, so a permission policy can gate it, and plan mode blocks
it.

The extension adds no network calls of its own. The command's environment is
made non-interactive (`CI=1`, `NO_COLOR=1`, `FORCE_COLOR=0`, `TERM=dumb`,
`GIT_PAGER=cat`, `PAGER=cat`).

## Limitations

- Detection covers the families above. Other stacks need `check.command`.
- Parsing is best-effort. A custom reporter that prints neither a location nor a
  known shape falls back to the tail, not to a guessed file.
- The failure list and detail are TUI-only; other modes print the report.
- A source excerpt is read only from a regular file inside the project root, at
  most 512 KiB, and only when the reported line exists. A missing, binary,
  oversized, or external file falls back to the bounded tail with the reason.
- There is no run history, retry policy, or watch mode. Each invocation is one
  run.
- A test runner that opens a full-screen UI is not supported: stdout is a pipe,
  stdin is closed, and `TERM=dumb`.
- The tail is bounded; earlier lines are dropped and marked truncated.

## Non-goals

- Auto-fixing or editing code in response to a failure.
- A remote CI client, a scheduler, or a durable run queue.
- Watching files and rerunning on change.
- Parsing every reporter in existence; the generic location and the bounded tail
  are the contract.
- Replacing `job` for long-lived processes.

## Pi integration

| Aspect | Contract |
|---|---|
| Registration | `check(pi)` guards on `isExtensionEnabled("check")` and calls `registerCheck(pi)`, which registers `run_check`, `/check`, and one `session_shutdown` hook. The factory only registers. |
| Tool | `run_check`, `exposure: "direct"`, `executionMode: "sequential"`, annotations `{ readOnlyHint: false, destructiveHint: false, openWorldHint: false }`, TypeBox `parameters` and `outputSchema`, `structuredContent` mirror. |
| Command | `/check [target]` with `getArgumentCompletions` for the four targets; reports through `ctx.ui.notify`. |
| State | None persisted. The runtime closure owns the single active child, its controller, and the live line buffer; `session_shutdown` aborts it. |
| Lifecycle | Each run spawns one process per command and kills the tree on timeout, cancel, or shutdown. No `session_start` work. |
| Config | `check` section of `bytefly.json`, read once per run. |

## Design notes

- **The excerpt is guarded like a path-taking tool.** The path comes from command
  output, so `source.ts` resolves it, requires both string and real-path
  containment under the project root, rejects non-files, binaries, and files over
  512 KiB, and checks the line before reading. A miss shows the tail, never a
  guessed source line.
- **Why `check`.** It runs the project's *check* command, matching `bun run check`
  and the scripts it detects. `/verify` describes a verdict rather than the
  action, and `run_verify` reads worse than `run_check`; the extension,
  command, tool, and config section all use one word.
- **Generic by design.** Only `detect.ts` knows manifests, and only `failures.ts`
  knows runner output. The runtime, screens, and tool speak in `CommandSpec` and
  `Failure`.
- **One-shot, not a job.** `job` owns reattachment, stdin, detached lifetime, and
  a registry; `check` owns a foreground verdict. Reusing `job` would make both
  surfaces worse, so the runner is local and smaller.
- **A bounded tail is the honest fallback.** A parser miss must not invent a
  location; the exit status and the tail are useful on their own.
- **One run at a time.** The runtime refuses a second start instead of
  interleaving outputs or processes.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Registrar: guard, runtime, tool, command, shutdown. |
| `types.ts` | `CheckTarget`, `CommandSpec`, `Failure`, `CheckResult`, `ActiveCheck`. |
| `config.ts` | `check` config defaults, clamps, and loader. |
| `detect.ts` | The detector registry and `check.command` planning. |
| `runner.ts` | One-shot streaming process, bounded log, timeout, cancel, tree kill. |
| `failures.ts` | Known-runner and generic failure parsers, stack frames, and the tail fallback. |
| `source.ts` | Guarded source excerpt around a failure's `path:line`. |
| `runtime.ts` | Planning, sequencing, aggregation, live lines, cancel/shutdown. |
| `format.ts` | Summary, failure rows, source-excerpt/detail text, model report. |
| `tui.ts` | `CheckRunComponent` and `CheckResultComponent`. |
| `tools.ts` | `run_check` schema and registration. |
| `commands.ts` | `/check`, target parsing, completions, TUI/headless flow. |

## Testing

Co-located tests cover config clamps, every detector family, the runner's
streaming/timeout/cancel/log cap, the parsers, command planning, aggregation,
the tool's output contract, the command's guards and headless path, and both
screens' keys and width bounds. `extensions/check/check.test.ts` runs a real
Node script through the extension, so the process path is exercised without
depending on Bun or a test framework.
