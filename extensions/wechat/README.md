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
- **Remote prompts** — interactive confirmations raised during a WeChat turn
  (`ask_user_question`, plan approval) are sent to WeChat and answered there;
  turns started at the terminal keep the TUI (`remotePrompts`, on by default).
- **Status chip** — while the bridge runs, the status bar shows `✆ wechat`
  (`ctx.ui.setStatus`); it clears on stop, session expiry, or shutdown.
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

## Remote prompts

A dialog raised while a WeChat turn is in flight is forwarded to the sender:

- `select` — a numbered list; reply with a number, the option text, or any other
  text for the free-form “Other” entry.
- `confirm` — reply 是/否 (or yes/no).
- `input` / `editor` — reply with the text.
- Reply 取消 (or cancel) to dismiss.

The reply is consumed as the answer and never starts a turn of its own; a turn
started at the terminal keeps the normal TUI. Set `remotePrompts: false` to
disable forwarding. See [Design notes](#design-notes) for the mechanism.

## Outbound files

A remote prompt can deliver a local file first. `exit_plan_mode` uses this to
send the plan file itself before the three choices, so WeChat sees the whole plan
(a long one falls back to chunked text if the upload fails). The flow mirrors the
reference client: `getuploadurl` → AES-128-ECB encrypt → `POST` the ciphertext
(`Content-Type: application/octet-stream`) → read `x-encrypted-param` → send a
`type: 4` file item. Only the plan review uses it today; images, video, and voice
are not sent outbound.

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
  "typingIndicator": true,   // show typing while a turn is generated
  "remotePrompts": true      // answer interactive dialogs on WeChat during a WeChat turn
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
- Outbound **files** are supported (used by the plan review); outbound images,
  video, and voice are not, and `send_wechat` sends text only.
- Remote prompts cover the standard dialogs (`select`/`confirm`/`input`/`editor`).
  A third-party extension that renders a full-screen `ctx.ui.custom` component
  cannot be answered over WeChat; a WeChat turn sends it no UI and it should fall
  back to dialogs (see the shared `askHuman` helper).
- A peer can only be replied to after they have messaged first (the protocol
  supplies a `context_token` only then).

## Non-goals

Outbound image/video/voice media, video, model-callable sends to arbitrary recipients, per-peer
session isolation, group chats, a local quote cache, and a long-lived RPC child.

## Pi integration

| Integration point | Detail |
|---|---|
| Command | `pi.registerCommand("wechat", …)` — `login`, `start`, `stop`, `status`, `logout`. |
| Tools | `send_wechat` — owner-only proactive text; registered at factory time with `exposure: "direct"`, `executionMode: "sequential"`, `openWorldHint: true`. |
| Events | `session_start` (record the live context, re-point the UI adapter); `agent_start` / `agent_settled` (busy guard); `message_end` (capture assistant text); `session_shutdown` (idempotent stop, uninstall adapter). |
| Injection | `pi.sendUserMessage(content)` — a string, or text/image blocks for inbound media; always triggers a turn, and the bridge only injects when idle. |
| UI | `installRemoteUI(ctx.ui, channel)` wraps the shared `ctx.ui` dialogs and installs the channel under a string key; `askHuman` in `lib/interaction.ts` routes rich components vs dialogs and delivers a file/text preface. |
| Status | The bridge's running state is published through `onStateChange` to `ctx.ui.setStatus(STATUS_KEYS.wechat, …)`; the status bar renders it on line 2. |
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

Remote prompts reuse Pi's only in-process UI seam: there is no extension-facing
way to replace `ctx.ui`, so `remote-ui.ts` wraps the **shared** `ctx.ui` object
(`runner.uiContext`) and delegates to the saved originals when no WeChat turn is
in flight. The contract lives in `lib/interaction.ts`; `ask_user_question` and
plan mode call `askHuman`, which prefers a rich component only for a local TUI
turn. This depends on an unstated host detail, so it fails closed (prompts simply
stay local) rather than corrupting state; a future Pi UI-delegate API replaces
`remote-ui.ts` alone.

Outbound files use the CDN upload flow (`getuploadurl`, AES-128-ECB ciphertext,
`x-encrypted-param`) and reuse the same AES-128-ECB and key decoders as inbound
media; a failed upload returns false so `askHuman` can fall back to text rather
than blocking the dialog.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: gate, register the command and tool, wire the lifecycle events, build the bridge. |
| `bridge.ts` | The loop: poll, queue, inject, capture, reply, media, typing, open/close, abort. |
| `commands.ts` | `/wechat login|start|stop|status|logout`. |
| `tools.ts` | The `send_wechat` tool (owner-only proactive text). |
| `client.ts` | iLink HTTP client (QR, getupdates, sendmessage, file sendmessage, getuploadurl, getconfig, sendtyping, CDN download/upload) with an injected runner. |
| `media.ts` | Media key/encrypt/decrypt, padded size, upload/download URL, MIME sniff, filename sanitize, and save helpers. |
| `outbound.ts` | Upload and send a local file: hash, encrypt, `getUploadUrl`, upload, `sendFileMessage`. |
| `login.ts` | QR login state machine. |
| `qrcode.ts` | QR matrix → Unicode half-block terminal lines. |
| `login-screen.ts` | The `/wechat login` screen (`ctx.ui.custom`). |
| `config.ts` | `wechat.json` loading and normalization. |
| `credentials.ts` | `credentials.json` (`0600`, multi-account). |
| `state.ts` | `state.json` (cursor, owner, per-peer tokens). |
| `lock.ts` | Poller lockfile. |
| `format.ts` | Sanitize, chunk, and label helpers. |
| `interaction.ts` | The WeChat `InteractionChannel`: pending-prompt state machine and reply routing. |
| `prompt.ts` | Pure prompt formatting and reply parsing. |
| `remote-ui.ts` | The host-UI adapter: wraps the shared `ctx.ui` dialogs and installs the remote-turn marker. |
| `types.ts` | Wire and domain types. |

## Testing

`bun test extensions/wechat`. Modules take injected seams (HTTP runner, clock,
sleep, `pi`/context fakes); no test touches the network or a real session.
Inbound media is exercised with a locally encrypted fixture, so decryption is
tested without a CDN.
