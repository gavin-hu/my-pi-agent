# subagent — hand a task to another agent

`subagent` gives one task to a specialist agent running in its own Pi process.
The child gets a fresh context window, so a broad search or a second opinion does
not fill your conversation; only its final reply comes back.

- **Isolated by design**: each agent has its own context and an explicit tool
  allowlist, so a `worker` cannot reach back into `subagent`.
- **Four built-ins**, no files needed: `explorer`, `planner`, `reviewer`,
  `worker`.
- **One, many, or in order**: a single agent, up to eight in parallel (four at a
  time), or a chain where `{previous}` carries the last step's output.
- **Background runs** keep going after the call returns; `/agents` inspects,
  collects, or cancels them.

## What you can do

| What you want | What to do |
|---|---|
| Search a codebase without filling the context | ask for an `explorer` to find it |
| Get a review of a diff | ask for a `reviewer` |
| Run three investigations at once | ask for parallel tasks |
| Do steps in order | ask for a chain; each step gets the previous output |
| Start long work and keep going | a background run, then `/agents` |
| Use your own agent files | `agentScope` — user, project, or both |
| Force a delegation that cannot write or fetch | `readOnly: true` (plan mode does it for you) |
| Give a step its own directory | `cwd` per task or step |

## Try it

```text
Use the explorer agent to find where the HTTP client retries.
```

The model calls:

```text
subagent({ agent: "explorer", task: "Find where HTTP is retried" })
```

The child works in its own process; the reply is the summary, with its usage.
[Hand a task to another agent](../tutorials/first-delegate.md) walks one agent, a
parallel batch, a chain, and a background run you collect from `/agents`.

## Reference

**Built-in agents.**

| Agent | Can use | For |
|---|---|---|
| `explorer` | read, grep, find, ls, read_doc | recon: files, line ranges, where to start |
| `planner` | the same readers | planning in an isolated context; never edits |
| `reviewer` | readers, plus read-only `git diff/log/show` | bugs, security, maintainability |
| `worker` | read, write, edit, bash, grep, find, ls, read_doc | general execution; reports what changed |

**The call.** One mode per call: `agent` + `task`; `tasks[]` for a parallel batch;
`chain[]` for ordered steps. Plus optional `cwd`, `agentScope`
(`user`/`project`/`both`), `readOnly`, and — single mode only — `background`.
An unknown agent name is refused with the roster it resolved.

**The board.** `/agents` lists running and finished background runs; `Enter` opens
one, `c` collects a finished result into the conversation, `x` cancels a running
one. Outside the TUI the same runs print as a list.

**Bounds.** Parallel: 8 tasks, 4 at once. Chain: 8 steps, stops at the first
failure. What a step hands the next through `{previous}`: 24 KiB. What one result
hands the model: 50 KiB, with the full text kept in the tool details. Background:
4 children at once.

**Plan mode.** The tool stays active but every call is forced read-only; a
background run and `/agents` are refused until the plan is approved.

**Read-only.** The child gets the workspace readers, `read_doc`, and `web_search` —
never a writing tool, a shell, or `web_fetch`. A fetch is an outbound channel, so a
child working from a page it was handed could otherwise post a document it read;
the parent fetches the page and passes the text instead. That narrows what a child
may do rather than sandboxing it: `read_doc` still reads any document the process
can.

**Project agents.** A `.pi/agents` directory loads only when the project is
trusted, so a repository cannot inject a prompt by adding a file.

## Limits

- Background runs are single-mode: parallel and chain calls wait.
- A background run belongs to its session — `/tree` does not move it, and a
  restart cannot resume it (an unfinished start reads `interrupted`).
- A finished run's collected output is capped at 50 KiB; the detail view keeps a
  bounded preview.
- There is no OS notification for a finished run; a TUI notice and `/agents` are
  the record.
- Children inherit your model and thinking level unless the agent overrides them.

## Settings

| Key | Default | What it does |
|---|---|---|
| `timeoutMs` | ten minutes | Deadline per child run (`0` disables); on expiry the whole process group is killed. |
| `backgroundMax` | `4` | Concurrent background children (1–8). |

They live in the `subagent` section of `bytefly.json`
([configuration](../configuration.md#subagent--delegated-runs)). To switch the
extension off, toggle `subagent` in `/bytefly`; the tool and `/agents` go with it.

## Learn more

- [Hand a task to another agent](../tutorials/first-delegate.md) — the walkthrough.
- [`plan`](../extensions/plan.md) — read-only delegation while planning.
- [`team`](../extensions/team.md) — delegating between sessions, not agents.
- [`worktree`](../extensions/worktree.md) — where a worker's writes land.
