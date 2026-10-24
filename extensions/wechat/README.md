# wechat — a WeChat bridge with one Pi conversation per peer

Connect Pi to WeChat over Tencent's Weixin iLink bot API. Each admitted sender
gets their own Pi session - own history, own model context, the package's tools -
so a WeChat message starts a turn immediately and the terminal conversation is
never mixed into it. The sessions live in-process through the Pi SDK; there is no
subprocess per peer.

```
pi --extension ./extensions/wechat   # load just this extension
pi -e .                              # load the whole @gavin-hu/my-pi-agent package
pi install ./                        # install the package
```

## Tool rendering

How the `send_wechat` call and its result look in the transcript — the call line as a headline and the body indented under it:

<img src="../../assets/tools/send_wechat.png" alt="The send_wechat tool's call and result: the call line and an indented body with the message text and the sent confirmation" width="100%">

## What it does

- **Inbound** — one long-poll loop receives WeChat text, images, and files and
  hands them to the sender's own session; that turn's text is sent back to the
  sender. Nothing is injected into the terminal session, so the two
  conversations cannot contaminate each other.
- **One conversation per peer** — a session per admitted peer, persisted under
  `<agent-dir>/wechat/sessions/<peer>/`, resumed on the next message and disposed
  after half an hour idle. Turns run one at a time across peers by default, so a
  forwarded dialog always has a single owner.
- **Inbound media** — images are downloaded, AES-128-ECB decrypted, and attached
  as model image content; files are saved under `<agent-dir>/wechat/media/` and
  referenced by path. Voice uses the transcript the server provides. An
  attachment the bridge could not read (too large, a failed download, no key) is
  reported to the peer and to the model instead of vanishing.
- **Outbound** — replies stream to the chat as they are produced: a part goes out
  at each paragraph boundary, after two silent seconds, or at 400 characters,
  whichever comes first, so a long answer is not one long silence. Text is plain
  chat text (Markdown fences, headings, and emphasis markers are flattened), and
  a single part longer than `maxReplyChars` still arrives in numbered parts. The
  owner-only `send_wechat` tool lets the model message the owner proactively; it
  is refused while a turn with that peer is in flight, so the answer cannot
  arrive twice.
- **Typing indicator** — the native typing status is set as soon as a message is
  queued and refreshed for as long as the turn runs (`typingIndicator`, on by
  default), so the phone can tell a long turn from a dead bridge.
- **Peer feedback** — a burst that arrives while a turn is still running is
  answered once, a message waiting on another conversation is acknowledged once,
  a slow turn says so, and a turn that ends without text says so instead of going
  quiet. Notices and `/help` follow the peer's language: a Chinese message sets it,
  and a language-neutral reply (`1`, `ok`) does not switch it back. The peer can
  also stop (`/stop`), restart (`/new`), and ask what is happening (`/status`).
- **Remote prompts** — the peer session's own UI is bound to that peer, so
  `ask_user_question`, plan approval, and any other dialog raised inside a
  WeChat turn is sent to WeChat and answered there. Terminal turns keep the TUI,
  including while a peer turn runs (`remotePrompts`, on by default).
- **Status chip** — the status bar shows `✆ wechat` while the bridge runs and
  keeps an error-colored `✆ wechat expired` after a session expiry
  (`ctx.ui.setStatus`), so the outage stays visible until `/wechat login`
  reconnects or `/wechat logout` stops the bridge; it clears on shutdown.
- **Owner-only by default** — only the account owner (who scanned the login QR)
  can drive the agent; `allowedPeers` opts in others. An entry matches either id
  form (`alice` or `alice@im.wechat`), and a refused sender is named in
  `/wechat status` and in one terminal notice, so the id to allowlist can be
  copied from either. `a` on the control screen or `/wechat allow [peer]` writes
  one entry into the project config; the running bridge picks it up on the next
  `/reload` or restart, and the confirmation names the file.
- **Session-bound** — the bridge runs while an account is stored and the Pi
  process is alive; it starts on `session_start`, and `/wechat logout` clears the
  account and stops it. The peer sessions outlive it on disk.

## Commands

