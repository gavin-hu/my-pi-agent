# 8. Reference

Use this chapter when you know what you want and need the exact name. It is a
lookup, not a tutorial: every entry here is explained in an earlier chapter.

## Commands

### Planning and verification

| Command | What it does |
|---|---|
| `/plan` | Turn plan mode on or off |
| `/plan <task>` | Turn plan mode on and send the task |
| `/plan list` | List saved plans, newest first |
| `/plan review [path]` | Review a plan in the browser (comments only) |
| `Ctrl+Alt+P` | Toggle plan mode where the terminal sends the chord |
| `/check` | Run every detected check |
| `/check test` | Run the detected test command |
| `/check lint` | Run the detected lint command |
| `/check typecheck` | Run the detected typecheck command |
| `/check all` | Same as `/check` |

### Session memory and delegation

| Command | What it does |
|---|---|
| `/todos` | Show the to-do list |
| `/goal` | Show the current goal, or the usage when none is set |
| `/goal <text>` | Run the understanding and confirmation loop, then start |
| `/goal raw <text>` | Record exactly your words and start |
| `/goal set <text>` / `/goal edit <text>` | Change the goal without starting a run |
| `/goal set` / `/goal edit` | Edit the current goal without starting a run |
| `/goal done` / `/goal achieved` | Mark the goal achieved |
| `/goal clear` | Clear the goal |
| `/goal help` | Show the command usage |
| `/agents` | Inspect, collect, or cancel background helpers |
| `/jobs` | Open the job list |
| `/watch` | Open the watcher list |
| `/watch list` | List watchers |
| `/watch matches <id>` | Print one watcher's matching lines |
| `/watch logs <id>` | Print the raw output tail |
| `/watch stop <id>` | Stop one watcher |
| `/watch clear [all]` | Remove stopped watchers, or all with `all` |

### Worktrees, rewind, and memory

| Command | What it does |
|---|---|
| `/worktree` or `/worktree status` | Show the active worktree and managed worktrees |
| `/worktree enter [name]` | Enter a worktree, creating it if needed |
| `/worktree exit [--keep\|--remove]` | Leave the worktree |
| `/worktree prune` | Remove clean worktrees older than seven days |
| `/rewind` | Open the rewind timeline |
| `/review` | Review the latest turn's changes and revert files or hunks |
| `/memory` | Open the note picker |
| `/memory list` | Show every note and the counts |
| `/memory path` | Show the two store paths and the trust state |
| `/memory edit [project\|global]` | Open one store in the editor |
| `/memory reload` | Re-read the stores from disk |
| `/memory doctor` | Report counts, sizes, budget, and near-duplicates |
| `/memory clear [project\|global]` | Clear a scope after a confirmation |

### Web and files

| Command | What it does |
|---|---|
| `/browse [path]` | Start the read-only file browser, optionally at a subdirectory |
| `/browse status` | Print the root and URL, or say it is not running |
| `/browse stop` | Stop the browser server |
| `/open [path]` | Open a file, folder, or the working directory in its default app |
| `/open -r [path]` | Reveal a path in the file manager |

### WeChat

| Command | What it does |
|---|---|
| `/wechat` | Open the control screen, or print a one-line summary |
| `/wechat login` | Scan a QR code and start the bridge |
| `/wechat new` | Start a fresh terminal session |
| `/wechat status` | Show the control screen or the one-line summary |
| `/wechat pause` | Stop polling new messages |
| `/wechat resume` | Reacquire the account lock and poll again |
| `/wechat doctor` | Print the connection and queue report |
| `/wechat stop <peer>` | Stop that peer's running turn |
| `/wechat reset <peer>` | Start a fresh conversation for that peer |
| `/wechat history <peer> [n]` | Print recent messages (default 10, maximum 20) |
| `/wechat allow [peer]` | Add a refused sender to the project allow list |
| `/wechat logout` | Clear credentials and stop polling |
| `/wechat help` | List the subcommands |

### Control centre

| Command | What it does |
|---|---|
| `/bytefly` | Open the control centre on Extensions |
| `/bytefly <extension>` | Open it filtered to one extension |
| `/bytefly [extension] refresh` | Open the Extensions section and re-probe health |
| `/bytefly settings` | Open the Settings section |
| `/bytefly doctor [extension] [refresh]` | Print the health report |
| `/bytefly update` | Re-run the package update check |

### Launch flags and environment

| Entry | What it does |
|---|---|
| `pi --plan` | Start Pi in plan mode |
| `pi --worktree <name>` | Start Pi inside a worktree |
| `PI_DISABLED_EXTENSIONS=todo,job` | Load without the named extensions for one run |
| `PI_OFFLINE=1` | Skip the session's automatic update check |

