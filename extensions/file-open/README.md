# file-open — open files and directories in the OS-native app

`file-open` opens a file or directory in the operating system's default
handler, or reveals it in the file manager. `/open` does it interactively and
the `open_path` tool does it from a script, both resolving the path against the
effective working directory.

## Tool rendering

How the `open_path` call and its result look in the transcript — the shared rail around the tool's own renderer:

<img src="../../assets/tools/open_path.png" alt="The open_path tool's call and result, drawn by the generic fallback rail" width="100%">

## Quickstart

```bash
pi --extension ./extensions/file-open       # this extension only
pi -e .                                     # the package from this checkout
pi install ./                               # install the package for a user
```

```text
/open              open the working directory in the default app
/open src/app.ts   open a file in its default app
/open -r src       reveal src in the file manager
```

## What it does

- Opens a file or directory with the OS-native application: `open` on macOS,
  `cmd /c start` on Windows, `xdg-open` on Linux.
- Reveals it in the file manager instead with `-r` (or `reveal: true`): `open -R`
  on macOS, `explorer /select,` on Windows, and the containing directory on
  Linux, which has no "select" verb.
- Unwraps the editor's `@` file-mention prefix and surrounding quotes, so
  `/open @src/app.ts` and `/open @"my file.txt"` both work.
- Resolves relative paths against the effective working directory, so under the
  `worktree` extension `/open .` opens the isolated worktree.
- Launches the handler detached, so it outlives the Pi session.

## Commands and flags

```bash
/open [path]      open a path (default: the working directory) in its default app
/open -r [path]   reveal the path in the file manager instead
```

The `-r` flag must come first. A missing path is reported through a notification
and nothing is launched. An empty argument means the working directory. The
command needs an interactive terminal UI.

## Tool

`open_path` — `exposure: "codemode"`, inactive by default, not read-only,
open-world (`openWorldHint: true` because it starts an OS process). It is
listed by the `codemode` tool and reachable through `ctx.executeTool`; it is not
declared to the model unless activated.

| Parameter | Type | Meaning |
|---|---|---|
| `path` | string, required, 1–4096 chars | Path to open, relative to the working directory or absolute (a leading `@` is ignored). |
| `reveal` | boolean | Reveal in the file manager instead of opening. Defaults to `false`. |

Result (`details` / `structuredContent`):

| Field | Meaning |
|---|---|
| `target` | The absolute path that was handled. |
| `reveal` | Whether it was revealed rather than opened. |

The model-facing `content` is `Opened <target>` or `Revealed <target>`. A path
that does not exist is thrown as an error naming the resolved path; a launch
failure is reported through `ctx.ui.notify` because the handler runs detached,
and the tool result still names the target.

## Behaviour by mode

The tool has no widgets or status output and behaves identically in `tui`, RPC,
JSON, and print modes; a codemode script can call it in any of them. Only the
`/open` command's notification needs an interactive UI.

## Security

- **It starts an OS process for a path the model names.** Whatever application
  is registered for the target's type is launched with the user's privileges. A
  file whose default handler is executable (`.app` on macOS, `.exe` on Windows,
  `.desktop` on Linux) can run code. The tool is `codemode`-exposed rather than
  active by default for this reason, and its annotations let a permission
  extension confirm the call.
- **No shell.** The handler receives the target as a `spawn` argument, never
  through a shell, so the path is not re-parsed.
- **Control characters are stripped** from the target before it reaches the
  process arguments or the notification.
- **Not confined.** Unlike `read_doc`, the tool opens any path on the machine:
  confinement would defeat its purpose of showing the user a file wherever it
  lives. Relative paths resolve against the effective worktree root.
- **Best-effort launch.** A missing handler or a refused launch is reported, not
  retried.

## Limitations

- Reveal has no native meaning on Linux, so it opens the containing directory.
- A launch that the OS accepts but the user never sees (a backgrounded app, a
  hidden window) is not detected: `spawn` reports only that the process started.
- `-r` is parsed only as the first token of `/open`, so a path that genuinely
  starts with `-r ` cannot be opened by the command. Use the `open_path` tool
  with the full path instead.

## Pi integration

| Aspect | Contract |
|---|---|
| Registration | `fileOpen(pi)` in `index.ts` registers `open_path` and the `/open` command. The factory only registers. |
| Tool | `open_path`, `exposure: "codemode"` (inactive by default), default (`parallel`) execution, `annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }`, TypeBox `parameters` and `outputSchema`. No custom renderer. |
| Command | `/open [path]` and `/open -r [path]`; reports through `ctx.ui.notify`. |
| State | None persisted, and none needed: every call is independent. |
| Lifecycle | No `session_start` / `session_shutdown` hooks; the factory holds no long-lived resources. |
| Host seams | `resolveEffectiveCwd` and `isExtensionEnabled` (`lib/env.ts`), `stripControlChars` (`lib/format.ts`), `spawn` / `open` / `xdg-open` / `cmd` / `explorer` (via the injected launcher in `open.ts`). |
| Config | None. |

## Design notes

`buildCommand` and `normalizeTarget` are pure and `openTarget` takes an injected
launcher, so the command for each platform is asserted without a process and a
test launches nothing. The launch is best-effort: `spawn` reports a missing
handler asynchronously, so the failure goes to `onError` (and a notification)
rather than being thrown from a synchronous call the tool could catch.

The tool is `codemode`-exposed, matching how it was configured before the move:
opening a native app is a side effect the user should trigger, so it stays out
of the model's active tool set unless a script explicitly reaches for it.

## Files

| Module | Responsibility |
|---|---|
| `index.ts` | The extension factory: registers `open_path` and the `/open` command, resolves the target, and routes a launch failure to `ctx.ui.notify`. |
| `open.ts` | `normalizeTarget` and `buildCommand` (pure), `resolveTarget` (existence check), and `openTarget` with the injectable launcher. |
| `schema.ts` | `TOOL_NAME`, the TypeBox `parameters` / `outputSchema`, and the `OpenPathArgs` / `OpenPathResult` types. |
| `open.test.ts` | Pure-module tests for normalization, resolution, per-platform commands, and the launcher seam. |
| `extension.test.ts` | Extension-surface tests: registration, disabling, the tool call, and the command. |