| Command | Effect |
|---|---|
| `/wechat` | TUI: the control screen. Elsewhere: a one-line summary. |
| `/wechat login` | QR login; on scan, stores credentials, replaces a running poller, and starts the bridge. |
| `/wechat new` | Start a fresh *host* session. Peer conversations are independent and survive it; they use an inbound `/new`. |
| `/wechat status` | The same control screen as a bare `/wechat` (the one-line summary while a peer turn runs). |
| `/wechat pause` | Stop polling new messages; running turns may finish and reply. The poller lock is released, so another runtime may take the account. |
| `/wechat resume` | Reacquire the lock and poll again; reports when another runtime already holds it. |
| `/wechat doctor` | Print a read-only health report: connection and token age, last poll and hold, lock holder, per-peer session/queue, recent failures. |
| `/wechat stop <peer>` | Stop that peer's running turn; reports when nothing was running. |
| `/wechat reset <peer>` | Start a fresh conversation for that peer; refused while its turn runs. |
| `/wechat history <peer> [n]` | Print that peer's recent messages (default 10, max 20); read-only, and works without a live session. |
| `/wechat allow [peer]` | Add a refused sender to `wechat.allowedPeers` in the project `.pi/bytefly.json`, after a confirmation that names the file. Without an argument it offers the refused senders. |
| `/wechat logout` | Confirm, then clear credentials, drop the bridge, and stop polling. |
| `/wechat help` | List the subcommands with a line each. |

The bridge starts automatically on `session_start` (and after `login`) whenever
an account is stored, so there is no start/stop command: the account is the
on/off switch. `/wechat logout` is the only way to stop polling, and it discards
the credentials.

A confirmed `/wechat login` is authoritative: a poller that is already running
is stopped and reopened with the new credentials, so a rotated token takes
effect at once. The account that was just scanned is the one the bridge runs,
recorded as the active entry in `credentials.json`; any other stored accounts
stay there but are not polled. Stored state (`state.json`) belongs to the
account, so logging in as a different account starts from an empty cursor and
owner instead of carrying the previous one's over.

A session that expires while running keeps the `✆ wechat expired` chip:
`/wechat status` reports it and points at the fix, and `/wechat login` is the
one-step recovery.

In the TUI, `/wechat` opens a control screen with the account, connection
state, owner, per-peer conversation rows (what each peer is doing, how long, and
what is queued behind it), activity counters, and the waiting remote prompt
(peer, question, and age).
`j`/`k` (or the arrows) move the focus over peer rows; `s` stops the focused
peer's turn and `d` starts a fresh conversation for it, both in place; `h` closes
the screen and prints that peer's history; `a` closes it and offers the refused
senders to allow; `c` withdraws the waiting prompt; `p` pauses or resumes
polling. `l` logs in or reconnects, `n` starts a new session, `o` logs out,
`r` refreshes, and Esc closes. The subcommands above are shortcuts for the same
actions and the only route outside the TUI; an unknown subcommand reports the
valid ones.

<img src="../../assets/wechat.png" alt="The /wechat control screen: account and an open connection, peer, queued, refused, and waiting-prompt rows, three conversation rows showing running, queued, and idle states, and the key hints" width="100%">

Pause is per runtime and keeps the account and peer sessions: a running turn
may finish and reply, a waiting prompt is withdrawn with the timeout notice,
and the poller lock is released so another runtime can take over. Resume
reacquires the lock and reports when another runtime holds it. `/reload` or a
restart builds a new bridge and resumes polling, so pause is a temporary mute,
not a persistent switch.

A peer turn runs in its own session, but it still owns the bridge, so a `/wechat`
command typed at the terminal declines while one is running: `status` prints the
one-line summary, and `login`/`logout`/`new` reply that they are unavailable
until the turn finishes. (`login`/`logout` would drop the connection mid-turn and
`new` would replace the host session, stopping the poller and leaving the peer
unanswered.) The terminal's own dialogs are unaffected: they are never forwarded
to a peer.

## Slash commands

A peer can type a slash command in the chat. The bridge intercepts it before it
becomes a turn, so a command never reaches the model unless it is unknown.

| Command | Kind | Effect |
|---|---|---|
| `/new` | action | Start a fresh conversation for that peer (owner only); declined while their turn runs. |
| `/stop` | action | Stop that peer's running turn; the turn itself answers `已停止。` / `Stopped.`. |
| `/status` | action | `正在处理，已用 N 秒` / `Working — Ns so far`, with the queue depth, or `Idle.`. |
| `/history [n]` | action | The last `n` messages of this conversation (default 8, max 20), one line each. |
| `/help` | action | Reply with the available commands. |

- **Snippets** expand a predefined body into the user turn (typing, queueing,
  and reply capture are unchanged); none is registered yet.
- **Actions** run locally and answer on WeChat without starting a turn.
- Matching is exact on the first token and case-insensitive; an unknown `/foo`
  (or a path-like `/usr/...`) falls through to the model as ordinary text, and a
  message carrying media is never treated as a command.
- `/new` is owner-only: an extra `allowedPeers` peer that sends it is refused
  like any other unauthorized sender. `/stop`, `/status`, `/history`, and
  `/help` are available to any admitted peer, and each acts only on the sender's
  own conversation.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| `tui` | Everything, including the QR login screen and the `/wechat` control screen (`ctx.ui.custom`). Peer conversations are independent of the terminal, so a WeChat turn never blocks or mixes into it. |
