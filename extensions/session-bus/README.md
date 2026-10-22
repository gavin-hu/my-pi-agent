# session-bus — coordinate parallel Pi sessions

A local coordination bus for Pi sessions on the same machine and repository.
Sessions discover each other, exchange short messages and events, consume an
inbox, and claim paths before editing. It is pull-based: no network service, no
automatic turn, and no hidden context injection.

```bash
pi --extension ./extensions/session-bus   # load just this extension
pi -e .                                   # load the whole package
```

## What it does

- Registers one `session` tool and the `/sessions` command.
- Stores one record per session, one file per message, and one file per claim
  under `<agent-dir>/session-bus/<repo-key>/`; the key is the repository’s common
  git directory, so worktrees meet on one bus.
- A TUI session joins on `session_start`; RPC, JSON, print, and WeChat peer
  sessions join only when the tool or `/sessions` is used. A subagent or a phone
  peer does not appear merely because the package is loaded.
- A heartbeat keeps a joined session visible; a stale session is pruned after ten
  minutes, its claims are released, and inbox messages expire after 24 hours.
- Writes are atomic and private to the OS user; there is no server, no network,
  and no cross-user authorization.

## Commands

| Command | Effect |
|---|---|
| `/sessions` | List active sessions, labels, working directories, unread counts, and claims; a non-TUI caller joins. |
| `/sessions name <label>` | Give this session a stable label, unique among active sessions. |
| `/sessions help` | Show the command usage. |

Labels are how another session addresses you. Use `frontend`, `backend`,
`tests`, or a branch name; duplicate labels get a short id suffix automatically.

## Tools

| Action | Inputs | Result |
|---|---|---|
| `status` | — | Active sessions with unread counts, claims, and this session’s identity. Prunes stale records. |
| `send` | `to`, `text`, optional `kind`, optional `paths` | Writes one message per recipient. `to: "*"` is only valid with `kind: "event"`. |
| `inbox` | optional `limit` | Returns and deletes up to `limit` messages, oldest first (default 20, max 50). |
| `claim` | `paths` | Claims repository-relative files or directory prefixes; returns conflicts with their owner. |
| `release` | `paths` | Removes claims owned by this session; reports paths owned by someone else. |

Message kinds are `message` (default), `event`, `ask`, and `handoff`. An `ask` is
still a message: it does not block or wait for a reply. Text is capped at 4,000
characters. Paths resolve against the caller’s working directory and are stored
relative to its repository root; a path outside the repository is refused.

A claim is all-or-nothing: if one path conflicts, nothing is claimed. A claim on
a directory conflicts with claims below it and above it, so `src/api` and
`src/api/routes.ts` cannot be held by different sessions. There is no `force`
takeover; wait for the owner, ask it to release, or let the session expire.

## Parallel workflow

1. The lead names the sessions and writes the contract (OpenAPI, schema, or
   types) before parallel work starts.
2. Each session claims its paths, then implements its side.
3. A contract, build, or test change goes out as an event:
   `session({action:"send", to:"*", kind:"event", text:"contract v2: ..."})`.
4. Other sessions consume `inbox` at their next checkpoint; messages are not
   pushed into a turn.
5. The lead merges the worktrees and runs the project’s full check.

The bus carries coordination, not authority. The plan, todo list, contract, and
git branch remain the source of truth.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| `tui` | Joins automatically on `session_start`. Inbox and claims are available to the model through the tool; `/sessions` lists them. |
| `rpc`, `json`, `print` | Does not join automatically. The first `session` call or `/sessions` joins; this is how a subagent or an RPC-driven session opts in. |
| WeChat peer | Same as `rpc`: the peer is a separate AgentSession in the bridge process and joins only on explicit use. Messages are read by that peer’s model; the bridge does not forward them to the phone. |

No screen is opened. `/sessions` prints a compact text listing in every mode.

## Configuration

None in v1. The heartbeat (10 s), session TTL (10 min), message TTL (24 h), text
cap, and inbox limit are constants in the extension. The bus lives under the
agent directory, not the project, so it is never committed.

## Limitations

- **Same machine, same OS user.** Any process with that user’s file access can
  read or write the bus; there is no authentication between sessions.
- **Pull-based.** A message does not wake a session or inject a turn. Agents must
  call `inbox` at coordination points.
- **No broadcast history.** A broadcast reaches the sessions active at send time;
  a session that joins later does not receive it.
- **No forced claims.** A crashed owner blocks its paths until the session TTL
  expires. This is deliberate; stealing a claim is worse than waiting.
- **Bounded by TTL.** An idle session with a stopped heartbeat is pruned after
  ten minutes; its record and claims disappear, and its unread mail expires after
  24 hours.
- **No network.** It is not a distributed bus and does not synchronize machines.

## Design notes

- **Common git dir as the key.** `git rev-parse --git-common-dir` gives all
  worktrees of one repository the same bus; `--show-toplevel` normalizes claim
  paths within each worktree. Non-repository sessions fall back to their cwd.
- **One file per item.** Sessions never append to a shared registry: each session
  writes its own record, each message is its own file, and a claim is an
  exclusive create. This avoids a cross-process lock for the common path.
- **Lazy join.** Loading a package extension must not make every subagent and
  WeChat peer a team member. Auto-join only in `tui`; every other mode opts in by
  using the tool or command.
- **Sanitized at the boundary.** Messages are model-authored and are sanitized
  before rendering, like other untrusted text in the transcript.

## Pi integration

| Point | Detail |
|---|---|
| Tools | `session` — one action-shaped tool; `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: false`, `executionMode: "sequential"`. |
| Commands | `/sessions`, `/sessions name <label>`, `/sessions help`. |
| Events | `session_start` resolves the repository and joins a TUI session; `session_shutdown` clears the heartbeat and removes the record. |
| State | Files under `<agent-dir>/session-bus/<repo-key>/`; nothing in the session branch. `/resume` re-registers the same session id. |
| Lifecycle | The factory only registers. The runtime starts on `session_start`; heartbeat and cleanup belong to it. Disabling `session-bus` through `PI_DISABLED_EXTENSIONS` registers nothing. |
| Mode | Uses `ctx.mode` only to choose auto-join; `askHuman` is not involved and no UI is drawn. |

## File map

| File | Responsibility |
|---|---|
| `index.ts` | Disable guard, registration, `session_start`/`session_shutdown` wiring. |
| `runtime.ts` | Lifecycle, repo key, lazy join, heartbeat, operations. |
| `store.ts` | Atomic JSON files, inbox, claims, pruning. |
| `protocol.ts` | Pure labels, targets, paths, validation, conflict rules. |
| `tools.ts` | The `session` tool and renderer. |
| `commands.ts` | `/sessions`. |
| `format.ts` | Model-facing listing and result text. |
