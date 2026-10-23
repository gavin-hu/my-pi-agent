# session-bus — coordinate parallel Pi sessions

A local coordination bus for Pi sessions on the same machine and repository.
Sessions discover each other, exchange short messages and events, consume an
inbox, and claim paths before editing. Delivery is pull-based, and a session can
arm an inbox watch to be told about new mail: a report at its next turn, or —
with `wake` — one raised turn. No network service, and no hidden context.

<img src="../../assets/session.png" alt="The /sessions screen: a counts summary, session rows with unread and claim counts, and the focused session's cwd, claims, and identity" width="100%">

```bash
pi --extension ./extensions/session-bus   # load just this extension
pi -e .                                   # load the whole package
```

## What it does

- Registers one `session` tool and the `/sessions` command; in the TUI the command
  opens a live board with Sessions, Inbox, and Claims scopes.
- Stores one record per session, one file per message, and one file per claim
  under `<agent-dir>/session-bus/<repo-key>/`; the key is the repository’s common
  git directory, so worktrees meet on one bus.
- A TUI session joins on `session_start`; RPC, JSON, print, and WeChat peer
  sessions join only when the tool or `/sessions` is used. A subagent or a phone
  peer does not appear merely because the package is loaded.
- A heartbeat keeps a joined session visible; a stale session is pruned after ten
  minutes, its claims are released, and inbox messages expire after 24 hours.
- An armed inbox watch polls this session’s own inbox directory and queues what
  arrived. It announces; `inbox` still consumes.
- Writes are atomic and private to the OS user; there is no server, no network,
  and no cross-user authorization.

## Commands

| Command | Effect |
|---|---|
| `/sessions` | Open the board: `Tab` cycles Sessions, Inbox, and Claims. `Enter` opens the focused row, `w` arms or disarms this session's inbox watch, and in Claims `x` releases a claim you hold after a y/N confirmation. A non-TUI caller prints the listing and joins. |
| `/sessions name <label>` | Name this session for the bus and for Pi. The label is unique among active sessions, and it becomes the session name the footer shows and `/resume` lists. |
| `/sessions watch` | Report new mail at this session’s next turn. |
| `/sessions watch wake` | Report new mail, and raise one turn when it arrives while idle. |
| `/sessions watch off` | Stop the inbox watch. |
| `/sessions help` | Show the command usage. |

Labels are how another session addresses you. Name one by the outcome it owns
(`billing-core`, `integrator`, `verify-billing`), not by a layer or a role;
duplicate labels get a short id suffix automatically.

Naming also sets Pi's session name, so the footer's `[label]` and `/resume` agree
with the bus. Because the bus derives a joining session's label from that name, a
named session comes back under the same label after a resume.

## Tools

| Action | Inputs | Result |
|---|---|---|
| `status` | — | Active sessions with unread counts, claims, and this session’s identity. Prunes stale records. |
| `send` | `to`, `text`, optional `kind`, optional `paths` | Writes one message per recipient. `to: "*"` is only valid with `kind: "event"`. |
| `inbox` | optional `limit` | Returns and deletes up to `limit` messages, oldest first (default 20, max 50). |
| `claim` | `paths` | Claims repository-relative files or directory prefixes; returns conflicts with their owner. |
| `release` | `paths` | Removes claims owned by this session; reports paths owned by someone else. |
| `watch` | optional `wake`, optional `stop` | Arms this session’s inbox watch, or turns it off with `stop`. `wake` also raises one turn per burst. |

Message kinds are `message` (default), `event`, `ask`, and `handoff`. An `ask` is
still a message: it does not block or wait for a reply. Text is capped at 4,000
characters. Paths resolve against the caller’s working directory and are stored
relative to its repository root; a path outside the repository is refused.

A claim is all-or-nothing: if one path conflicts, nothing is claimed. A claim on
a directory conflicts with claims below it and above it, so `src/api` and
`src/api/routes.ts` cannot be held by different sessions. There is no `force`
takeover; wait for the owner, ask it to release, or let the session expire.

