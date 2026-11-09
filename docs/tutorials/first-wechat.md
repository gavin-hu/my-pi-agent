# Chat with your session from WeChat

The bridge connects one WeChat account to one Pi session. A message you send
from your phone starts a turn in the terminal session, and its answer streams
back to the chat — one transcript, one context, one toolset.

You need Pi and this package installed — see [Install](../install.md).

## Pair the account

```text
/wechat login
```

A QR code appears in the terminal; scan it with WeChat. The account is stored and
nothing else happens — the bridge never opens by itself.

```text
/wechat start
```

That binds this session to the account and starts polling. From then on, a
message to the bot is a turn in this session; `/wechat status` shows the account
and `Connection open` on the control screen.

## Talk to it

Send what you would type:

```text
refactor the uploader and push a branch when the tests pass
```

- An answer arrives as it is written, in plain chat text — Markdown markers are
  flattened, and a long reply is split into numbered parts.
- A **photo** arrives as an image the model can see, a **file** is saved and
  referred to by path, and a **voice note** uses WeChat's own transcript.
- While a turn runs the chat shows a typing indicator, so a long answer does not
  look like a dead bridge.

## Answer it from the phone

Anything the session needs a decision on is asked in the chat, numbered:

- a `question`'s options;
- a plan review — the plan, a digest, then one numbered question with approve,
  keep planning, exit, or revise;
- a tool's confirmation dialog.

A reply goes to that prompt alone, so you can settle a review from a bus. The
chat also takes `/stop`, `/cancel`, `/status`, `/history`, and `/help` without
spending a turn on them.

## Ask it to message you

The model can send you something on its own:

```text
send me the test summary when the build finishes
```

That is the `send_wechat` tool — one text, one local image as a picture, or one
local file as a document, always to the account's owner, because the recipient is
not a parameter.

## Stop, and start again

```text
/wechat stop
```

Polling stops, a running turn is cut off with a notice, and the lock is released.
The binding belongs to the session branch, so `/resume` reopens it; `/wechat
logout` discards the account entirely.

If the token expires the status bar keeps `✆ wechat expired`: run `/wechat login`
and then `/wechat start`.

## Where to go next

- [`wechat`](../extensions/wechat.md) — every command, the control screen, and
  the settings.
- [`plan`](../extensions/plan.md) — the review you can approve from the chat.
- [Security](../security.md) — what the stored account can reach.