| `rpc` | The bridge auto-starts and `status` prints the one-line summary; `login` needs the TUI (the QR screen is unavailable over RPC), while `logout`'s confirmation is forwarded through the RPC UI protocol like any other dialog. |
| `json`, `print` | Ephemeral; the bridge does not auto-start and no UI is available, so `logout` reports that it needs a confirmation dialog instead of failing silently. |

## What the peer experiences

The peer has only the chat window, so the bridge carries the signals the phone
needs. Per action:

| Peer action | What they see |
|---|---|
| Sends a message | The native typing indicator starts as soon as the message is picked up; the answer is sent when the run settles. |
| Sends several messages quickly | At most one acknowledgement, then a single answer that covers the burst in order. |
| Waits behind a long turn | The indicator keeps refreshing, and after four seconds one short `收到，正在排队，轮到就回你。` / “Got it — queued; I’ll answer when it’s my turn.”; a turn still running at 30 seconds adds one `还在处理这条，发送 /stop 可取消。` / “Still working — send /stop to cancel.”, so the way out is named when it is wanted. |
| Sends while another peer's turn runs | One line after four seconds, then one more at a minute (`前面还有一条正在处理…` / “Your message is queued behind another conversation…”), and the answer when the slot frees. |
| Sends a photo or a file | The model reads it; an attachment that could not be read (too large, a failed download, no key) is named in the answer. |
| Sends a voice note or video | One line: voice without a transcript and video are not supported. |
| Reads a long answer | Streamed as it is produced — one part per paragraph, per two silent seconds, or per 400 characters — and numbered (`[1/3] …`) only when a single part exceeds `maxReplyChars`. |
| Reads an answer | Plain chat text — Markdown fences, headings, and emphasis markers are flattened, code-block bodies survive. |
| Is asked a question | A numbered prompt; 确定/是/yes or 不是/否/no answers it, 取消 dismisses. Ignored, it is nudged at the halfway point of its window and then cancelled: three minutes for a dialog, ten for a plan review, where the plan has to be read first. |
| Types `/help`, `/new`, `/stop`, or `/status` | The command list, a fresh conversation, a stopped answer, or the current state — including the dialog a blocked turn is waiting on; `/new` is declined while their run is in flight. A command works while a dialog waits: it is never read as an answer to it. |
| Types `/history` | The last eight messages of this conversation (or the requested number, up to 20), one line each. |
| Floods the chat | Past eight queued messages, one line asking to wait rather than an unbounded queue. |
| Sends the same message twice (a server replay) | Answered once: the WeChat message id is remembered for an hour, across a reconnect or reload. |
| Pastes a very long message | The first `maxInboundChars` characters reach the model, followed by a truncation marker, instead of an unbounded prompt. |
| Gets an aborted turn | `已停止。` / “Stopped.” |
| Exits, reloads, or forks mid-turn | One line: `会话已停止，这条还没答完。恢复后再发一次即可。` / “The session stopped before this answer finished — send it again when it's back.”, sent to every peer that still had work before the connection closes. |
| Gets a turn that produced no text | `这条处理完了，但没有文字输出。` / “That turn finished without any text to send.” |
| Gets a turn that could not start | `处理失败，请稍后重试。` / “Something went wrong — please try again.”, and the terminal says why. |
| Keeps messaging an expired or logged-out bridge | Nothing — the bot goes quiet, and only the terminal chip says why. |

Notices are one line and in the peer's language (Chinese once their messages
contain Chinese; a bare `1` or `ok` does not switch it back). The bridge never
sends greetings, read receipts, or progress chatter: WeChat notifies per message,
so every bubble has to carry information.

### The reply contract

One message, one turn, one answer. A queued message is never merged into
another prompt; it waits for its own turn. One acknowledgement per wait episode.

| Situation | What the peer gets |
|---|---|
| 1st message, session idle | typing, then the answer (no acknowledgement: there is nothing to wait for) |
| 1st message, peer busy | typing, `收到，排队中，轮到就回。` at 4 s, `还在处理前一条，轮到就回。` at 60 s, the answer when the slot frees |
| 2nd message while a turn runs | its own turn behind the first; the 4 s ack and 60 s busy line; then its own answer |
| 2nd message already queued | behind the first in FIFO; no merge |
| 3rd…Nth in a burst | each is its own turn; past eight queued, one line asking to wait |

Two consequences worth knowing: an answer can take up to one long-poll cycle
(the server holds each `getupdates`; measured ~18 s) before the turn even
starts, and a reply is delivered when the run settles, not token by token.

