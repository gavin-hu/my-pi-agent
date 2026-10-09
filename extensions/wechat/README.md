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

- **Inbound** — a long-poll loop receives WeChat text and injects it as a real
  user turn (`pi.sendUserMessage`); the assistant's final text is sent back to
  the sender.
- **Outbound** — replies are delivered automatically; there is no model tool.
- **Owner-only by default** — only the account owner (who scanned the login QR)
  can drive the agent; `allowedPeers` opts in others.
- **Session-bound** — the bridge runs while the Pi session is alive and only
  when opened; `/wechat close` stops it.

## Commands

| Command | Effect |
|---|---|
| `/wechat login` | QR login; on scan, stores credentials (does not open the connection). |
| `/wechat open` | Start the bridge: long-poll and forward messages to the agent. |
| `/wechat close` | Stop the bridge; credentials and cursor are kept. |
| `/wechat status` | Show account, open/closed, peer count, and queue depth. |
| `/wechat logout` | Confirm, then clear credentials and close the bridge. |

`login` and `open` are separate: `login` authenticates, `open` connects.

## Behaviour by mode

| Mode | Behaviour |
|---|---|
| `tui` | Everything, including the QR login screen (`ctx.ui.custom`). |
| `rpc` | `/wechat open`/`close`/`status` work; `login` needs the TUI (the QR screen is unavailable over RPC). |
| `json`, `print` | Ephemeral; `open` is refused, and no UI is available. |

## Configuration

`<agent-dir>/wechat.json` overridden by `<cwd>/.pi/wechat.json` (project wins):

```jsonc
{
  "allowedPeers": [],        // extra peers; the owner is always allowed
  "pollTimeoutMs": 35000,    // long-poll fallback when the server omits one
  "maxReplyChars": 4000,     // replies longer than this are split into messages
  "botAgent": "pi-wechat",   // sent as base_info.bot_agent
  "channelVersion": "0.1.0"  // sent as base_info.channel_version
}
```

State lives under `<agent-dir>/wechat/`: `credentials.json` (mode `0600`),
`state.json` (cursor, owner, per-peer reply tokens), and `poller.lock` (stops two
sessions polling one account).

## Security

- WeChat text is **untrusted**, and in this design it becomes a turn in your live
  session **with that session's tools** (including `bash`/`write`/`edit`).
  Admission control is the only gate: the default is **owner-only**, and
  `allowedPeers` is an explicit opt-in. A refused sender is counted, not run.
- Inbound text is sanitized (control characters stripped) before it reaches the
  transcript.
- Credentials are written `0600` and redacted from diagnostics; egress is only to
  the Weixin endpoint.
- Automated or unofficial WeChat use can violate WeChat's terms and risk account
  restriction. Single-owner, low-volume use is recommended.

## Limitations

- The bridge shares one conversation with your interactive session. It serializes
  its own messages and only injects when the session is idle, but if you are
  actively typing, a reply may attach to a mixed context.
- Only direct text is handled; there is no typing indicator, media, or group
  support.
- A peer can only be replied to after they have messaged first (the protocol
  supplies a `context_token` only then).

## Non-goals

Per-peer isolation, a model-callable send tool, media (image/voice/file/video),
typing indicators, group chats, a local quote cache, and a long-lived RPC child.

## Pi integration

| Integration point | Detail |
|---|---|
| Command | `pi.registerCommand("wechat", …)` — `login`, `open`, `close`, `status`, `logout`. |
| Tools | None. |
| Events | `session_start` (record the live context); `agent_start` / `agent_settled` (busy guard); `message_end` (capture assistant text); `session_shutdown` (idempotent stop). |
| Injection | `pi.sendUserMessage(text)` — always triggers a turn; the bridge only injects when idle. |
| State | Files under `<agent-dir>/wechat/`; the bridge is not authoritative UI, so nothing is stored in the transcript. |
| Lifecycle | The factory only registers. No I/O starts on load; `/wechat open` starts the poll loop and `session_shutdown` closes it. |

## Design notes

The live session is the agent — an explicit choice over spawning a headless `pi`
per peer. That keeps the agent's real context and tools, at the cost of sharing
the conversation. Because injected messages carry **no correlation id**, the
bridge serializes its turns: it records the peer when it injects, captures the
final assistant text of that run, and flushes the reply on `agent_settled`
before draining the queue. Only the owner may drive it because in-process input
reaches the session's tools.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: gate, register the command, wire the lifecycle events, build the bridge. |
| `bridge.ts` | The loop: poll, queue, inject, capture, reply, open/close, abort. |
| `commands.ts` | `/wechat login|open|close|status|logout`. |
| `client.ts` | iLink HTTP client (QR, getupdates, sendmessage) with an injected runner. |
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
