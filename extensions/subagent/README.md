# subagent — isolated delegation for Pi

A `subagent` tool that hands a task to a specialized built-in agent running in
its own `pi --mode json` process. The subagent gets a fresh context window, so
broad exploration or parallel work does not fill the main conversation.

```
pi --extension ./extensions/subagent    # load just this extension
pi -e .                                 # load the whole @gavin-hu/my-pi-agent package
```

## What it does

- **Isolated context.** Each subagent is a separate `pi` process with its own
  transcript; only its final reply is returned to the caller.
- **Built-in agents.** `explorer`, `planner`, `reviewer`, and `worker` ship with
  the extension. There is no external `agents/` directory and no project-local
  loading, so nothing in a repository can add prompts without you installing it.
- **Three modes.** One agent, a parallel batch, or a sequential chain.
- **Streaming.** Tool calls and progress update live in the transcript while the
  subagent runs; `Ctrl+O` expands the full task, tool calls, Markdown output, and
  usage.
- **Inherited model.** Subagents use the dispatching session's model and thinking
  level unless an agent overrides them (none do).

## Built-in agents

| Agent | Tools | Purpose |
|---|---|---|
| `explorer` | `read, grep, find, ls, bash` | Fast codebase recon; returns files + line ranges, key code, architecture, and where to start. |
| `planner` | `read, grep, find, ls` | Turns context and requirements into a concrete numbered plan; never edits. |
| `reviewer` | `read, grep, find, ls, bash` | Reviews for bugs, security, and maintainability; bash limited to read-only `git diff/log/show`. |
| `worker` | all default tools | General-purpose executor; reports what changed. |

Each agent's system prompt is appended to the subprocess, and its tool list is
passed as `--tools`. `worker` omits the list, so it inherits every default tool.

## Modes

### Single

```json
{ "agent": "explorer", "task": "Find every place the HTTP client is retried", "cwd": "." }
```

### Parallel

Runs up to 8 tasks, at most 4 at once. Independent tasks only.

```json
{
  "tasks": [
    { "agent": "explorer", "task": "Map the auth module" },
    { "agent": "explorer", "task": "Map the billing module" }
  ]
}
```

Each task's output is capped at 50 KiB in the model-facing reply; the complete
output remains in the tool details.

### Chain

Runs steps in order. `{previous}` in a step's `task` is replaced by the prior
step's final output. The chain stops at the first failing step.

```json
{
  "chain": [
    { "agent": "explorer", "task": "Find the config loader" },
    { "agent": "planner", "task": "Using this context, plan a refactor:\n\n{previous}" },
    { "agent": "worker", "task": "Implement the plan:\n\n{previous}" }
  ]
}
```

Exactly one of `agent`+`task`, `tasks`, or `chain` may be provided.

## Output display

**Collapsed** (default):

```
✓ explorer
→ grep /retry/ in ~/src
→ read ~/src/http.ts:40-120
Retries are configured in http.ts:64...
2 turns ↑12.4k ↓1.1k R8.0k $0.0042 ctx:18.2k claude-sonnet-4-5
```

**Expanded** (`Ctrl+O`): the full task, every tool call, the final output
rendered as Markdown, and per-step/per-task usage with a total.

## Security

A subagent is a real `pi` process and shares Pi's OS permissions. The built-in
`worker` can write files and the others can read files and run bash (the
`reviewer` is instructed to stay read-only, but that is a prompt, not a sandbox).
Only registered built-in agents exist, and each has a fixed prompt and tool list;
there is no repository-controlled agent injection.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Registers the `subagent` tool and orchestrates the three modes. |
| `agents.ts` | Built-in agent definitions and lookup. |
| `schema.ts` | TypeBox params, limits, and `resolveMode`. |
| `invocation.ts` | `pi` subprocess invocation and argument construction. |
| `stream.ts` | JSON-event parsing, usage accounting, output helpers (pure). |
| `run.ts` | Runs one subagent process and captures its result. |
| `format.ts` | Token/usage/tool-call formatting (pure). |
| `render.ts` | `renderCall` / `renderResult` transcript rendering. |
| `types.ts` | Shared result and process types. |

## Testing

The unit tests mock the subprocess, so there is also one live end-to-end test
(single mode, real `pi`, real model call) that is skipped by default:

```bash
pi install .                                                   # package must be installed
PI_SUBAGENT_E2E=1 bun test test/subagent/live.integration.test.ts
```

It loads the installed package, has the parent model delegate to `subagent`, and
asserts the subagent's reply comes back. Override the binary or model with
`PI_SUBAGENT_E2E_BIN` / `PI_SUBAGENT_E2E_MODEL`.