## Keys

These keys work in most pack screens. A screen's own footer is authoritative;
some keys mean different things in an editor or a diff.

| Key | What it usually does |
|---|---|
| `↑` / `↓` or `j` / `k` | Move the selection or scroll one line |
| `PgUp` / `PgDn` | Move a page |
| `Home` / `End` or `g` / `G` | Jump to the start or end |
| `Enter` | Choose, open, or confirm |
| `Space` | Tick, toggle, or select |
| `Esc` | Go back, cancel, or close |
| `q` | Close a screen that has no unsaved action |
| `y` / `N` | Answer a yes/no confirmation |
| `Tab` | Switch scope or filter |
| `[` / `]` | Jump to the previous or next settings group |
| `r` | Refresh, rerun, or revert, depending on the screen |
| `x` | Clear, stop, or cancel, depending on the screen |
| `Ctrl+O` | Expand or collapse a long tool block |
| `Ctrl+C` | Clear the input line, or close a screen |
| `Ctrl+D` | Exit Pi when the input is empty |
| `?` | Show the shortcut sheet in a browser page |

## Files on disk

Everything the pack writes is listed here. All of it is safe to delete when you
no longer need it; deleting a settings file restores defaults.

| Location | What it is |
|---|---|
| `.pi/plans/` in the project | Plan files as Markdown |
| `.pi/worktrees/` in the project | Isolated worktrees; `index.json` is a disposable record |
| `.pi/subagents/` in the project | Optional helper transcripts, pruned by age and count |
| `.pi/memory.md` in the project | Project memory notes |
| `.pi/bytefly.json` in the project | Project-scope settings |
| `<agent-dir>/plans/` | Plans when Pi runs outside a git repository |
| `<agent-dir>/memory.md` | Global memory notes |
| `<agent-dir>/bytefly.json` | Global `bytefly.json` settings |
| `<agent-dir>/bytefly/update.json` | The cached update-check answer |
| `<agent-dir>/wechat/` | Credentials, conversations, media, and the poller lock |
| `<agent-dir>/jobs/<project>/` | Background job registries and log files |
| `<agent-dir>/settings.json` | Pi's own settings, including the package entry and app preferences |
| `refs/pi/rewind` in the project's git | Rewind snapshots; list them with `git for-each-ref refs/pi/rewind` |

`<agent-dir>` is Pi's agent directory, usually `~/.pi/agent`.

## Extensions and tools

The pack adds 17 extensions and 22 tools. `worktree` also re-registers Pi's path
tools so they follow the active root; those are replacements, not additions.

| Extension | Tools | Commands and flags |
|---|---|---|
| `plan` | `enter_plan_mode`, `write_plan`, `exit_plan_mode`, `set_plan_steps` | `/plan`, `/plan list`, `/plan review`, `--plan` |
| `check` | `run_check` | `/check` |
| `todo` | `todo` | `/todos` |
| `goal` | `goal` | `/goal` |
| `question` | `ask_user_question` (model-only) | — |
| `job` | `job` | `/jobs` |
| `watch` | `watch` | `/watch` |
| `subagent` | `subagent` | `/agents` |
| `worktree` | `enter_worktree`, `exit_worktree`, `prune_worktrees`, `list_worktrees` | `/worktree`, `--worktree` |
| `rewind` | — | `/rewind`, `/review` |
| `memory` | `memory` | `/memory` |
| `web-access` | `web_search`, `web_fetch` | — |
| `document` | `read_doc` | — |
| `file-browse` | — | `/browse` |
| `file-open` | `open_path` (codemode) | `/open` |
| `wechat` | `send_wechat` | `/wechat` |
| `bytefly` | `run_doctor` | `/bytefly` |

`open_path` is exposed to codemode scripts and is not active for the model by
default. `ask_user_question` is model-only: it is declared to the model but not
callable from a script.

## Related references

| Reference | What it covers |
|---|---|
| [Configuration](../configuration.md) | Every setting, its default, and its bounds |
| [Security](../security.md) | Trust boundaries for the shell, the loopback pages, and WeChat |
| [`extensions/<name>/README.md`](../../extensions/) | Each extension's full contract and design notes |
| [Architecture](../architecture.md) | The load path and runtime model for contributors |
| [Development](../development.md) | Setup, checks, and the release process |

---

[← Previous: 7. Troubleshooting](./troubleshooting.md) · [Guide home](./README.md)
