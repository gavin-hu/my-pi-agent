# wechat — a thin WeChat bridge for the live Pi session

Connect the Pi session you are running to WeChat over Tencent's Weixin iLink bot
API. The live session **is** the agent: an inbound WeChat message becomes a user
turn in that session, so Pi answers with its own context and tools, and the
reply is sent back. There is no subprocess and no separate agent.

```
pi --extension ./extensions/wechat   # load just this extension
pi -e .                              # load the whole @gavin-hu/my-pi-agent package
pi install ./                        # install the package
```

## What it does

- **Inbound** — a long-poll loop receives WeChat text, images, and files and
  injects them as a real user turn (`pi.sendUserMessage`); the assistant's final
  text is sent back to the sender.
- **Inbound media** — images are downloaded, AES-128-ECB decrypted, and attached
  as model image content; files are saved under `<agent-dir>/wechat/media/` and
  referenced by path. Voice uses the transcript the server provides.
- **Outbound** — replies are delivered automatically; the owner-only
  `send_wechat` tool lets the model message the owner proactively.
- **Typing indicator** — the native typing status is set while an inbound turn is
  being generated (`typingIndicator`, on by default).
- **Owner-only by default** — only the account owner (who scanned the login QR)
  can drive the agent; `allowedPeers` opts in others.
- **Session-bound** — the bridge runs while the Pi session is alive and only
  when started; `/wechat stop` stops it.

## Commands

| Command | Effect |
|---|---|
| `/wechat login` | QR login; on scan, stores credentials (does not start the connection). |
| `/wechat start` | Start the bridge: long-poll and forward messages to the agent. |
| `/wechat stop` | Stop the bridge; credentials and cursor are kept. |
| `/wechat status` | Show account, open/closed, peer count, and queue depth. |
| `/wechat logout` | Confirm, then clear credentials and stop the bridge. |

`login` and `start` are separate: `login` authenticates, `start` connects.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| `tui` | Everything, including the QR login screen (`ctx.ui.custom`). |
| `rpc` | `/wechat start`/`stop`/`status` work; `login` needs the TUI (the QR screen is unavailable over RPC). |
| `json`, `print` | Ephemeral; `start` is refused, and no UI is available. |

## Configuration

`<agent-dir>/wechat.json` overridden by `<cwd>/.pi/wechat.json` (project wins):

```jsonc
{
  "allowedPeers": [],        // extra peers; the owner is always allowed
  "pollTimeoutMs": 35000,    // long-poll fallback when the server omits one
  "maxReplyChars": 4000,     // replies longer than this are split into messages
  "botAgent": "pi-wechat",   // sent as base_info.bot_agent
  "channelVersion": "0.1.0", // sent as base_info.channel_version
  "cdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c", // CDN media base
  "maxMediaBytes": 20971520, // inbound media larger than this is skipped
  "typingIndicator": true    // show typing while a turn is generated
}
```

State lives under `<agent-dir>/wechat/`: `credentials.json` (mode `0600`),
`state.json` (cursor, owner, per-peer reply tokens), `media/` (downloaded inbound
files), and `poller.lock` (stops two sessions polling one account).

## Security

- WeChat text is **untrusted**, and in this design it becomes a turn in your live
  session **with that session's tools** (including `bash`/`write`/`edit`).
  Admission control is the only gate: the default is **owner-only**, and
  `allowedPeers` is an explicit opt-in. A refused sender is counted, not run.
- Inbound text is sanitized (control characters stripped) before it reaches the
  transcript.
- Inbound media is **untrusted**: images become model image content, and files
  are saved under `<agent-dir>/wechat/media/` with sanitized names and a size cap
  (`maxMediaBytes`). Nothing is executed.
- Credentials are written `0600` and redacted from diagnostics; egress is only to
  the Weixin endpoint.
- Automated or unofficial WeChat use can violate WeChat's terms and risk account
  restriction. Single-owner, low-volume use is recommended.

## Limitations

- The bridge shares one conversation with your interactive session. It serializes
  its own messages and only injects when the session is idle, but if you are
  actively typing, a reply may attach to a mixed context.
- Inbound **video** is not handled, and there is no group-chat support. Voice is
  handled only through the server-provided transcript.
- Outbound media is not supported; `send_wechat` sends text only.
- A peer can only be replied to after they have messaged first (the protocol
  supplies a `context_token` only then).

## Non-goals

Outbound media, video, model-callable sends to arbitrary recipients, per-peer
session isolation, group chats, a local quote cache, and a long-lived RPC child.

## Pi integration

| Integration point | Detail |
|---|---|
| Command | `pi.registerCommand("wechat", …)` — `login`, `start`, `stop`, `status`, `logout`. |
| Tools | `send_wechat` — owner-only proactive text; registered at factory time with `exposure: "direct"`, `executionMode: "sequential"`, `openWorldHint: true`. |
| Events | `session_start` (record the live context); `agent_start` / `agent_settled` (busy guard); `message_end` (capture assistant text); `session_shutdown` (idempotent stop). |
| Injection | `pi.sendUserMessage(content)` — a string, or text/image blocks for inbound media; always triggers a turn, and the bridge only injects when idle. |
| State | Files under `<agent-dir>/wechat/`; the bridge is not authoritative UI, so nothing is stored in the transcript. |
| Lifecycle | The factory only registers. No I/O starts on load; `/wechat start` starts the poll loop and `session_shutdown` closes it. |

## Design notes

The live session is the agent — an explicit choice over spawning a headless `pi`
per peer. That keeps the agent's real context and tools, at the cost of sharing
the conversation. Because injected messages carry **no correlation id**, the
bridge serializes its turns: it records the peer when it injects, captures the
final assistant text of that run, and flushes the reply on `agent_settled`
before draining the queue. Only the owner may drive it because in-process input
reaches the session's tools.

Media and typing stay at the boundary: downloads go to a fixed CDN with a size
cap, filenames are sanitized before use, and typing is best-effort. The send tool
is owner-only so untrusted generated text cannot be aimed at another account.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: gate, register the command and tool, wire the lifecycle events, build the bridge. |
| `bridge.ts` | The loop: poll, queue, inject, capture, reply, media, typing, open/close, abort. |
| `commands.ts` | `/wechat login|start|stop|status|logout`. |
| `tools.ts` | The `send_wechat` tool (owner-only proactive text). |
| `client.ts` | iLink HTTP client (QR, getupdates, sendmessage, getconfig, sendtyping, CDN) with an injected runner. |
| `media.ts` | Media key/decrypt, MIME sniff, filename sanitize, CDN URL, and save helpers. |
| `login.ts` | QR login state machine. |
| `qrcode.ts` | QR matrix → Unicode half-block terminal lines. |
| `login-screen.ts` | The `/wechat login` screen (`ctx.ui.custom`). |
| `config.ts` | `wechat.json` loading and normalization. |
| `credentials.ts` | `credentials.json` (`0600`, multi-account). |
| `state.ts` | `state.json` (cursor, owner, per-peer tokens). |
| `lock.ts` | Poller lockfile. |
| `format.ts` | Sanitize, chunk, and label helpers. |
| `types.ts` | Wire and domain types. |

## Testing

`bun test extensions/wechat`. Modules take injected seams (HTTP runner, clock,
sleep, `pi`/context fakes); no test touches the network or a real session.
Inbound media is exercised with a locally encrypted fixture, so decryption is
tested without a CDN.