Arming is a state, not a mode switch: arming an armed session keeps its setting,
so changing `wake` means `watch` with `stop` and then arming again. Nothing arms
on `session_start`; a session that never asks stays pull-only.

## Parallel workflow

1. The user names each session (`/sessions name`), and the contract (OpenAPI,
   schema, or types) is written before parallel work starts.
2. Each session claims its paths, then implements its side.
3. A contract, build, or test change goes out as an event:
   `session({action:"send", to:"*", kind:"event", text:"contract v2: ..."})`.
4. Other sessions consume `inbox` at the start of their next turn, or arm
   `session({action:"watch", wake:true})` so a message raises their turn; nothing
   is pushed into a turn that is already running.
5. The lead merges the worktrees and runs the project’s full check.

The bus carries coordination, not authority. The plan, todo list, contract, and
git branch remain the source of truth.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| `tui` | Joins automatically on `session_start`. `/sessions` opens the board: sessions, this session's unread mail, and every claim, with `Tab` between them. |
| `rpc`, `json`, `print` | Does not join automatically. The first `session` call or `/sessions` joins; this is how a subagent or an RPC-driven session opts in. |
| WeChat peer | Same as `rpc`: the peer is a separate AgentSession in the bridge process and joins only on explicit use. Messages are read by that peer’s model; the bridge does not forward them to the phone. |

Every mode can arm the inbox watch; the notice is a visible transcript message, so
a `wake` raises that session’s own turn, not a phone notification.

The TUI opens the board; RPC, JSON, and print print the compact listing. The board
changes only this session's own state: `w` toggles its watch and `x` releases a
claim it holds. Mail is previewed, not consumed — `session inbox` consumes it —
and no view shows another session's inbox or releases its claims.

## Configuration

None in v1. The heartbeat (10 s), watch poll (2 s), session TTL (10 min), message
TTL (24 h), text cap, inbox limit, and preview cap are constants in the extension.
The bus lives under the agent directory, not the project, so it is never committed.

## Limitations

- **Same machine, same OS user.** Any process with that user’s file access can
  read or write the bus; there is no authentication between sessions.
- **Pull-based by default.** A message does not wake a session that did not arm
  its inbox watch. Agents must call `inbox` at coordination points.
- **Arming is per session and session-only.** It survives neither a resume nor a
  new process; unread mail is previewed once more after `/resume`.
- **The board acts on your own state only.** `w` arms or disarms this session's
  inbox watch and `x` releases a claim it holds. Mail is a preview, not a consume:
  the board never deletes a message, never marks one reported, and never touches a
  peer's inbox or claim.
- **Two armed peers can ping-pong.** Each reply wakes the other while both are
  idle. A wake raises one turn per burst, and `inbox` consumes, so the loop needs
  both sides to keep replying; the answer is to disarm one of them.
- **No broadcast history.** A broadcast reaches the sessions active at send time;
  a session that joins later does not receive it.
- **No forced claims.** A crashed owner blocks its paths until the session TTL
  expires. This is deliberate; stealing a claim is worse than waiting.
- **Bounded by TTL.** An idle session with a stopped heartbeat is pruned after
  ten minutes; its record, its claims, and an inbox directory left empty go with
  it, and its unread mail expires after 24 hours.
- **A message file that does not parse is dropped.** The board's read never
  consumes mail, but it does delete a file it cannot validate, so a truncated
  message cannot linger on the bus.
- **No network.** It is not a distributed bus and does not synchronize machines.

## Design notes

- **Common git dir as the key.** `git rev-parse --git-common-dir` gives all
  worktrees of one repository the same bus; `--show-toplevel` normalizes claim
  paths within each worktree. Non-repository sessions fall back to their cwd.
- **One path, one claim.** The cwd is canonicalized at join and every claim or
  release is re-keyed by its real target, so a working directory reached through
  a symlink still resolves inside its own repository, a link inside the repository
  and the file it names are the same claim, and a link that leaves the repository
  is refused. The automatic label is the real basename of the cwd, so a session
  started through a link named differently is named after the directory it is
  actually in. An absolute path argument that sits outside the repository is
  refused before it is re-keyed, and a relative one whose target leaves the
  repository is refused by the re-keying itself.
