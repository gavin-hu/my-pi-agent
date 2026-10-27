# Reference

Use this chapter when you know what you want and need the exact name. It is a
lookup, not a tutorial: every entry here is explained in an earlier chapter.

## Commands

Every command the pack adds, with what it does and where its walkthrough is.

### Planning and verification

| Command | What it does | Where explained |
|---|---|---|
| `/plan` | Turn plan mode on or off | [Plan first, then write](./plan-and-verify.md#plan-first-then-write) |
| `/plan <task>` | Turn plan mode on and send the task | [Plan first, then write](./plan-and-verify.md#plan-first-then-write) |
| `/plan list` | List saved plans with the store's size and its oldest plan, newest first | [Plan first, then write](./plan-and-verify.md#plan-first-then-write) |
| `/plan review [path]` | Review a plan in the browser (comments only) | [Plan first, then write](./plan-and-verify.md#plan-first-then-write) |
| `/plan share` | Print the newest reviewer link and its QR while a browser review is open | [Plan first, then write](./plan-and-verify.md#plan-first-then-write) |
| `/plan share stop` | Revoke every reviewer link and stop sharing | [Plan first, then write](./plan-and-verify.md#plan-first-then-write) |
| `Ctrl+Alt+P` | Toggle plan mode where the terminal sends the chord | [Plan first, then write](./plan-and-verify.md#plan-first-then-write) |
| `/check` | Run every detected check | [Checking your work](./plan-and-verify.md#checking-your-work) |
| `/check test` | Run the detected test command | [Checking your work](./plan-and-verify.md#checking-your-work) |
| `/check lint` | Run the detected lint command | [Checking your work](./plan-and-verify.md#checking-your-work) |
| `/check typecheck` | Run the detected typecheck command | [Checking your work](./plan-and-verify.md#checking-your-work) |
| `/check all` | Same as `/check` | [Checking your work](./plan-and-verify.md#checking-your-work) |

### Skills

Every packaged skill is model-invoked, so a matching request loads it;
`/skill:<name>` forces it, and the words after the command are the request.

| Command | What it does | Where explained |
|---|---|---|
| `/skill:init` | Create or update the effective instruction file (`AGENTS.md` or `AGENTS.override.md`) through a built-in interview and reviewed plan | [Initializing AGENTS.md with /skill:init](./packaged-workflows.md#initializing-agentsmd-with-skillinit) |
| `/skill:next` | Suggest the next todos by priority, with the evidence and the starting command for each | [Choosing what to do next](./packaged-workflows.md#choosing-what-to-do-next) |
| `/skill:project-docs` | Audit a project's documents against the tree, then record a changelog bullet, curate a release, renumber the roadmap, or sync the front door | [Keeping the docs honest](./packaged-workflows.md#keeping-the-docs-honest) |
| `/skill:refactor` | Audit a project or path for refactoring opportunities, without editing anything | [Finding refactoring opportunities](./packaged-workflows.md#finding-refactoring-opportunities) |

### Session memory and delegation

| Command | What it does | Where explained |
|---|---|---|
| `/todos` | Show the to-do list | [A to-do list and a goal](./track-and-remember.md#a-to-do-list-and-a-goal) |
| `/goal` | Show the current goal, or the usage when none is set | [A to-do list and a goal](./track-and-remember.md#a-to-do-list-and-a-goal) |
| `/goal <text>` | Run the understanding and confirmation loop, then start | [A to-do list and a goal](./track-and-remember.md#a-to-do-list-and-a-goal) |
| `/goal raw <text>` | Record exactly your words and start, skipping the loop | [A to-do list and a goal](./track-and-remember.md#a-to-do-list-and-a-goal) |
| `/goal set <text>` / `/goal edit <text>` | Change the goal without starting a run | [A to-do list and a goal](./track-and-remember.md#a-to-do-list-and-a-goal) |
| `/goal set` / `/goal edit` | Open the editor prefilled with the current goal | [A to-do list and a goal](./track-and-remember.md#a-to-do-list-and-a-goal) |
| `/goal done` / `/goal achieved` | Mark the goal achieved | [A to-do list and a goal](./track-and-remember.md#a-to-do-list-and-a-goal) |
| `/goal clear` | Clear the goal | [A to-do list and a goal](./track-and-remember.md#a-to-do-list-and-a-goal) |
| `/goal help` | Show the command usage | [A to-do list and a goal](./track-and-remember.md#a-to-do-list-and-a-goal) |
| `/agents` | Inspect, collect, or cancel background helpers | [Delegating to specialist helpers](./delegate-and-background.md#delegating-to-specialist-helpers) |
| `/jobs` | Open the job list | [Background jobs and watchers](./delegate-and-background.md#background-jobs-and-watchers) |
| `/watch` | Open the watcher list | [Background jobs and watchers](./delegate-and-background.md#background-jobs-and-watchers) |
| `/watch list` | List watchers | [Background jobs and watchers](./delegate-and-background.md#background-jobs-and-watchers) |
| `/watch matches <id>` | Print one watcher's matching lines | [Background jobs and watchers](./delegate-and-background.md#background-jobs-and-watchers) |
| `/watch logs <id>` | Print the raw output tail | [Background jobs and watchers](./delegate-and-background.md#background-jobs-and-watchers) |
| `/watch stop <id>` | Stop one watcher | [Background jobs and watchers](./delegate-and-background.md#background-jobs-and-watchers) |
| `/watch clear [all]` | Remove stopped watchers, or every watcher with `all` | [Background jobs and watchers](./delegate-and-background.md#background-jobs-and-watchers) |
| `/context` | Show where the context window goes; `c` compacts from the report | [Seeing where the context goes](./track-and-remember.md#seeing-where-the-context-goes) |
| `/context compact [instructions]` | Compact from the report; refused while a turn is running | [Seeing where the context goes](./track-and-remember.md#seeing-where-the-context-goes) |
| `/sessions` | Open the bus board: `Tab` between sessions, unread mail, and path claims; `w` starts or stops listening, which is also how a session there joins; `x` releases your own claim | [Coordinating parallel sessions](./delegate-and-background.md#coordinating-parallel-sessions) |
| `/board` | Open the shared board in a local browser; `team`, `status`, and `stop` are its words | [Sharing a board](./delegate-and-background.md#sharing-a-board) |
| `/board team` | Open the page on its Team tab | [Sharing a board](./delegate-and-background.md#sharing-a-board) |
| `/board status` | Print one line about the page, and the join this session's `/board` made | [Sharing a board](./delegate-and-background.md#sharing-a-board) |
| `/board stop` | Close the page this session serves; a page another session serves is that session's to stop | [Sharing a board](./delegate-and-background.md#sharing-a-board) |
| `/team` | Print the lead's round: what needs a decision, who holds what, then who is live | [Sharing a board](./delegate-and-background.md#sharing-a-board) |
| `/team join [<label>]` | Put this session on the team under that label, listening for mail | [Sharing a board](./delegate-and-background.md#sharing-a-board) |

### Worktrees, rewind, and memory

| Command | What it does | Where explained |
|---|---|---|
| `/worktree` | Open the worktree screen: managed worktrees, their state, and their gaps | [Working on a branch safely](./keep-work-safe.md#working-on-a-branch-safely) |
| `/worktree enter [name]` | Enter a worktree, creating it if needed | [Working on a branch safely](./keep-work-safe.md#working-on-a-branch-safely) |
| `/worktree exit` | Leave the worktree; a clean one is removed, one holding work asks | [Working on a branch safely](./keep-work-safe.md#working-on-a-branch-safely) |
| `/worktree prune` | Remove clean worktrees older than seven days | [Working on a branch safely](./keep-work-safe.md#working-on-a-branch-safely) |
| `/rewind` | Open the rewind timeline | [Undoing a turn](./keep-work-safe.md#undoing-a-turn) |
| `/review` | Review the latest turn's changes and revert files or hunks | [Reviewing the last turn](./keep-work-safe.md#reviewing-the-last-turn) |
| `/memory` | Open the note picker | [Remembering between sessions](./track-and-remember.md#remembering-between-sessions) |
| `/memory list` | Show every note and the counts | [Remembering between sessions](./track-and-remember.md#remembering-between-sessions) |
| `/memory path` | Show the two store paths and the trust state | [Remembering between sessions](./track-and-remember.md#remembering-between-sessions) |
| `/memory edit [project\|global]` | Open one store in the editor | [Remembering between sessions](./track-and-remember.md#remembering-between-sessions) |
| `/memory reload` | Re-read the stores from disk | [Remembering between sessions](./track-and-remember.md#remembering-between-sessions) |
| `/memory doctor` | Report counts, sizes, budget, and near-duplicates | [Remembering between sessions](./track-and-remember.md#remembering-between-sessions) |
| `/memory clear [project\|global]` | Clear a scope after a confirmation | [Remembering between sessions](./track-and-remember.md#remembering-between-sessions) |

### Web and files

| Command | What it does | Where explained |
|---|---|---|
| `/browse [path]` | Start the read-only file browser, optionally at a subdirectory | [Browsing a project](./web-and-files.md#browsing-a-project) |
| `/browse status` | Print the root and URL, or say it is not running | [Browsing a project](./web-and-files.md#browsing-a-project) |
| `/browse stop` | Stop the browser server | [Browsing a project](./web-and-files.md#browsing-a-project) |
| `/open [path]` | Open a file, folder, or the working directory in its default app | [Opening a file in its usual application](./web-and-files.md#opening-a-file-in-its-usual-application) |
| `/open -r [path]` | Reveal a path in the file manager | [Opening a file in its usual application](./web-and-files.md#opening-a-file-in-its-usual-application) |

### WeChat

| Command | What it does | Where explained |
|---|---|---|
| `/wechat` | Open the control screen, or print a one-line summary | [The control screen](./wechat.md#the-control-screen) |
| `/wechat login` | Scan a QR code and start the bridge | [The control screen](./wechat.md#the-control-screen) |
| `/wechat new` | Start a fresh terminal session; peer conversations survive | [The control screen](./wechat.md#the-control-screen) |
| `/wechat status` | Show the control screen or the one-line summary | [The control screen](./wechat.md#the-control-screen) |
| `/wechat pause` | Stop polling new messages | [The control screen](./wechat.md#the-control-screen) |
| `/wechat resume` | Reacquire the account lock and poll again | [The control screen](./wechat.md#the-control-screen) |
| `/wechat doctor` | Print the connection and queue report | [The control screen](./wechat.md#the-control-screen) |
| `/wechat stop <peer>` | Stop that peer's running turn | [The control screen](./wechat.md#the-control-screen) |
| `/wechat reset <peer>` | Start a fresh conversation for that peer | [The control screen](./wechat.md#the-control-screen) |
| `/wechat history <peer> [n]` | Print recent messages (default 10, maximum 20) | [The control screen](./wechat.md#the-control-screen) |
| `/wechat allow [peer]` | Add a refused sender to the project allow list | [The control screen](./wechat.md#the-control-screen) |
| `/wechat logout` | Confirm, then clear credentials and stop polling | [The control screen](./wechat.md#the-control-screen) |
| `/wechat help` | List the subcommands | [The control screen](./wechat.md#the-control-screen) |

### Control centre

| Command | What it does | Where explained |
|---|---|---|
| `/bytefly` | Open the control centre on Extensions | [The control centre](./settings-and-customization.md#the-control-centre) |
| `/bytefly <extension>` | Open it filtered to one extension | [The control centre](./settings-and-customization.md#the-control-centre) |
| `/bytefly [extension] refresh` | Open the Extensions section and re-probe health | [The control centre](./settings-and-customization.md#the-control-centre) |
| `/bytefly settings` | Open the Settings section | [The control centre](./settings-and-customization.md#the-control-centre) |
| `/bytefly skills` | Open the Skills section | [The control centre](./settings-and-customization.md#the-control-centre) |
| `/bytefly doctor [extension] [refresh]` | Print the health report | [Health checks](./settings-and-customization.md#health-checks) |
| `/bytefly update` | Re-run the package update check | [Update checks](./settings-and-customization.md#update-checks) |
| `/bytefly upgrade` | Confirm, then install what the check found through Pi's own package manager and name the reload it needs | [Update checks](./settings-and-customization.md#update-checks) |

### Launch flags and environment

| Entry | What it does | Where explained |
|---|---|---|
| `pi --plan` | Start Pi in plan mode | [Plan first, then write](./plan-and-verify.md#plan-first-then-write) |
| `pi --worktree <name>` | Start Pi inside a worktree | [Working on a branch safely](./keep-work-safe.md#working-on-a-branch-safely) |
| `PI_DISABLED_EXTENSIONS=todo,job` | Load without the named extensions for one run | [One run only](./settings-and-customization.md#one-run-only) |
| `PI_OFFLINE=1` | Skip the session's automatic update check | [Update checks](./settings-and-customization.md#update-checks) |

### Pi's own commands

Pi's own commands are documented by Pi. The guide uses them here:

| Pi command | Used in this guide |
|---|---|
| `/help`, `/resume`, `/settings`, `/tree` | [Getting started](./getting-started.md) and [Themes](./settings-and-customization.md#themes) |
| `pi install`, `pi list`, `pi update`, `pi remove` | [Install](./getting-started.md#install) and [Update and remove](./getting-started.md#update-and-remove) |
| `pi --version` | [Prerequisites](./getting-started.md#prerequisites) |

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
| `Tab` | Switch section, scope, or filter, depending on the screen |
| `[` / `]` | Jump to the previous or next group |
| `r` | Refresh, rerun, or revert, depending on the screen |
| `x` | Clear, stop, cancel, or release your own claim, depending on the screen |
| `Ctrl+O` | Expand or collapse a long tool block |
| `Ctrl+C` | Clear the input line, or close a screen |
| `Ctrl+D` | Exit Pi when the input is empty |
| `?` | Show the keys, in a screen or in a browser page |

## Platform and terminal notes

| Platform or surface | What differs | Where it is set |
|---|---|---|
| Windows | PowerShell is refused while you are isolated; a job cannot detach; `toast` is the OS notification route | [`worktree.guard.blockPowershell`](../configuration.md#worktree--isolated-worktrees), [`job.detachedByDefault`](../configuration.md#job--background-jobs), [`notify.method`](../configuration.md#notify--os-notifications) |
| macOS | `osascript` is the OS notification route; a launch that starts and then fails adds a notification | [`notify.method`](../configuration.md#notify--os-notifications) |
| Linux | `notify-send` is the OS notification route | [`notify.method`](../configuration.md#notify--os-notifications) |
| Any terminal | OSC 777 and OSC 99 need terminal support; `auto` falls back to the platform. `Ctrl+Alt+P` is sent by some terminals but not others, so `/plan` is the portable toggle. A theme cannot correct a mismatched terminal background | [`notify.method`](../configuration.md#notify--os-notifications), [Themes](./settings-and-customization.md#themes) |
| RPC, JSON, print | Screens print a report instead; `question` is inactive; the WeChat QR login needs the terminal | [What each feature needs](./getting-started.md#what-each-feature-needs) |

## Files on disk

Everything the pack writes is listed here. All of it is safe to delete when you
no longer need it; deleting a settings file restores defaults.

| Location | What it is |
|---|---|
| `~/.pi/agent/plans/<repo-key>/` | Plan files as Markdown, shared by every worktree of the repository |
| `.pi/worktrees/` in the project | Isolated worktrees; `index.json` is a disposable record |
| `.pi/subagents/` in the project | Optional helper transcripts, pruned by age and count |
| `<agent-dir>/subagents/` | The same transcripts when the working directory is not a git repository |
| `.pi/memory.md` in the project | Project memory notes |
| `.pi/bytefly.json` in the project | Project-scope settings |
| `<agent-dir>/plans/` | Plans when Pi runs outside a git repository |
| `<agent-dir>/board/<repo-key>/` | The shared board's cards, and the note the serving session leaves so a second session can open the same page; shared by every worktree of the repository |
| `<agent-dir>/session-bus/<repo-key>/` | Session records with each session's mail, and the path claims they hold |
| `<agent-dir>/memory.md` | Global memory notes |
| `<agent-dir>/bytefly.json` | Global `bytefly.json` settings |
| `<agent-dir>/bytefly/update.json` | The cached update-check answer |
| `<agent-dir>/wechat/` | Credentials, conversations, media, and the poller lock |
| `<agent-dir>/jobs/<project>/` | Background job registries and log files |
| `<agent-dir>/settings.json` | Pi's own settings, including the package entry and app preferences |
| `refs/pi/rewind` in the project's git | Rewind snapshots; list them with `git for-each-ref refs/pi/rewind` |

`<agent-dir>` is Pi's agent directory, usually `~/.pi/agent`.

## Actions that discard something

| Action | What is discarded | Recoverable? |
|---|---|---|
| `/worktree exit`, choosing Remove | Uncommitted changes in that worktree; a clean merged branch may also be deleted | No for the uncommitted changes. Commits on a kept branch survive. |
| `/worktree prune` | Clean, unlocked, non-current worktrees older than `pruneAfterDays` (seven days by default) | Nothing uncommitted was there. A branch is deleted only if merged; otherwise it is kept. |
| A code restore from `/rewind` | Current working-tree changes | Normally yes: a pre-restore safety snapshot is taken. It needs `safetySnapshot` and room under `max`; a pruned ref is gone. |
| A revert from `/review` | The selected files or hunks | Yes, by the same batch safety snapshot. |
| `/memory clear [scope]`, or `d` in the picker | Every note in that scope, or the focused note | No undo. |
| `/wechat logout` | Stored credentials and the running bridge | Scan the QR code again; conversations stay on disk. |
| `/goal clear` | The session goal | No undo; set it again if you still have the text. |
| `pi remove ...` | The package entry, not your data | Reinstall to use the pack again; plans, notes, snapshots, conversations, and settings stay on disk. |

Snapshots and their limits are configured in
[`rewind`](../configuration.md#rewind--snapshots); worktree pruning in
[`worktree`](../configuration.md#worktree--isolated-worktrees).

## Extensions and tools

The pack adds 22 extensions and 26 tools. `worktree` also re-registers Pi's path
tools (`bash`, `edit`, `find`, `grep`, `ls`, `read`, `write`) so they follow the
active root; those are replacements, not additions.

| Extension | Tools | Commands and flags |
|---|---|---|
| `serve` | — | — |
| `plan` | `enter_plan_mode`, `write_plan`, `exit_plan_mode`, `cancel_plan_mode`, `set_plan_steps` | `/plan`, `/plan list`, `/plan review`, `/plan share`, `/plan cancel`, `--plan` |
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
| `context` | — | `/context` |
| `session-bus` | `session` | `/sessions` |
| `board` | `board` | `/board` |
| `team` | `team` | `/team` |
| `web-access` | `web_search`, `web_fetch` | — |
| `file-read` | `read_doc` | — |
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
| [`docs/extensions/<name>.md`](../../docs/extensions/) | Each extension's capabilities, full contract, and design notes |
| [Architecture](../architecture.md) | The target shape for contributors: the extension contract, the turn, and state |
| [Development](../development.md) | Setup, checks, and the release process |

---

[← Previous: Troubleshooting](./troubleshooting.md) · [Guide home](./README.md)
