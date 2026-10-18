# Configuration

Most extensions need no configuration. Every setting that is configurable lives
in one shared document, `bytefly.json`, under a top-level section named for the
extension — bytefly itself owns `price`, `notify`, and `doctor`. The keys are
documented in each extension's own `README.md`.

## How config resolves

The same document is read from two locations and merged:

1. `<agent-dir>/bytefly.json` — the global document. `<agent-dir>` is Pi's agent
   directory (`PI_CODING_AGENT_DIR`, typically `~/.pi/agent`).
2. `<cwd>/.pi/bytefly.json` — the project document. `<cwd>` is the effective
   working directory, so this follows a `worktree` root.

Project values override global ones. Missing documents and malformed JSON are
ignored, so a broken config never blocks a session; `/bytefly doctor` reports a document
that fails to parse. The `chrome`, `notify`, `doctor`, and `price` sections each
have rows in `/bytefly settings`, which writes one leaf into the selected scope —
the file remains the source of truth and a hand edit is still valid.

```json
{
  "$schema": "https://raw.githubusercontent.com/gavin-hu/my-pi-agent/main/assets/bytefly.schema.json",
  "version": 1,
  "price": { "currency": { "symbol": "¥", "decimals": 2 } },
  "notify": { "enabled": true },
  "chrome": { "rail": "│" },
  "job": { "wakeOnFinish": true },
  "memory": { "maxInjectBytes": 16384 }
}
```

`$schema` and `version` are metadata; the loaders ignore them. `version` is not
required and defaults to `1`.

## Section index

One top-level key per extension. `worktree` reads its project document from the
repository root rather than the active working directory.

| Extension | Section | Covers |
|---|---|---|
| [`bytefly`](../extensions/bytefly/) | `price`, `notify`, `doctor`, `chrome` | Cost rates/currency/peak schedule, OS notifications, diagnostics settings, and the transcript rail glyph. |
| [`document`](../extensions/document/) | `document` | Read limits, enabled formats. |
| [`file-browse`](../extensions/file-browse/) | `file-browse` | Server port and page limits. |
| [`goal`](../extensions/goal/) | `goal` | Widget behaviour, such as keeping an achieved goal visible. |
| [`job`](../extensions/job/) | `job` | Log-tail size and other job limits. |
| [`watch`](../extensions/watch/) | `watch` | Watch limits, wake behaviour, and poll interval. |
| [`memory`](../extensions/memory/) | `memory` | Note injection limits. |
| [`rewind`](../extensions/rewind/) | `rewind` | Snapshot scope and retention. |
| [`todo`](../extensions/todo/) | `todo` | Widget behaviour. |
| [`web-access`](../extensions/web-access/) | `web-access` | Search provider and fetch limits (`search` and `fetch` groups). |
| [`wechat`](../extensions/wechat/) | `wechat` | Bridge, media, and peer-feedback settings. |
| [`worktree`](../extensions/worktree/) | `worktree` | Worktree directory name and behaviour. |

`plan`, `question`, `subagent`, and `file-open` read no configuration.

## JSON Schema

[`assets/bytefly.schema.json`](../assets/bytefly.schema.json) describes the
document and every section. Point `$schema` at it for editor completion and
validation:

```json
{ "$schema": "https://raw.githubusercontent.com/gavin-hu/my-pi-agent/main/assets/bytefly.schema.json" }
```

## Migrating from the old per-extension files

Before the shared document, each extension read its own `<name>.json`
(`document.json`, `jobs.json`, `web-access.json`, …). Run the migration once per
machine and per repository:

```bash
bun run config:migrate --project <repo-root>   # add --dry-run to preview, --keep to keep the old files
```

It moves each legacy file into its section, moves bytefly's former top-level
`currency`/`rates`/`peak` under `price`, stamps `version` and `$schema`, and
deletes the legacy files. It skips an existing section and refuses to touch a
malformed document, so it is safe to re-run.

## State

The `wechat` extension also keeps state under `<agent-dir>/wechat/`:
`credentials.json` (mode `0600`, every stored account plus the active one),
`state.json` (the poll cursor, the owner, per-peer reply tokens, and the recent
message ids used to ignore a replay), `media/` (downloaded inbound files), and
`poller.lock` (one runtime owns the account at a time). This is login and runtime
state, not user configuration.

## Environment variables

| Variable | Owner | Meaning |
|---|---|---|
| `PI_DISABLED_EXTENSIONS` | this package | A comma- or whitespace-separated list of extension names to load without. Compared case-insensitively; unknown names are ignored. |
| `PI_WORKTREE_ROOT` | `worktree` | The effective working directory while a worktree is active. |
| `PI_WORKTREE_BRANCH` | `worktree` | The worktree's branch name. |
| `PI_WORKTREE_MAIN` | `worktree` | The main checkout path, used by exit and prune. |
| `PI_CODING_AGENT_DIR` | Pi | The agent directory the global config file resolves against. |
| `PI_OFFLINE` | Pi | Turns off Pi's automatic network activity; `bytefly`'s update check reads it too, so an offline session makes no version request. |

`PI_WORKTREE_*` are set by the `worktree` extension for the session and its
child processes; you normally never set them by hand.

## Disabling extensions

See [Getting started → Disabling extensions](./getting-started.md#disabling-extensions).