## Remote prompts

A dialog raised while a WeChat turn is in flight is forwarded to the sender:

- `select` — a numbered list; reply with a number or the option text. Free text
  becomes the “Other” answer only when the list carries that entry; the hint says
  so, so a plan review without it does not pretend free text is a choice.
- `confirm` — reply 是/否, 确定/不是, or yes/no.
- `input` / `editor` — reply with the text.
- Reply 取消 (or cancel) to dismiss; `退出`, `退出 plan 模式`, and
  `exit plan mode` are recognized as cancel intent. In a plan review a dismissal
  leaves plan mode without approving.
- Hints are rendered in the peer’s language, one language per prompt. A reply
  that cannot be read re-sends the prompt with a short “didn’t recognize that”
  notice instead of repeating it silently.
- A command is not an answer. While a dialog waits the model is blocked on it, so
  the slash commands are matched first: `/status` names the waiting question and
  `/stop` stops the turn, where before both were parsed as an attempt to answer
  and bounced back as “didn’t recognize that”. Any other text is still the answer,
  so a number, 是/否, or 取消 behaves as above.
- An unanswered prompt is bounded: a reminder goes out halfway and the question
  is cancelled at the end of its window with a one-line notice, so an ignored
  dialog cannot freeze the session. A dialog uses three minutes; the plan review
  uses ten. A timed-out plan review is treated like a dismissal: plan mode ends
  without approval, and the plan file remains.
- A prompt that goes away before it is answered says so: a pause withdraws it with
  `问题已撤回。` / “That question was withdrawn.”, a `/stop` ends its turn with
  `已停止。`, and a shutdown reports the abandoned turn — the peer was not slow, the
  question or the session left.

