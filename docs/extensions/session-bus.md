# session-bus — coordinate parallel Pi sessions

A local coordination bus for Pi sessions on the same machine and repository:
sessions discover each other, exchange short messages and events, consume an
inbox, and claim paths before editing. A session joins by naming itself, so the
board opens empty and a peer never appears because the package loaded. Delivery is pull-based, and a session can
arm an inbox watch to be told about new mail — a report at its next turn, or,
with `wake`, one raised turn as soon as the agent is idle, including right after
a running turn settles. There is no network service and no hidden context.

<img src="../../assets/screens/session.png" alt="The /sessions screen: a counts summary, session rows with unread and claim counts, and the focused session's cwd, claims, and identity" width="100%">

## Capabilities

Status records what a reader can rely on: **Shipped** is in a tagged release, **Unreleased** is complete in the current tree but not yet tagged, and **Partial** has one released part and one unreleased part. Rows are ordered by user value, highest first.

| Capability | How | What you get | Status |
|---|---|---|---|
| Session naming | `session name`, `/sessions name <label>` | The join, and a stable label peers address — also the name Pi's footer and `/resume` show. | Shipped |
| Peer discovery | `session status` | Every active session with its unread count and claims, plus this session's identity, in one read. | Shipped |
| Live board | `/sessions` | Sessions, this session's unread mail, and every claim held on the repository, on one screen. | Shipped |
| Board actions | `/sessions` (`w`, `x`) | Arm or disarm the inbox watch, or release an own claim behind a confirmation, without leaving the board. | Shipped |
| Short messages | `session send` | One message per recipient, addressed by label or id, with a broadcast for events. | Shipped |
| Message kinds | `session send` with `kind` | A `message`, `event`, `ask`, or `handoff` keeps its meaning; `ask` does not block the sender. | Shipped |
| Message paths | `session send` with `paths` | A message can name the repository paths it concerns, echoed in the inbox row. | Shipped |
| Inbox on demand | `session inbox` | Up to `limit` messages, oldest first, consumed only when the model asks. | Shipped |
| Inbox watch | `session watch`, `/sessions watch [off\|wake]` | New mail reported at the next turn, or one raised turn once the agent is idle. | Shipped |
| Path claims | `session claim`, `session release` | A file or directory prefix held by one session at a time. | Shipped |
| Usage help | `/sessions help` | The command's usage lines, printed in the transcript. | Shipped |

## Quickstart

```bash
pi --extension ./extensions/session-bus   # load just this extension
pi -e .                                   # load the whole package
pi install ./                             # install the package for a user
```

```text
/sessions                                  # open the board: empty until this session joins
/sessions name billing-core                # join the bus, and name this session for Pi
```

Nothing joins on `session_start`, in any mode: the board and `status` only read, so
a fresh session sees an empty board and a peer's session is not listed until it
names itself. Naming is the join; so is the first action that needs you to be
addressable — `send`, `claim`, `release`, `watch`, or `name`.

## Tool

`session` — `exposure: "direct"` (the default), `executionMode: "sequential"`,
read-write and closed-world. One action-shaped tool keeps the prompt surface
small: each action takes only the parameters it needs, and the result is one
collapsed line that expands to the board's rows.

| Action | Inputs | Result |
|---|---|---|
| `status` | — | Active sessions with unread counts, claims, and this session's identity. Prunes stale records. A read: it never adds this session to the bus. |
| `send` | `to`, `text`, optional `kind`, optional `paths` | Writes one message per recipient. `to: "*"` is only valid with `kind: "event"`. |
| `inbox` | optional `limit` | Returns and deletes up to `limit` messages, oldest first (default 20, max 50). |
| `claim` | `paths` | Claims repository-relative files or directory prefixes; returns conflicts with their owner. |
| `release` | `paths` | Removes claims owned by this session; reports paths owned by someone else. |
| `watch` | optional `wake`, optional `stop` | Arms this session's inbox watch, or turns it off with `stop`. `wake: true` raises one turn per burst once the agent is idle; `wake: false` reports at the next turn; omitting it keeps an armed watch's mode. |
| `name` | `label` | Joins the bus, and renames this session on it and in Pi — the same path as `/sessions name`, with the same uniqueness rule, so the footer and `/resume` agree with the record peers address. An empty label is refused rather than keeping the old one, and a label a live session holds is refused with its owner named. The result reports the label the bus settled on. |

A claim is all-or-nothing: if one path conflicts, nothing is claimed. A claim on
a directory conflicts with claims below it and above it, so `src/api` and
`src/api/routes.ts` cannot be held by different sessions. There is no `force`
takeover; wait for the owner, ask it to release, or let the session expire.

Paths resolve against the caller's working directory and are stored relative to
its repository root; a path outside the repository is refused.

