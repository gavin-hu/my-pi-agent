# A minimal install

Every extension in the pack is on by default, and none of them has to be. This page
is how to decide what to keep: what a part costs while it is on, what switching it
off takes away, and the three ways to switch it off. Adding, upgrading, and
removing the package itself is [Install](./install.md).

## Three ways off

- **One checkbox.** `Space` on an extension's row in `/bytefly` turns it off; `s`
  switches the scope, so a row can be off for this project only, and `x` drops
  that project override again.
- **For one run.** `PI_DISABLED_EXTENSIONS=todo,job pi` loads the pack without
  those extensions. Names are comma- or whitespace-separated, compared
  case-insensitively, and an unknown name is ignored; nothing is written.
- **The whole package.** Pi's `--no-extensions` loads no extension at all, this
  pack's included, and `pi remove npm:@gavin-hu/my-pi-agent` uninstalls the pack.

## What a part costs while it is on

| Cost | What brings it | Without it |
|---|---|---|
| a loopback port, bound while a page is open | `serve`, with `file-browse`, `board`, and a plan review on it | `/browse`, `/board`, and the browser review |
| a child `pi` process per delegation | `subagent` | delegation |
| a branch and a `git` call | `worktree`, `rewind` | isolation and snapshots |
| a network request | `web-access`, and `bytefly`'s once-a-session update check | search, fetch, and the update notice |
| an OS notification channel | `notify` | desktop alerts |
| a WeChat account, long-polled | `wechat` | the chat bridge |
| state under `<agent-dir>` | `memory`, `board`, `plan`, `session-bus`, `job` | what each keeps between runs |

`PI_OFFLINE` turns off the update check alone, without switching `bytefly` off.

## Pick a shape

| If you want | Keep | Turn off |
|---|---|---|
| plan first, change nothing by accident | `plan`, `todo`, `goal`, `question` | the browser surfaces, `wechat`, `subagent` |
| one window, hand edits, a safe undo | `plan`, `worktree`, `rewind` | `serve`, `file-browse`, `board`, `team`, `session-bus` |
| read, search, and open files | `file-browse`, `file-read`, `file-open`, `web-access` | `board`, `team`, `session-bus`, `job`, `watch` |
| a team on one repository | `session-bus`, `board`, `team`, `serve` | `wechat`, `web-access`, `subagent` |
| answer the session from the phone | `wechat`, `serve`, `plan` | `file-browse`, `web-access`, `job` |

The rows name the parts a shape needs to work, not every part that is pleasant
beside it: `todo` and `memory` cost nothing but their own files, and turning either
off takes only its rail and its notes out of the session.

## What switching one off costs

- **A missing part says so.** A page whose extension is switched off refuses with
  a sentence naming the extension rather than binding a rival socket, and once a
  session is running `/bytefly doctor` reports the extension as disabled instead of
  probing it.
- **The files stay.** Settings live in `bytefly.json`, and notes, cards, plans, and
  jobs are files under the agent directory, so switching an extension back on
  finds what it saw before.
- **Some parts need another.** `team` and the board's page run on `session-bus` and
  `serve`; with `session-bus` off, every coordination surface goes with it,
  including the cards.

## Learn more

- [Install](./install.md) — adding the pack, pinning a release, upgrading, removing.
- [`bytefly`](./extensions/bytefly.md) — the control center, the checkbox rows, and `doctor`.
- [All extensions](./extensions/README.md) — what each one does before you decide.
- [Several sessions](./multi-session.md) — the shape that needs the most of it.
