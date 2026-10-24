# Extension docs

One page per extension, in the order the
[catalog](../../README.md#what-you-get) lists them. Every page opens with its **Capabilities** table — one row per thing
the extension can do, the tool, command, or key that delivers it, and what you
get — then the Quickstart, the surface, the behaviour, and the contributor
sections behind them.

| Extension | What it is | Page |
|---|---|---|
| `plan` | Read-only planning, saved to disk and reviewed in the TUI or a browser | [`plan.md`](./plan.md) |
| `check` | The project's test, lint, or typecheck command, run and parsed | [`check.md`](./check.md) |
| `subagent` | Delegation to a specialist agent in its own Pi process | [`subagent.md`](./subagent.md) |
| `todo` | A whole-list task tracker that follows the session branch | [`todo.md`](./todo.md) |
| `goal` | One persistent session objective, restated before each turn | [`goal.md`](./goal.md) |
| `question` | Structured questions with labelled options and a free-form answer | [`question.md`](./question.md) |
| `job` | Long-lived shell commands in the background, with logs and a wait | [`job.md`](./job.md) |
| `watch` | Tailing a file or command and matching new lines | [`watch.md`](./watch.md) |
| `session-bus` | Coordination between parallel Pi sessions on one repository | [`session-bus.md`](./session-bus.md) |
| `context` | Where the context window went, and compacting from the report | [`context.md`](./context.md) |
| `worktree` | An isolated `git worktree` per task, and the built-in tools following it | [`worktree.md`](./worktree.md) |
| `rewind` | Prompt-anchored snapshots, restoring code, conversation, or both | [`rewind.md`](./rewind.md) |
| `memory` | Durable cross-session notes as human-editable markdown | [`memory.md`](./memory.md) |
| `web-access` | Searching the web and fetching a page as readable text | [`web-access.md`](./web-access.md) |
| `file-browse` | A loopback, read-only browser for the working directory | [`file-browse.md`](./file-browse.md) |
| `file-read` | Text out of a PDF, DOCX, DOC, ODT, RTF, or XLSX, in process | [`file-read.md`](./file-read.md) |
| `file-open` | Opening or revealing a path in the OS-native application | [`file-open.md`](./file-open.md) |
| `wechat` | A WeChat bridge with one Pi conversation per peer | [`wechat.md`](./wechat.md) |
| `bytefly` | The header, footer, turn rule, control center, notices, and update check | [`bytefly.md`](./bytefly.md) |

The template every page follows is
[`docs/development.md#one-doc-per-extension`](../development.md#one-doc-per-extension).
