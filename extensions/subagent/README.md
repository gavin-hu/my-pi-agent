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
- **Built-in agents.** `explorer`, `planner`, `reviewer`, `worker`,
  `researcher`, `tester`, `debugger`, and `documenter` ship with the extension.
- **External agents.** Optionally load markdown agents from `~/.pi/agents`
  (user) and the nearest `.pi/agents` (project). They are opt-in per scope and
  never replace the built-ins silently.
- **Three modes.** One agent, a parallel batch, or a sequential chain.
- **Streaming.** Tool calls and progress update live in the transcript while the
  subagent runs; `Ctrl+O` expands the full task, tool calls, Markdown output, and
  usage.
- **Inherited model.** Subagents use the dispatching session's model and thinking
  level unless an agent overrides them (none do).

## Built-in agents

| Agent | Tools | Purpose |
|---|---|---|
| `explorer` | `read, grep, find, ls` | Fast codebase recon; returns files + line ranges, key code, architecture, and where to start. |
| `planner` | `read, grep, find, ls` | Delegated planning in an isolated context (headless/chain); never edits. |
| `reviewer` | `read, grep, find, ls, bash` | Reviews for bugs, security, and maintainability; bash limited to read-only `git diff/log/show`. |
| `worker` | `read, write, edit, bash, grep, find, ls` | General-purpose executor; reports what changed. |
| `researcher` | `read, grep, find, ls, web_search, web_fetch` | Investigates external questions and returns sourced findings with confidence. |
| `tester` | `read, write, edit, grep, find, ls, bash` | Adds or updates tests and runs them; never weakens assertions to pass. |
| `debugger` | `read, grep, find, ls, bash` | Root-causes a failure from evidence; read-only plus running tests/builds. |
| `documenter` | `read, write, edit, grep, find, ls, bash` | Updates READMEs, docs, and changelogs to match the code. |

Each agent's system prompt is appended to the subprocess, and its tool list is
passed as `--tools`. Every built-in has an explicit allowlist, so an agent never
picks up ambient extensions and `worker` cannot recurse into `subagent`.

### Planner vs plan mode

`planner` is for **delegated** planning: it produces a plan in its own context
for another agent (typically `worker`) to execute, and it works headlessly. It
returns the plan as text and writes nothing. For **interactive** planning where
the user reviews and approves a saved plan, use the plan-mode extension instead
(`enter_plan_mode` / `write_plan` / `exit_plan_mode`), which operates on the
main session and persists to `.pi/plans`. Plan mode blocks `subagent`, so the
two are never used together.

## External agents

On top of the built-ins, `subagent` can load agents from markdown files:

- **User agents** — `<agent-dir>/agents` (usually `~/.pi/agents`).
- **Project agents** — the nearest `<repo>/.pi/agents` walking up from the
  session cwd.

Each file is YAML frontmatter plus a body that becomes the system prompt:

```markdown
---
name: auditor
description: Reviews changes for privacy issues
tools: read, grep, find, ls
model: anthropic/claude-sonnet-4-5   # optional; omit to inherit the session model
---
You are a privacy auditor. Report findings as file:line references.
```

`tools` accepts a comma-separated string or a YAML list. A file missing `name`
or `description` is skipped. Names that do not resolve to an available tool are
dropped from `--tools` silently, so keep them spelled as Pi reports them.

External agents are only as available as the extensions in the **subprocess's**
config: a subagent runs `pi --mode json` and does not inherit a parent's
`-e`/`--extension` flags, so tools such as `web_search` must come from an
installed package.

Which files are consulted is controlled by the `agentScope` parameter:

| `agentScope` | Loaded |
|---|---|
| `user` (default) | built-ins + user agents |
| `project` | built-ins + project agents |
| `both` | built-ins + user + project agents |

Resolution merges built-ins, then user, then project, keyed by name — so a user
or project file can customize a built-in (for example a personal `reviewer`).

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

Exactly one of `agent`+`task`, `tasks`, or `chain` may be provided. Every call
also accepts `agentScope` (see [External agents](#external-agents)).

## Output display

**Collapsed** (default):

```
✓ explorer 4s
→ grep /retry/ in ~/src
→ read ~/src/http.ts:40-120
Retries are configured in http.ts:64...
2 turns ↑12.4k ↓1.1k R8.0k $0.0042 ctx:18.2k claude-sonnet-4-5
```

**Expanded** (`Ctrl+O`): the full task, every intermediate assistant message and
tool call, the final output rendered as Markdown, and per-step/per-task usage
with a total.

A failed or aborted result always shows its `errorMessage`, falling back to the
subprocess `stderr`, in both the collapsed and expanded views, in every mode.
Parallel and chain headers state the failure count (`1/2 tasks (1 failed)`) and
running tasks show an elapsed-time label. A result that hit tool errors appends
`N tool errors` to its usage line (and to the multi `Total:`).

## Security

A subagent is a real `pi` process and shares Pi's OS permissions. The built-in
`worker`, `tester`, and `documenter` can write files; the others read files and
run bash (the `reviewer` and `debugger` are instructed to stay read-only, but
that is a prompt, not a sandbox).

Built-in agents are fixed prompts you install with the package; a repository
cannot change them. Project-local agents **are** repository-controlled, so they
are not loaded under the default `agentScope: "user"`. When they are requested
(`"project"` or `"both"`) for an untrusted project, the extension asks for
confirmation before running them in an interactive session; without a UI it
refuses instead of running them silently. The gate is driven only by the
project's trusted state — the model cannot turn it off.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Registers the `subagent` tool and assembles the mode context. |
| `orchestrate.ts` | The `single`/`parallel`/`chain` mode runners. |
| `agents.ts` | Built-in agent definitions, external markdown discovery, and pool resolution. |
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
