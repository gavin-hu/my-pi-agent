# Configuration

Most extensions need no configuration. This page explains how settings are
resolved and indexes the files each extension reads. The keys themselves are
documented in each extension's own `README.md`.

## How config files resolve

An extension that reads configuration loads the same file name from two places
and merges them, project last:

1. `<agent-dir>/<name>.json` — the global file. `<agent-dir>` is Pi's agent
   directory (`PI_CODING_AGENT_DIR`, typically `~/.pi/agent`).
2. `<cwd>/.pi/<name>.json` — the project file. `<cwd>` is the effective working
   directory, so this follows a `worktree` root.

Project values override global ones. Missing files and malformed JSON are
ignored, so a broken config never blocks a session; `/doctor` reports a file
that fails to parse.

## Per-extension config index

| Extension | File | Notes |
|---|---|---|
| [`bytefly`](../extensions/bytefly/) | `bytefly.json` | Per-model price rates and an optional peak/off-peak schedule. |
| [`bytefly`](../extensions/bytefly/) | `doctor.json` | Diagnostics settings. |
| [`document`](../extensions/document/) | `document.json` | Read limits and defaults. |
| [`file-browse`](../extensions/file-browse/) | `file-browse.json` | Server port and page limits. |
| [`goal`](../extensions/goal/) | `goal.json` | Widget behaviour, such as keeping an achieved goal visible. |
| [`job`](../extensions/job/) | `jobs.json` | Log-tail size and other job limits. |
| [`memory`](../extensions/memory/) | `memory.json` | Note limits. |
| [`rewind`](../extensions/rewind/) | `rewind.json` | Snapshot scope and retention. |
| [`todo`](../extensions/todo/) | `todo.json` | Widget behaviour. |
| [`web-access`](../extensions/web-access/) | `web-access.json` | Search provider and fetch limits. |
| [`wechat`](../extensions/wechat/) | `wechat.json` | Bridge and media settings. |
| [`worktree`](../extensions/worktree/) | `worktree.json` | Worktree directory name and behaviour. |

`plan`, `question`, `subagent`, and `file-open` read no config file.

The `wechat` extension also keeps state under `<agent-dir>/wechat/`:
`credentials.json` (mode `0600`, multi-account) and a message state file. This
is login state, not user configuration.

## Environment variables

| Variable | Owner | Meaning |
|---|---|---|
| `PI_DISABLED_EXTENSIONS` | this package | A comma- or whitespace-separated list of extension names to load without. Compared case-insensitively; unknown names are ignored. |
| `PI_WORKTREE_ROOT` | `worktree` | The effective working directory while a worktree is active. |
| `PI_WORKTREE_BRANCH` | `worktree` | The worktree's branch name. |
| `PI_WORKTREE_MAIN` | `worktree` | The main checkout path, used by exit and prune. |
| `PI_CODING_AGENT_DIR` | Pi | The agent directory the global config files resolve against. |

`PI_WORKTREE_*` are set by the `worktree` extension for the session and its
child processes; you normally never set them by hand.

## Disabling extensions

See [Getting started → Disabling extensions](./getting-started.md#disabling-extensions).
