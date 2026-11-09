# Troubleshooting — start from what you see

Every page here has a Limits section for the failures of its own surface. This is the index to
them: the sentence your terminal printed, why it happened, the fix, and the page that owns the
detail. Match the sentence before the explanation — the row is written from the wording the
shipped code uses.

| What you see | Why | Fix | Detail |
|---|---|---|---|
| `this session has no port` when you open a page | `serve` is switched off, so this session binds no server; every page refuses rather than binding a rival socket | toggle `serve` in `/bytefly`, then run the command again | [`serve`](./extensions/serve.md) |
| `port N is in use — change "port" in the bytefly.json serve section, or stop what answers on it` | `serve.port` pins one number for the session, and another process holds that number | free the port, or set `serve.port` back to `0` so the session picks one | [`serve`](./extensions/serve.md), [configuration keys](./configuration-reference.md#serve--the-sessions-page-server) |
| the chip keeps `✆ wechat expired` | the stored reply token expired, so the account cannot be answered any more | `/wechat login` and scan, then `/wechat start` | [`wechat`](./extensions/wechat.md) |
| `/bytefly doctor` prints `env disabled` for a row | `PI_DISABLED_EXTENSIONS` names that extension, so it is never loaded, and a disabled row is not probed | drop the name from the variable and restart the session | [`bytefly`](./extensions/bytefly.md), [configuration](./configuration.md#environment-variables) |
| `Its contract is signed by the lead, who does not hold it.` on `approve`, or the same about a spot-check on `review` | a session cannot sign a card it holds: the gate would be approving itself | the lead releases the card and signs it, or the person signs with `/board approve <id>` or `/board review <id>` | [`board`](./extensions/board.md) |

## If no row fits

`run_doctor` — or `/bytefly doctor` in the session — reports what each enabled extension needs at
runtime and what is missing, which is the first thing to read when the symptom is not in the
table. A surface that draws wrong, or a finding that names a binary you know you have, is worth an
[issue](https://github.com/gavin-hu/my-pi-agent/issues) with the sentence it printed: each message
above names the setting or the extension it is about, and an issue that carries it needs no
translation.

## Learn more

- [Install](./install.md) — requirements, pinning a release, and the doctor run after a fresh install.
- [`bytefly`](./extensions/bytefly.md) — the doctor, the control center, and the switches.
- [A minimal install](./minimal-install.md) — what each part costs while it is on.