- **One file per item.** Sessions never append to a shared registry: each session
  writes its own record, each message is its own file, and a claim is a temp file
  hard-linked into place — an exclusive create no reader can see half-written.
  This avoids a cross-process lock for the common path.
- **Lazy join.** Loading a package extension must not make every subagent and
  WeChat peer a team member. Auto-join only in `tui`; every other mode opts in by
  using the tool or command.
- **Sanitized at the boundary.** Messages are model-authored and are sanitized
  before rendering, like other untrusted text in the transcript.
- **Poll, not `fs.watch`.** The inbox watch reads this session's inbox directory
  with one `readdir` every 2 s, the same trade `watch` makes for a file tail, so
  it does not depend on a platform's event API or a filename in the event. Only
  an armed session polls.
- **Read the board, prune on the next call.** The open board polls a read-only
  `snapshot()` and `peek()` that hide a session past the TTL, a claim held by one,
  and consume nothing. The physical prune, and the claim release that goes with
  it, happen on the next `status` or `claim` call — which is the call that reader
  is about to make.
- **Release by the stored path.** A claim is stored relative to the repo root of
  the session that took it, so releasing one resolves nothing: re-resolving it
  against a cwd below that root would target `src/src/api`. The screen refuses a
  peer's claim before asking the store, which checks the owner again.
- **A pane is a log or prose.** `DetailContents.text` wraps at the render width
  and `tail: false` opens it at the top, so a message reads as prose while a job
  log keeps following its tail.
- **The notice reuses the shared report channel.** `lib/report.ts` already owns
  whether an outcome may raise a turn; the bus supplies the pending mail and the
  text, and bytefly renders the notice like a `job` or `watch` one.

## Pi integration

| Point | Detail |
|---|---|
| Tools | `session` — one action-shaped tool; `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: false`, `executionMode: "sequential"`. |
| Commands | `/sessions` (board in `tui`, listing elsewhere), `/sessions name <label>`, `/sessions watch [off\|wake]`, `/sessions help`. |
| UI | `tui` mounts `SessionListComponent` through `withPolledScreen` (rails suppressed, a 1 s read-only poll of `snapshot()` + `peek()`); every other mode prints through `ctx.ui.notify`. No status chip, so the watch never changes the footer. |
| Events | `session_start` resolves the repository and joins a TUI session and arms the mail trigger; `before_agent_start` reports queued mail at the next turn; `context` prunes stale notices; `session_shutdown` clears the heartbeat, the watch ticker, and the record. The seven hooks are `lib/report.ts`'s `registerPendingChannel`, not a local copy. |
| State | Files under `<agent-dir>/session-bus/<repo-key>/`; nothing in the session branch. The armed watch is session-only. `/resume` re-registers the same session id. |
| Lifecycle | The factory only registers. The runtime starts on `session_start`; heartbeat, watch ticker, and cleanup belong to it. Disabling `session-bus` through `PI_DISABLED_EXTENSIONS` registers nothing. |
| Mode | Uses `ctx.mode` to decide auto-join and whether `/sessions` mounts the board; `askHuman` is not involved and no status chip is published. |

## File map

| File | Responsibility |
|---|---|
| `index.ts` | Disable guard, registration, the pending-report channel, and the session hooks. |
| `runtime.ts` | Lifecycle, repo key, lazy join, heartbeat, inbox watch and its poll, operations. |
| `store.ts` | Atomic JSON files, inbox, peek, claims, pruning. |
| `protocol.ts` | Pure labels, targets, paths, validation, conflict rules. |
| `tui.ts` | The `/sessions` board, its scopes, and the pane over one row; the row grammar is in `rows.ts`. |
| `rows.ts` | The session/claim/message row builders and summaries shared by the board and the transcript. |
| `result.ts` | The `session` tool's expanded result block and its collapsed line. |
| `notice.ts` | The mail notice's model text and renderer details. |
| `tools.ts` | The `session` tool and its renderer. |
| `commands.ts` | `/sessions`. |
| `format.ts` | Model-facing listing and result text. |
