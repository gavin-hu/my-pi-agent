# guard — a permission/safety gate for Pi

Blocks writes to sensitive paths, blocks or confirms dangerous shell commands,
and confirms tools marked destructive — before they run.

```
pi --extension ./extensions/guard          # load just this extension
pi -e .                                     # load the whole @gavin-hu/my-pi-agent package
```

## What it does

One `tool_call` handler, three checks, in order:

1. **Protected paths.** `write`/`edit` targets matching a gitignore-style
   pattern (`.env`, `.git`, lockfiles, keys, `node_modules`, …) are blocked (or
   confirmed, if configured), whether given as relative or absolute paths.
2. **Dangerous commands.** `bash`/`powershell` command lines are analyzed
   segment by segment. Some are **blocked** outright (`rm -rf /`, `dd` to a
   device, `mkfs`, fork bombs); others are **confirmed** (`rm -rf <dir>`,
   `sudo`, `git push --force`, `git reset --hard`, pipe-to-shell, `npm publish`,
   `kubectl delete`, `terraform destroy`, …).
3. **Destructive annotations.** Any tool whose `annotations.destructiveHint` is
   true is confirmed, including MCP tools.

When a confirmation is needed and there is no UI (print/JSON modes), the call is
**blocked** by default: fail safe, not fail open.

```text
Guard — confirm
`rm -rf node_modules` matches a command pattern that needs confirmation.

Allow this call?
```

## Commands

| | |
|---|---|
| `/guard` | Show the current guard status |
| `/guard on` / `/guard off` | Toggle at runtime (edit `guard.json` to persist) |
| `/guard paths` | List the protected-path patterns |

## Configuration

Merged from `~/.pi/agent/guard.json` (global) and `<cwd>/.pi/guard.json`
(project; wins):

```jsonc
{
  "enabled": true,
  "protected": {
    "paths": [".env", ".env.*", "!.env.example", ".git", ".git/**", "**/node_modules/**",
              "**/.ssh/**", "**/.aws/**", "**/.gnupg/**", "**/*.pem", "**/*.key", "**/*.p12",
              "**/id_rsa", "**/id_ed25519", "bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    "action": "block"            // "block" | "confirm"
  },
  "commands": {
    "includeBuiltins": true,     // false = only your own patterns below
    "block": [],                 // extra regex sources (case-insensitive)
    "confirm": [],
    "allow": []                  // a match short-circuits to allow
  },
  "annotations": {
    "confirmDestructive": true,  // confirm destructiveHint === true
    "confirmMissingHints": false // broad: also confirm no-hint, non-read-only tools
  },
  "nonInteractive": "block",     // a confirm with no UI: "block" | "allow"
  "rememberConfirmations": true, // approve once per session per command/path
  "confirmTimeoutMs": 120000     // 0 = never auto-dismiss
}
```

`protected.paths` uses gitignore syntax (`*`, `?`, `**`, `[...]`, `!`), matched
against the path relative to the working directory; the last matching pattern
wins, so `!` re-allows. An empty `paths` array disables path protection.

## Interaction with the rest of the package

The extension is listed **last** in the manifest. `tool_call` returns on the
first `block`, and handlers run in load order, so:

- **`worktree`** refuses paths that escape the active worktree first; guard only
  sees calls that survive, and resolves protected paths against the active root.
- **`plan-mode`** removes `write`/`edit` from the active set and blocks
  non-read-only `bash` first, so guard never double-prompts a call plan mode
  already refuses.

Guard has no tools and needs no session state; it is safe in every mode
(interactive, RPC, print, JSON).

## How it works

| File | Responsibility |
|---|---|
| `index.ts` | Extension factory: config cache, `/guard`, `tool_call` wiring |
| `config.ts` | `GuardConfig` defaults, validation/clamping, global+project merge |
| `paths.ts` | gitignore-style glob matcher and protected-path decision |
| `commands.ts` | command splitting and the danger analyzer |
| `policy.ts` | `assessToolCall`: precedence of the three checks |
| `types.ts` | `GuardVerdict` |

The decision logic is pure; `index.ts` only renders it as UI and a
`{ block: true }` result.

## Testing

```bash
bun test test/guard
bun run check
```

`test/guard/` covers the glob matcher and protected-path decisions, the command
analyzer (safe/confirm/block, config overrides), the policy precedence, and the
extension lifecycle (block, confirm yes/no, no-UI, per-session memory,
`/guard` toggle).

## Limitations

- This is a guard rail, not an OS sandbox: command substitution and `sh -c` are
  not analyzed, and an extension shares Pi's OS permissions.
- It guards the model's tools, not a shell command the user runs directly (`!`
  in the TUI).
- Project config is looked up in the working directory, so under an active
  worktree an uncopied `.pi/guard.json` is not found (the global file still
  applies).
- Confirmation memory lasts one session and is not restored on `/resume`.