`wake` is the mode, not an arm-time switch: `/sessions watch wake` raises a turn
for a watch that was reporting at the next turn, and `/sessions watch` — or
`wake: false` — sets it back. The board's `w` only arms and disarms, and it arms
a plain watch; set `wake` with the command or the tool. Nothing arms on
`session_start`; a session that never asks stays pull-only.

## Commands

`/sessions` is the human surface: in `tui` mode it opens the live board described
in [the board](#the-sessions-board), and every other mode prints the compact
listing. The sub-commands name this session and manage its inbox watch.

| Command | Effect |
|---|---|
| `/sessions` | Open the board: `Tab` cycles Sessions, Inbox, and Claims. `Enter` opens the focused row, `w` arms or disarms this session's inbox watch, and in Claims `x` releases a claim you hold after a y/N confirmation. A non-TUI caller prints the listing. Neither joins the bus. |
| `/sessions name <label>` | Name this session for the bus and for Pi. The label is unique among active sessions, and it becomes the session name the footer shows and `/resume` lists. |
| `/sessions watch` | Report new mail at this session's next turn. |
| `/sessions watch wake` | Report new mail, and raise one turn as soon as the agent is idle — including right after a running turn settles. |
| `/sessions watch off` | Stop the inbox watch. |
| `/sessions help` | Show the command usage. |

Labels are how another session addresses you. Name one by the outcome it owns
(`billing-core`, `integrator`, `verify-billing`), not by a layer or a role;
duplicate labels get a short id suffix automatically.

Naming also sets Pi's session name, so the footer's `[label]` and `/resume` agree
with the bus. Because the bus derives a joining session's label from that name, a
named session comes back under the same label after a resume.

The tool's `name` action is the same rename from the model's side, so a session
can name itself without the user typing `/sessions name` for it.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| `tui` | Does not join on start. `/sessions` opens the board: sessions, this session's unread mail, and every claim, with `Tab` between them, and lists nobody in this session until it names itself. |
| `rpc`, `json`, `print` | Same rule: `/sessions` and `status` are reads, and the first addressable action joins. This is how a subagent or an RPC-driven session opts in. |
| WeChat peer | Same as `rpc`: the peer is a separate AgentSession in the bridge process and joins only on explicit use. Messages are read by that peer’s model; the bridge does not forward them to the phone. |

Every mode can arm the inbox watch; the notice is a visible transcript message, so
a `wake` raises that session’s own turn, not a phone notification.

## Configuration

None in v1. The heartbeat (10 s), watch poll (2 s), session TTL (10 min), message
TTL (24 h), text cap, inbox limit, and preview cap are constants in the extension.
The bus lives under the agent directory, not the project, so it is never committed.

## Parallel workflow

1. The user names each session (`/sessions name`), and the contract (OpenAPI,
   schema, or types) is written before parallel work starts.
2. Each session claims its paths before touching them, then implements its side.
3. A contract, build, or test change goes out as an event:
   `session({action:"send", to:"*", kind:"event", text:"contract v2: ..."})`.
4. Other sessions consume `inbox` at the start of their next turn, or arm
   `session({action:"watch", wake:true})` so a message raises their turn as soon
   as they are idle; a wake that arrives mid-turn is raised once that run
   settles, never pushed into the running turn.
5. Whoever integrates merges the worktrees and runs the project's full check.

The bus carries coordination, not authority. The plan, todo list, contract, and
git branch remain the source of truth.

## The /sessions board

The TUI opens the board; RPC, JSON, and print print the compact listing. `Tab`
cycles Sessions, Inbox, and Claims, `Enter` opens the focused row, and `Esc` goes
back from a row's pane. `↑`/`↓` and `PgUp`/`PgDn` scroll a list; a pane adds
`g`/`G` for its ends.

The board changes only this session's own state: `w` toggles its watch and `x`
releases a claim it holds. Mail is previewed, not consumed — `session inbox`
consumes it — and no view shows another session's inbox or releases its claims.

## Message kinds

Message kinds are `message` (default), `event`, `ask`, and `handoff`. An `ask` is
still a message: it does not block or wait for a reply. Text is capped at 4,000
characters.

## Limitations

- **Same machine, same OS user.** Any process with that user’s file access can
  read or write the bus; there is no authentication between sessions.
- **Pull-based by default.** A message does not wake a session that did not arm
  its inbox watch. Agents must call `inbox` at coordination points.
- **A reader is not a member.** `/sessions` and `session status` never add this
  session to the bus, so an unnamed session reads a board it is not on until it
  names itself or acts.
- **Arming is per session and session-only.** It survives neither a resume nor a
  new process; unread mail is previewed once more after `/resume`.
- **The board acts on your own state only.** `w` arms or disarms this session's
  inbox watch and `x` releases a claim it holds. Mail is a preview, not a consume:
  the board never deletes a message, never marks one reported, and never touches a
  peer's inbox or claim.
- **Two armed peers can ping-pong.** Each reply wakes the other as soon as it is
  idle. A wake raises one turn per burst, and `inbox` consumes, so the loop needs
  both sides to keep replying; the answer is to disarm one of them.
- **No broadcast history.** A broadcast reaches the sessions active at send time;
  a session that joins later does not receive it.
- **No forced claims.** A crashed owner blocks its paths until the session TTL
  expires. This is deliberate; stealing a claim is worse than waiting.
- **Bounded by TTL.** An idle session with a stopped heartbeat is pruned after
  ten minutes; its record, its claims, and an inbox directory left empty go with
  it, and its unread mail expires after 24 hours. A claim belongs to a record
  that was read from disk, not to the reader's idea of who is active, so a peer
  that claimed in the middle of someone else's prune keeps it.
- **One session id, one record.** Resuming a session in a second pane gives two
  processes the same id, and the record names the process that owns it: the older
  pane's shutdown leaves the record and the claims to the newer one instead of
  releasing them. Arming is still per process, so the survivor's watch is the
  survivor's.
- **A message file that does not parse is dropped.** The board's read never
  consumes mail, but it does delete a file it cannot validate, so a truncated
  message cannot linger on the bus.
- **No network.** It is not a distributed bus and does not synchronize machines.

## Pi integration

| Point | Detail |
|---|---|
| Tools | `session` — one action-shaped tool; `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: false`, `executionMode: "sequential"`. |
| Commands | `/sessions` (board in `tui`, listing elsewhere), `/sessions name <label>`, `/sessions watch [off\|wake]`, `/sessions help`. |
| UI | `tui` mounts `SessionListComponent` through `withPolledScreen` (rails suppressed, a 1 s read-only poll of `snapshot()` + `peek()`); every other mode prints through `ctx.ui.notify`. No status chip, so the watch never changes the footer. |
| Events | `session_start` resolves the repository and arms the mail trigger, without joining; `before_agent_start` reports queued non-wake mail at the next turn, `agent_settled` retries a wake the run suppressed, and `context` prunes stale notices; `session_shutdown` clears the heartbeat, the watch ticker, and the record. The seven hooks are `lib/report.ts`'s `registerPendingChannel`, not a local copy. |
| State | Files under `<agent-dir>/session-bus/<repo-key>/`; nothing in the session branch. The armed watch is session-only. `/resume` re-registers the same session id. |
| Lifecycle | The factory only registers. The runtime starts on `session_start`; heartbeat, watch ticker, and cleanup belong to it. Disabling `session-bus` through `PI_DISABLED_EXTENSIONS` registers nothing. |
| Mode | Uses `ctx.mode` to decide auto-join and whether `/sessions` mounts the board; `askHuman` is not involved and no status chip is published. |

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

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Disable guard, registration, the pending-report channel, and the session hooks. |
| `runtime.ts` | Lifecycle, repo key, joining, heartbeat, and the session's own reads and writes. |
| `mail-watch.ts` | The armed inbox watch: the poll, the not-yet-reported queue, and its state. |
| `store.ts` | Atomic JSON files, inbox, peek, claims, pruning, and the one release loop. |
| `protocol.ts` | Pure labels, targets, paths, validation, conflict rules. |
| `overlap.ts` | The one "do these paths collide?" predicate: `normalizeClaimPath` and `claimsConflict`, re-exported by `protocol.ts`. |
| `resolve.ts` | `resolveClaimPaths` and `claimPathMessage`: a claim path made repository-relative, posix, and canonical through its real target, or the refusal naming why. |
| `types.ts` | The stored shapes — session record, message, claim — and the tool's `details`. |
| `tui.ts` | The `/sessions` board, its scopes, and the pane over one row; the row grammar is in `rows.ts`. |
| `rows.ts` | The session/claim/message row builders and summaries shared by the board and the transcript. |
| `result.ts` | The `session` tool's expanded result block and its collapsed line. |
| `notice.ts` | The mail notice's model text and renderer details. |
| `tools.ts` | The `session` tool and its renderer. |
| `commands.ts` | `/sessions`. |
| `format.ts` | Model-facing listing and result text. |

## Testing

The capability suites — `format`, `protocol`, `store`, `runtime`, `tui`, `tools`,
`overlap`, `resolve`, and `extension` — are declared in `test/suite-manifest.ts`.
They build a bus in a temp directory with a fixed clock, so none needs a live peer; `runtime.test.ts`
puts its real-repository cases behind `runSlowSuites`, which skips unless `CI` or
`PI_SLOW_TESTS=1` is set.