Each peer session is created with its own UI context (`bindExtensions` with
`mode: "rpc"`), so its dialogs go to that peer by construction rather than by
wrapping the terminal's UI. A full-screen `custom` component has nothing to draw
on, so it stays unavailable, exactly as over RPC. Set `remotePrompts: false` to
create peer sessions without forwarding: a dialog is then answered as cancelled,
so a peer turn can still run but cannot ask a question the operator did not route
to WeChat. See [Design notes](#design-notes).

## Outbound files

A remote prompt can deliver a local file first. The plan review uses this: the
plan file is sent before one compact editor prompt with the title, first steps,
mode status, and three actions. Reply 2 to keep planning or 3 to exit; any other
text is a refinement. If the upload fails, the plan text is sent instead. The
plan file stays on disk. After a Keep decision the user can say “exit plan mode”; the model
calls `cancel_plan_mode`, which needs no plan path and records no todo or goal.
The flow mirrors the
reference client: `getuploadurl` → AES-128-ECB encrypt → `POST` the ciphertext
(`Content-Type: application/octet-stream`) → read `x-encrypted-param` → send a
`type: 4` file item. No current flow uses it; images, video, and voice are not
sent outbound.

## Configuration

The `wechat` section of the shared `bytefly.json`, the global document
overridden by the project `<cwd>/.pi/bytefly.json` (project wins):

```jsonc
// bytefly.json → "wechat"
{
  "allowedPeers": [],        // extra peers, by id or label (alice / alice@im.wechat)
  "peers": {},              // per-peer overrides, e.g. { "alice": { "tools": ["read", "todo"] } }
  "maxTurnsPerHour": 0,     // turns per peer per rolling hour; 0 = unlimited
  "maxReplyChars": 4000,     // replies longer than this are split into messages
  "botAgent": "pi-wechat",   // sent as base_info.bot_agent
  "channelVersion": "0.1.0", // sent as base_info.channel_version
  "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c", // CDN media base
  "maxMediaBytes": 20971520, // inbound media larger than this is skipped
  "maxInboundChars": 8000, // inbound text longer than this is truncated
  "typingIndicator": true,   // show typing while a turn is generated
  "remotePrompts": true,     // answer interactive dialogs on WeChat during a WeChat turn
  // "pollHoldMs": 3000      // experimental: request a shorter long-poll hold; unset by default
}
```

State lives under `<agent-dir>/wechat/`: `credentials.json` (mode `0600`, every
stored account plus the active one), `state.json` (cursor, owner, per-peer reply
tokens, and recently handled message ids), `media/` (downloaded inbound files),
`sessions/<peer>/` (one conversation per peer), and `poller.lock` (stops two
sessions polling one account).

### The long-poll hold

A WeChat message is only visible to Pi when a `getupdates` request returns, and
the server decides how long it holds one. Measured here: **~18 s**, which is the
floor on how fast the bot can react to anything.

`pollHoldMs` asks the server for a shorter hold. The response mirrors
`longpolling_timeout_ms`, but whether the server *honours* a request for a
different value is not documented, so it is opt-in and unset by default. To find
out on your account, quit `pi` and run this from a repository checkout:

```bash
bun scripts/wechat-poll-probe.ts 3000
```

It prints the requested hold, the measured one, and the value the server echoed,
then says whether the request was honoured. It refuses to run while a bridge is
polling (two clients on one account can steal each other's messages), and it
never touches the stored cursor.

## Security

- WeChat text is **untrusted**, and in this design it becomes a turn in your live
  session **with that session's tools** (including `bash`/`write`/`edit`).
  Admission control is the only gate: the default is **owner-only**, and
  `allowedPeers` is an explicit opt-in. A refused sender is counted and named in
  `/wechat status`, not run. `peers[<id>].tools` narrows an admitted peer to a
  tool allowlist (an empty list leaves it with none), so an extra peer need not
  get `bash`.
- Inbound text is sanitized (control characters stripped) before it reaches the
  transcript.
- Inbound media is **untrusted**: images become model image content, and files
  are saved under `<agent-dir>/wechat/media/` with sanitized names and a size cap
  (`maxMediaBytes`). Inbound text is capped by `maxInboundChars` before it reaches
  the model, and a replayed message id is answered once. Nothing is executed.
- Credentials are written `0600` and redacted from diagnostics; egress is only to
  the Weixin endpoint.
- Automated or unofficial WeChat use can violate WeChat's terms and risk account
  restriction. Single-owner, low-volume use is recommended.

## Troubleshooting

- **First, run `/wechat doctor`.** It prints the connection, token age, last
  poll, poller lock, per-peer queue/session age, and the last failure, which
  answers most "why is the bot quiet?" questions in one screen.
- **`Another Pi session is already polling this WeChat account.`** — one runtime
  owns the account at a time, tracked by `<agent-dir>/wechat/poller.lock`.
  Quit the other `pi` process. A lock left by a process that already exited is
  ignored on the next start, and one older than 120 s is ignored too, so a crash
  never needs the file removed by hand.
- **The chip says `✆ wechat`, while `/wechat status` reads `closed` with no
  peer count and `send_wechat` reports the bridge is not started — and an
  inbound message is answered in the terminal but never reaches the phone.**
  Only the runtime holding `poller.lock` receives and answers; a poller started
  by another runtime keeps the account until that process exits. An extension is
  imported when the `pi` process starts, so `/reload` or a restart is what
  applies a code upgrade, and the next `session_start` builds the bridge in this
  runtime.

- **The phone gets no reaction, or an answer never arrives.** In order: (1) check
  `/wechat status` — a non-zero `queued` means the messages are waiting for the
  local session, and a `closed` connection means the poller is not running (see
  the lock entry above); (2) the phone waits up to one long-poll cycle (~20 s) for
  the server to hand over a message, so an answer within a few seconds is not
  promised; (3) the terminal now reports a poll that times out or is rejected,
  a turn that could not start, and a send the server refused with `ret N`, so a
  silent phone with a clean terminal means the message never reached this
  process.
- **A WeChat message is answered in the terminal but the phone never sees it.**
  Not possible any more for a per-peer session — a WeChat turn runs in that
  peer's session, never in the terminal's transcript. A `/wechat new`, `/reload`,
  or process exit during a WeChat turn still drops that turn's reply, because the
  shutdown aborts the send; the conversation itself survives on disk.

## Limitations

- An expired bridge or a `/wechat logout` is silence on the phone: the token that
  would carry a notice is the one that expired, so only the terminal chip and
  `/wechat status` say what happened.
- Turns run one at a time across peers, fixed at one: a second peer's message
  waits for the first peer's turn. That keeps a forwarded dialog unambiguous
  (the shared interaction channel has one owner); a peer who is waiting is
  acknowledged and told why. More concurrency needs a per-peer channel, not a
  config value.
- Each peer conversation is a full Pi session: it carries its own context and
  costs its own model tokens, and it loads the package's tools (minus this
  bridge) in the same workspace. The idle sweep disposes a session after 30
  minutes, so idle peers cost nothing.
- Inbound delivery is bounded by the server's long-poll hold: the client sees a
  message only when a `getupdates` request returns, measured at ~18 s per cycle
  here. The bridge reports a wedged or rejected poll, but it cannot make the
  first reaction faster than one cycle.
- Parts are flushed at a paragraph boundary, after two silent seconds, or at 400
  characters, so an answer that stalls mid-paragraph still arrives in pieces. A
  part that is itself longer than `maxReplyChars` is numbered.
- An abandoned turn's notice is one attempt, not a queue. Any close — `/wechat
  new`, `/reload`, a fork, a logout, or a process exit — sends one short line per
  peer that still had work, and a queued message shares its peer's line rather
  than earning its own bubble. It needs a live connection: a notice the transport
  cannot deliver within five seconds is reported on the terminal and dropped, not
  retried. The one close that stays silent is the worker an expired connection
  replaces on reconnect, whose token is already dead.
- Inbound **video** is not handled, and there is no group-chat support. Voice is
  handled only through the server-provided transcript. Both are answered with a
  one-line notice rather than being dropped silently, and a voice note the
  server gave no transcript for is treated the same way.
- Outbound **files** are supported (used by the plan review); outbound images,
  video, and voice are not, and `send_wechat` sends text only.
- Remote prompts cover the standard dialogs (`select`/`confirm`/`input`/`editor`).
  A full-screen `ctx.ui.custom` component cannot be answered over WeChat: a peer
  session's UI context refuses it, exactly like RPC mode.
- A peer can only be replied to after they have messaged first (the protocol
  supplies a `context_token` only then).
- Slash commands are fixed built-ins; there is no user-defined snippet or action
  list yet, and `/new`, `/stop`, `/status`, and `/help` are registered.
- Pause is runtime-local. `/wechat pause` stops polling and releases the lock,
  but a reload, `/new`, or restart builds a fresh running bridge; only
  `/wechat logout` stops it persistently (and discards the credentials).

## Non-goals

Outbound image/video/voice media, video, model-callable sends to arbitrary
recipients, group chats, a local quote cache, and a long-lived RPC child (peer
sessions are in-process).

## Pi integration

| Integration point | Detail |
|---|---|
| Command | `pi.registerCommand("wechat", …)` — `login`, `new`, `status`, `pause`, `resume`, `doctor`, `stop <peer>`, `reset <peer>`, `history <peer> [n]`, `allow [peer]`, `logout`, `help`; bare `/wechat` opens the control screen. |
| Tools | `send_wechat` — owner-only proactive text; registered at factory time with direct exposure (the default), `executionMode: "sequential"`, `openWorldHint: true`. |
| Events | `session_start` (record the live context, auto-start the bridge when an account exists); `session_shutdown` (idempotent stop). No host run events: peer turns are not the host session's runs. |
| Sessions | `openPeerSession` creates one SDK `AgentSession` per peer (`createAgentSession`, `SessionManager.continueRecent` under `<agent-dir>/wechat/sessions/<peer>/`), inheriting the host's model and thinking level. `DefaultResourceLoader` standard discovery minus this bridge (`withoutWechatExtensions`), so a peer session cannot start a second poller, plus a short channel contract appended to the system prompt so the model knows it is answering in a phone chat window. When `peers[<id>].tools` is set, only those names stay active. |
| Turn ownership | `peer-worker.ts`: a serial queue per peer, `session.prompt()`/`session.abort()`, `getLastAssistantText()` for the answer, one idle sweep per session, and the one notice an abandoning close sends per peer. `concurrency` defaults to 1 so a forwarded dialog has one owner. |
| Slash commands | Admitted inbound text is matched against `SLASH_COMMANDS` in `handleMessage`; a snippet is expanded into the turn, an action runs out-of-band and replies, and an unknown command falls through. Actions act on the sender through `SlashSessionControls` (`newSession` → worker reset, `stop` → worker abort, `status` → worker state, `history` → a read-only read of that peer's newest session). |
| Peer dialogs | `bindExtensions({ mode: "rpc", uiContext })` on each peer session, with `createPeerUIContext(channel)` routing `select`/`confirm`/`input`/`editor` to that peer and marking the context for `askHuman`'s file/text preface. The terminal's shared `ctx.ui` is deliberately not adapted: a host turn is never answered remotely, so its dialogs stay local even while a peer turn runs. |
| Status | The bridge's connection state (`running` / `paused` / `expired` / `stopped`) is published through `onStateChange` to `ctx.ui.setStatus(STATUS_KEYS.wechat, …)`; an expiry keeps a persistent error chip, pause keeps a warning chip, and the status bar renders it on line 2. |
| State | Files under `<agent-dir>/wechat/`; the bridge is not authoritative UI, so nothing is stored in the transcript. |
| Lifecycle | The factory only registers. The poll loop starts on `session_start` when an account is stored (and after `/wechat login`); `session_shutdown` closes it. One bridge per extension runtime: it is built once, `open()` is a no-op while running or paused (so the RPC double `session_start` on a session switch cannot start a second poller or resume a paused one), and shutdown is idempotent, so the reload and replacement paths (`/reload`, `/new`, resume, fork — all of which re-run the factory and emit shutdown before the new start) each end with exactly one poller. `pause()` stops the loop and releases the lock while keeping the worker, so a running turn can finish; `resume()` reacquires the lock and starts a new loop. Pause is runtime-local, so a reload or restart starts a fresh running bridge. `/wechat` screens use `ctx.ui.custom`, so they degrade (status) or decline (login, logout) while a peer turn runs. |

## Design notes

The first version made the live terminal session the agent. That choice forced a
long list of workarounds: a WeChat message could only start when the terminal was
idle, the reply had to be guessed from whatever run finished, and two audiences
shared one context. It also produced the worst bug so far — a prompt rejected
because the terminal went busy left the bridge deaf, with no acknowledgement and
no answer.

The peer session replaces all of it. Each admitted sender gets an ordinary Pi
session, so a message starts immediately, the answer is that session's own
`getLastAssistantText()`, and the terminal transcript never sees the exchange.
The bridge keeps only what is genuinely shared: one poll loop per account, the
media pipeline, admission, the typing indicator, and the notices.

A peer session carries one extra piece of context: a short channel contract
(`channel.ts`) appended to its system prompt, telling the model the reader is on
a phone and cannot see this terminal, the tool output, or the filesystem; that a
command it does not run is a command nobody runs; and that a plan or attachment
has to be summarized in the message itself, because a file bubble may never be
opened. It is a static append rather than a per-turn injection so it stays out of
the conversation history and stays cacheable, and it deliberately says nothing
about individual tools (their own descriptions cover usage) or answer length (the
reply pipeline handles splitting). Project instructions still apply; the contract
changes how the answer is presented, not how carefully the work is done.

Media and typing stay at the boundary: downloads go to a fixed CDN with a size
cap, filenames are sanitized before use, and typing is best-effort. The send tool
is owner-only so untrusted generated text cannot be aimed at another account.

Peer dialogs need no host seam: `AgentSession.bindExtensions` takes the UI
context, so `createPeerUIContext` hands the peer session a UI whose dialogs are
that peer's channel, marks it so `askHuman` delivers the optional file/text
preface, and answers as cancelled when `remotePrompts` is off. The terminal's
shared `ctx.ui` is deliberately left alone — with one session per peer there is
no remote turn in the host, and adapting it routed a terminal turn's prompt to
whichever peer happened to be running.

Outbound files use the CDN upload flow (`getuploadurl`, AES-128-ECB ciphertext,
`x-encrypted-param`) and reuse the same AES-128-ECB and key decoders as inbound
media; a failed upload returns false so `askHuman` can fall back to text rather
than blocking the dialog.

The lifecycle is derived from the stored account rather than an explicit
start/stop command: `session_start` opens the bridge while credentials exist and
`session_shutdown` closes it. The bridge handle is one variable that the tool and
the commands read, because a built-but-unstored bridge still polls: it would
answer peers, never publish a chip, and never stop. Keeping the same variable
also makes the already-open guard real: every `session_start` reuses a running
bridge instead of building a second poller, which is what the RPC double bind
would otherwise do.

A worker belongs to one open connection: `/wechat login` after an expiry, or a
reconnect, creates a fresh worker, so a stale queue or a half-open session cannot
leak into the new connection. Peer sessions are disposed with the worker but
their history stays on disk.

The operator surface is one verb table: a bare `/wechat` (or `/wechat status`)
opens the control screen, whose keys return the same verbs the subcommands
accept, so each action has a single implementation and there is no subcommand to
memorize. The table is also the source of the help text, the usage line, and the
tab completions, so a new verb cannot be listed in one place and missed in
another. The screen closes with an action the command runs afterwards, so the
QR login screen never opens while the control screen still owns input focus. An
unknown subcommand reports the valid verbs instead of silently falling back to
status, which is what the old start/stop guidance used to do.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: gate, register the command and tool, wire the lifecycle events, build the bridge, open peer sessions from the host context. |
| `bridge.ts` | The composition root: wires the poll loop, delivery, presence, admission, and inbound modules to the live client/account/cursor/state; owns the connection lifecycle, slash dispatch, the status snapshot, and `sendToOwner`. |
| `tools.ts` | The `send_wechat` tool (owner-only proactive text). |
| `config.ts` | The `wechat` section of `bytefly.json` loading and normalization. |
| `types.ts` | Wire and domain types. |
| `errors.ts` | Re-exports `messageOf` from `lib/errors.ts`, the one error-to-line helper every notice and tool error uses. |
| `timer.ts` | The timer seam: the cancellable one-shot `ArmTimer`, `defaultTimer`, and the abortable `defaultSleep`. |
| `transport/client.ts` | iLink HTTP client (QR, getupdates, sendmessage, file sendmessage, getuploadurl, getconfig, sendtyping, CDN download/upload) with an injected runner. |
| `transport/poll.ts` | The long-poll loop: `getupdates`, the watchdog and retry, backoff, cursor persistence, and the expiry stop. |
| `transport/deliver.ts` | The one outbound text path (reply, dialog preface, `send_wechat`) plus file delivery: flatten, split, number, expiry, rejection, and the once-per-outage notice. |
| `transport/outbound.ts` | Upload and send a local file: hash, encrypt, `getUploadUrl`, upload, `sendFileMessage`. |
| `transport/inbound.ts` | Inbound media resolution (download, decrypt, save, attach) and the hand-off to a peer's session. |
| `transport/media.ts` | Media key/encrypt/decrypt, padded size, upload/download URL, MIME sniff, filename sanitize, and save helpers. |
| `state/state.ts` | `state.json` (cursor, owner, per-peer tokens, recent message ids). |
| `state/credentials.ts` | `credentials.json` (`0600`, every stored account and the active one). |
| `state/lock.ts` | Poller lockfile. |
| `peer/peer-session.ts` | One SDK `AgentSession` per peer: workspace, model, history under the state dir, dialogs bound to that peer, this bridge excluded from its resources, and the channel prompt appended. |
| `peer/peer-worker.ts` | Per-peer queue, one turn at a time (`concurrency`), prompt/abort/reset, streamed reply parts, idle-session sweep, and the notice an abandoning close sends. |
| `peer/admission.ts` | The rolling-hour turn budget and the per-peer serial admission chain. |
| `peer/reply-pipeline.ts` | Where a streamed answer is split (paragraph, quiet period, size), sent in order, and finished without duplicating a part. |
| `peer/presence.ts` | Typing, acknowledgement, and the slow/busy lines; all per-peer wait timers in one registry. |
| `commands/commands.ts` | `/wechat login|new|status|stop|reset|logout|help`: the verb table that drives the help text and completions, the dispatch, the panel, login/logout, and the per-peer stop/reset; `login`/`new`/`logout` decline and `status` degrades to the summary while a peer turn runs. |
| `commands/slash.ts` | Inbound slash commands: the built-in registry (`/new`, `/stop`, `/status`, `/history`, `/help`), the session controls an action may invoke, and the pure parse/lookup/expand helpers. |
| `commands/doctor.ts` | The plain-text `/wechat doctor` report: connection/token age, poll, lock, peer sessions, recent failures, and config. |
| `commands/login.ts` | QR login state machine. |
| `commands/history.ts` | Read-only `/history`: opens the peer's newest session, formats the last user/assistant messages, and never writes. |
| `text/format.ts` | Sanitize, chunk, and label helpers (text only). |
| `text/notices.ts` | The peer-facing notice catalog: one line per kind, in the peer's language. |
| `text/channel.ts` | The phone-chat contract appended to a peer session's system prompt. |
| `dialog/interaction.ts` | The WeChat `InteractionChannel`: pending-prompt state machine and reply routing. |
| `dialog/prompt.ts` | Pure prompt formatting and reply parsing. |
| `dialog/remote-ui.ts` | The peer session's UI context: dialogs and notices bound to that peer, the `askHuman` marker that delivers the file/text preface, and the `remotePrompts` switch. |
| `view/login-screen.ts` | The `/wechat login` screen (`ctx.ui.custom`), drawn from the `lib/tui/` kit (`titleRule`, `clip`, `isCloseKey`). |
| `view/status-screen.ts` | The `/wechat` control screen (`ctx.ui.custom`): live facts, a focusable peer list with stop/reset/history keys, and the pure one-line/body renderers, drawn from the `lib/tui/` kit (`titleRule`, `keyValueRow`, `listRow`, `paint`, `IdCursor`). |

Modules are grouped by the role they play: `transport/` is the only place that talks to iLink, `state/` owns the three files a session leaves on disk, `peer/` runs one peer's session and its queue, `commands/` holds a slash verb, `text/` words everything a peer reads, `dialog/` asks a question over WeChat, and `view/` draws a full-screen surface. `index.ts`, `bridge.ts`, `tools.ts`, `config.ts`, `types.ts`, `errors.ts`, and `timer.ts` stay at the root — the factory, the composition root, the public surface, and the seams the directories import.

## Testing

`bun test extensions/wechat`. Modules take injected seams (HTTP runner, clock,
sleep, `pi`/context fakes, and an `openSession` seam for the peer sessions); no
test touches the network, a real session, or a model.
Inbound media is exercised with a locally encrypted fixture, so decryption is
tested without a CDN.
