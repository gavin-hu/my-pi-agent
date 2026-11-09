# Tools and commands

Every name this pack puts in front of you, in one place. A **tool** is what the
model calls; a **command** is what you type. Each row links to the page that owns
it, and Pi's own built-in tools are not repeated here.

## Tools

| Tool | Extension | What it does |
|---|---|---|
| `board` | [board](./extensions/board.md) | The shared feature board: cards, lanes, and the two signatures. |
| `goal` | [goal](./extensions/goal.md) | The session's one objective, kept in view and restated before each turn. |
| `job` | [job](./extensions/job.md) | Start a long shell command, then read its log, wait on it, or kill it. |
| `memory` | [memory](./extensions/memory.md) | Durable notes for later sessions, as markdown you can edit. |
| `open_path` | [file-open](./extensions/file-open.md) | Open or reveal a file or directory in the OS application that owns it. |
| `plan` | [plan](./extensions/plan.md) | Read-only planning: investigate, save a plan, wait for approval before writing. |
| `question` | [question](./extensions/question.md) | Ask you a question with labelled options and wait for the answer. |
| `read_doc` | [file-read](./extensions/file-read.md) | Extract text from a local PDF, DOCX, DOC, ODT, RTF, or XLSX. |
| `run_doctor` | [bytefly](./extensions/bytefly.md) | Report what each enabled extension needs at runtime, and what is missing. |
| `send_wechat` | [wechat](./extensions/wechat.md) | Send a text, an image, or a file to the WeChat account owner. |
| `session` | [session-bus](./extensions/session-bus.md) | Messages, an inbox, and path claims between parallel sessions. |
| `subagent` | [subagent](./extensions/subagent.md) | Delegate a task to a specialist Pi process, alone, in parallel, or in a chain. |
| `team` | [team](./extensions/team.md) | Run a round over the board: assign, offer, reclaim, claim, ask. |
| `todo` | [todo](./extensions/todo.md) | The task list, with one item in progress at a time. |
| `watch` | [watch](./extensions/watch.md) | Tail a file or a command and match each new line against patterns. |
| `web_fetch` | [web-access](./extensions/web-access.md) | Fetch a URL as readable text, with paging and passage finding. |
| `web_search` | [web-access](./extensions/web-access.md) | Search the web and return an answer or a list of results. |
| `worktree` | [worktree](./extensions/worktree.md) | An isolated git worktree on its own branch, for one task. |

## Commands

| Command | Extension | What it does |
|---|---|---|
| `/agents` | [subagent](./extensions/subagent.md) | List running and finished background runs, and open one to collect it. |
| `/board` | [board](./extensions/board.md) | Serve or open the board page, and give a card either signature. |
| `/browse` | [file-browse](./extensions/file-browse.md) | Serve the working directory as a loopback page and open it. |
| `/bytefly` | [bytefly](./extensions/bytefly.md) | The control center: extensions, settings, skills, update, and doctor. |
| `/context` | [context](./extensions/context.md) | Show what the context window holds, and compact from the report. |
| `/goal` | [goal](./extensions/goal.md) | Set, edit, complete, or clear the session objective. |
| `/jobs` | [job](./extensions/job.md) | One screen of running jobs and recent ones, with their logs. |
| `/memory` | [memory](./extensions/memory.md) | The note picker, plus edit, clear, path, and doctor. |
| `/open` | [file-open](./extensions/file-open.md) | Open a path in the OS handler, or reveal it in the file manager. |
| `/plan` | [plan](./extensions/plan.md) | Start a task read-only, toggle the mode, and list older plans. |
| `/rewind` | [rewind](./extensions/rewind.md) | Pick an earlier prompt and restore the code, the conversation, or both. |
| `/sessions` | [session-bus](./extensions/session-bus.md) | Who is working in this repository, and what each session holds. |
| `/team` | [team](./extensions/team.md) | The round: who is live, and what waits on a signature. |
| `/todos` | [todo](./extensions/todo.md) | The whole task list, scrollable, when the rail's one line is not enough. |
| `/watch` | [watch](./extensions/watch.md) | List watchers, read their matches, and stop or clear them. |
| `/wechat` | [wechat](./extensions/wechat.md) | The bridge's control screen; `login` pairs an account, `start` answers it. |
| `/worktree` | [worktree](./extensions/worktree.md) | The worktrees screen, plus `enter`, `exit`, and `prune`. |

Flags (`--plan`, `--worktree`), subcommands (`/board approve`, `/worktree enter`),
and the keys each screen answers stay on the page that owns them, and a setting is in
[Configuration keys](./configuration-reference.md). A packaged skill is not a command
with its own row: it runs as `/skill:<name>`, and the
[skill index](./skills/README.md) lists them.
