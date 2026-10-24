# 5. Using it from WeChat

This chapter connects the live Pi session to a WeChat bot account, so you can
send a message from your phone and get an answer from the same assistant, with
the same tools and memory. Each person you admit gets a private conversation,
separate from your terminal session and from every other peer.

**Use this chapter when** you want to check on a long task from your phone, hand
a colleague a narrow slice of the assistant, or keep a conversation going away
from the desk.

## Before you start

You need a WeChat bot account for the Weixin iLink API, and an interactive
terminal for the first login, because the QR code is drawn there. The bridge
does not start in JSON or print mode; an RPC session can print its status, but it
cannot show the QR screen.

The bridge is off until you log in. Once an account is stored, it starts
automatically with every session and stops when the process exits.

> **Treat this as remote control of your session.** An admitted peer's text
> becomes a turn with that session's tools, including the shell and the file
> tools. The default is owner-only for that reason. Read
> [Security](#security-and-limits) before you add a peer.

## Log in

1. Run:

   ```text
   /wechat login
   ```

   A QR code appears in the terminal. Scan it with WeChat.

2. The account is stored and the bridge starts polling. The footer shows
   `✆ wechat` while it runs.

3. Send the bot a message from your phone. The reply arrives with a typing
   indicator. Text, photos, files, and voice notes with a transcript work; a
   photo is passed to the model as an image, and a file is saved and referenced
   by its path.

If the login expires, the footer keeps `✆ wechat expired` until you reconnect.
`/wechat doctor` reports the connection state, token age, and recent failures;
`/wechat login` is the one-step recovery.

## What the peer experiences

The bridge carries the signals a chat window needs, without inventing small talk:

| The peer does this | The bridge does this |
|---|---|
| Sends a message | Starts the typing indicator and sends the answer when the turn settles |
| Sends several messages quickly | Sends one acknowledgement at most, then one answer covering the burst in order |
| Waits behind a long turn | Refreshes typing, says the turn is queued after four seconds, and at thirty seconds names `/stop` as the way out |
| Sends while another peer's turn runs | Says the message is queued after four seconds, then again at a minute |
| Sends a photo or file | Passes it to the model; an attachment that cannot be read is named in the answer |
| Sends a voice note or video | Says voice without a transcript and video are not supported |
| Is asked a question | Gets a numbered prompt; `yes`/`确定` or `no`/`不是` answers, `取消` dismisses |
| Floods the chat | Is asked to wait once the queue passes eight messages |
| Pastes a very long message | The first 8,000 characters reach the model, followed by a truncation marker |
| Gets an aborted turn | Is told the turn stopped |

Replies stream as they are produced: one part per paragraph, after two silent
seconds, or at 400 characters, whichever comes first. Markdown markers are
flattened to plain chat text, while code-block bodies survive. A single part
longer than the reply limit is numbered and split again.

## The control screen

In the terminal, `/wechat` opens a control screen with the account, connection,
owner, waiting senders, and one row per conversation showing what each peer is
doing and what is queued behind it.

| Key | What it does |
|---|---|
| `j` / `k` or the arrows | Choose a conversation |
| `s` | Stop that conversation's running turn |
| `d` | Start a fresh conversation with that person |
| `h` | Close the screen and print that conversation's history |
| `a` | Review senders who were refused, and allow them |
| `c` | Withdraw a question that is waiting for an answer |
| `p` | Pause or resume polling |
| `l` | Log in or reconnect |
| `n` | Start a new terminal session |
| `o` | Log out |
| `r` | Refresh |
| `Esc` | Close the screen |

<img src="../../assets/wechat.png" alt="The /wechat control screen: account and connection at the top, peer and queued rows, conversation rows, and the key hints" width="100%">

*The control screen while a peer turn runs; the footer names each key.*

The same actions are available as subcommands, which are the only route outside
the terminal interface:

| Command | What it does |
|---|---|
| `/wechat` | Open the control screen, or print a one-line summary elsewhere |
| `/wechat login` | Scan a QR code, store the account, and start the bridge |
| `/wechat new` | Start a fresh terminal session; peer conversations survive |
| `/wechat status` | Show the control screen, or the one-line summary during a peer turn |
| `/wechat pause` | Stop polling new messages; a running turn may finish and reply |
| `/wechat resume` | Reacquire the account lock and poll again |
| `/wechat doctor` | Print connection, token, lock, queue, and failure details |
| `/wechat stop <peer>` | Stop that peer's running turn |
| `/wechat reset <peer>` | Start a fresh conversation for that peer |
| `/wechat history <peer> [n]` | Print recent messages (default 10, maximum 20) |
| `/wechat allow [peer]` | Add a refused sender to the project's allow list |
| `/wechat logout` | Confirm, clear credentials, and stop polling |
| `/wechat help` | List the subcommands |

A peer can use `/new`, `/stop`, `/status`, `/history`, and `/help` in the chat.
These are answered by the bridge and never become a model turn, and they work
while a dialog is waiting for an answer — the dialog holds the model, so a
command is matched first and `/status` names the question, `/stop` ends the turn.
Unknown slash commands are passed through.

## Conversations, sessions, and state

- A conversation per peer is persisted under `<agent-dir>/wechat/sessions/<peer>/`
  and resumed on the next message. It is disposed after thirty minutes idle.
- Turns run one at a time across peers by default, so a forwarded dialog has a
  single owner. A queued message is acknowledged, not dropped.
- A peer turn never mixes into the terminal conversation. The terminal's own
  dialogs stay in the terminal.
- Pause is per runtime: it releases the poller lock so another Pi process can
  take the account. Resume reacquires it and reports when another process holds
  it.
- While a peer turn is running, the terminal's `/wechat login`, `logout`, and
  `new` decline, because each would drop or replace the connection mid-answer.
  `status` prints the short summary instead. `pause` is the way to stop new
  messages.
- Conversations, downloaded media, credentials, and the poller lock live in
  `<agent-dir>/wechat/`. Credentials are written with owner-only permissions.
  See [Files on disk](./reference.md#files-on-disk).

## Asking you from WeChat

A dialog raised inside a WeChat turn is forwarded to the sender rather than to
the terminal: a question, a plan approval, a confirmation. The peer answers in
the chat with a number, the option text, `yes`/`确定`, `no`/`不是`, or `取消` to
dismiss.

An unanswered prompt is nudged halfway and then cancelled at the end of its
window — three minutes for a dialog, ten for a plan review — so an ignored dialog
cannot freeze the conversation. A plan review sends the plan file first, then one
compact prompt; the file stays on disk, and its text is posted instead if the
upload fails. A prompt
that goes away before it is answered (a pause, a `/stop`, a shutdown) says it was
withdrawn rather than claiming the peer timed out. A prompt that cannot be shown
is answered as cancelled; the peer turn still runs.

## Sending you a message

The assistant can message the account owner proactively with `send_wechat` — for
example to report a long job, or to send a plot or screenshot as a picture. It
only ever sends to you, never to an admitted peer, and it takes one text or one
local image. Its text is refused while a turn with you is in flight, so an answer
cannot arrive twice; an image is allowed then, because the bridge never produces
one.

## Security and limits

- **Owner-only by default.** Only the account that scanned the login can drive
  the assistant. `allowedPeers` opts in others, and `peers[<id>].tools` can give
  an admitted peer a narrower tool list than the session has.
- **Refused senders are counted, not run.** Their ids appear in the control
  screen and in one terminal notice, so you can allowlist the right one.
- **Inbound content is untrusted.** Text is sanitized before it reaches the
  transcript. Images become model image content; files are saved with sanitized
  names under a size cap and are never executed.
- **The bridge is a single poller.** A lock stops two Pi processes from polling
  one account and stealing each other's messages. Pausing releases it
  deliberately.
- **A reply can take one long-poll cycle.** The server holds each update request
  for roughly 18 seconds, so even an instant answer is not instantaneous. A
  reply is delivered when the run settles, not token by token.
- **The bridge has no persistent on switch.** Logging out is the only way to stop
  it. Logging out discards the credentials; the peer conversations remain on
  disk.
- **Automated or unofficial WeChat use can violate WeChat's terms and risk
  account restriction.** Single-owner, low-volume use is the intended shape.
- The `wechat` section of `bytefly.json` controls the allowlist, per-peer tools,
  hour limits, reply size, inbound size, typing, and remote prompts. See
  [Configuration](../configuration.md#wechat--the-wechat-bridge).

## Related

- [Troubleshooting](./troubleshooting.md#wechat-stopped-answering) — an expired login, a busy bridge, and quiet replies.
- [Security](../security.md) — the remote trust boundary.
- [Reference](./reference.md#commands) — every WeChat subcommand on one page.

---

[← Previous: 4. Web and files](./web-and-files.md) · [Guide home](./README.md) · [Next: 6. Settings and customization →](./settings-and-customization.md)
