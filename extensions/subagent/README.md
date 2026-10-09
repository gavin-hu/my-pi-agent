# subagent — isolated delegation for Pi

A `subagent` tool that hands a task to a specialized agent running in its own
`pi --mode json` process. The subagent gets a fresh context window, so broad
exploration or parallel work does not fill the main conversation.

```bash
pi --extension ./extensions/subagent    # load just this extension
pi -e .                                 # load the whole @gavin-hu/my-pi-agent package
pi install ./                           # install the package
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

## Tool

`subagent` takes exactly one mode. Every call also accepts `agentScope` and
`readOnly`.

| Field | Value |
|---|---|
| `agent` + `task` | Single mode: one built-in/external agent and its task. |
| `tasks[]` | Parallel mode: independent `{agent, task, cwd?}` entries, max 8. |
| `chain[]` | Chain mode: ordered `{agent, task, cwd?}` steps; `{previous}` is replaced by the prior step's final output. |
| `cwd` | Optional working directory for the spawned process (single mode; per-step for the others). |
| `agentScope` | `user` (default), `project`, or `both` — which external agent directories to load. |
| `readOnly` | `true` forces every spawned agent to a reader-only tool set; plan mode sets it automatically. |
| `exposure` | `direct`, active by default. |
| `annotations` | `readOnlyHint: false`, `openWorldHint: true`. |

## Behaviour by mode

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

## Security

A subagent is a real `pi` process and shares Pi's OS permissions. The built-in
`worker`, `tester`, and `documenter` can write files; the others read files and
run bash (the `reviewer` and `debugger` are instructed to stay read-only, but
that is a prompt, not a sandbox). With `readOnly: true` the restriction is not a
prompt: the child never receives `write`, `edit`, `bash`, or `powershell` in its
`--tools` list, so it cannot write even if its system prompt says otherwise.
Subagent-authored text is stripped of terminal control characters before it
reaches the transcript, so content the child echoed from an untrusted source
cannot drive the parent terminal.

Built-in agents are fixed prompts installed with the package; a repository
cannot change them. Project-local agents **are** repository-controlled, so they
are not loaded under the default `agentScope: "user"`. When they are requested
(`"project"` or `"both"`) for an untrusted project, the extension asks for
confirmation before running them in an interactive session; without a UI it
refuses instead of running them silently. The gate is driven only by the
project's trusted state — the model cannot turn it off.

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
main session and persists to `.pi/plans`. Plan mode keeps `subagent` available
for exploration but forces it read-only, so delegated recon is safe mid-plan.

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

The `agentScope` parameter decides which files are consulted: `user` (default)
loads built-ins + user agents; `project` loads built-ins + project agents;
`both` loads built-ins + user + project. Resolution merges built-ins, then user,
then project, keyed by name — so a user or project file can customize a built-in
(for example a personal `reviewer`).

## Read-only delegation

Set `readOnly: true` to run every spawned agent with a reader-only tool set. It
is the safe way to delegate exploration, and plan mode sets it automatically.

```json
{ "agent": "explorer", "task": "Map the job extension", "readOnly": true }
```

The child is restricted at the process boundary, not by its prompt: the tool
list passed as `--tools` is the intersection of the agent's tools with
`read`, `grep`, `find`, `ls`, `web_search`, and `web_fetch`. An agent with no
reader tools (or no `tools` declaration) gets the full reader set instead. So
`worker` cannot write under `readOnly`, and an external agent file that
customizes a built-in cannot widen it. A short read-only note is appended to the
child's system prompt for behavior; the tool list is the enforcement.

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
subprocess `stderr`, in both the collapsed and expanded views, in every mode. A
failure with neither falls back to `Error: Subprocess exited with code N.` and an
`[exit N]` bracket, so a non-zero exit is never silent. Parallel and chain
headers state the failure count (`1/2 tasks (1 failed)`); a chain that stops at
the first failing step also reports `stopped at step N`. Running tasks show an
elapsed-time label. A result that hit tool errors appends `N tool errors` to its
usage line (and to the multi `Total:`).

A chain step's expanded `Task` section shows the step's original instruction,
with `{previous}` left in place, rather than the substituted prior output that
was actually sent to the child; that output is already shown as the previous
step's `Output`.

## Non-goals

- **No ambient external agents.** User agents load only when an explicit
  `agentScope` asks for them, and project-local agents additionally require a
  trusted project or interactive confirmation, so a repository cannot inject a
  prompt merely by adding a file under the default scope.
- **No in-process agent loop.** Subagents are real `pi` processes; the extension
  does not reimplement tool execution or model streaming.
- **No pinned models.** Built-in agents set no `model`, so a subprocess inherits
  the dispatching session's provider/model and thinking level.
- **No persistence.** Subagent transcripts live only in the tool result details;
  they are not written to the parent session.

## Pi integration

| Aspect | Detail |
|---|---|
| Tool | `subagent` |
| Exposure | `direct`, active by default |
| Annotations | `readOnlyHint: false`, `openWorldHint: true` |
| Output schema | none; the full result lives in tool-result `details` |
| Execution | spawns `pi --mode json` subprocesses; external agents discovered from `<agent-dir>/agents` and `.pi/agents` |
| State storage | tool-result `details` only (no session persistence) |
| Lifecycle | none; the tool is stateless and spawns per call |

## Design notes

- **Subprocess over an in-process loop.** A separate `pi --mode json` process
  gives true isolation (own context, system prompt, tools) and reuses the host's
  full agent loop and tool handling. The cost is process startup and JSON event
  parsing, which is worth it for real delegation.
- **Built-in registry plus opt-in discovery.** Built-ins are auditable
  TypeScript constants in `agents.ts` (description, prompts, allowlists).
  Markdown files are discovered only when `agentScope` includes them, and
  resolution merges built-ins, user, then project by name so a local file can
  customize a built-in. The unknown-agent error lists the resolved pool.
- **Project agents require trust, not a model flag.** There is deliberately no
  `confirmProjectAgents` parameter; a model-facing boolean would let the caller
  opt out. An untrusted project is confirmed interactively (or refused without a
  UI) based on trusted state alone, and shadowing a built-in is still caught by
  `source === "project"`.
- **Inherit model and thinking level.** `--model` is passed only when an agent
  sets one, falling back to `ctx.model`; `--thinking` is forwarded only when the
  agent did not pin a model. Built-ins pin neither, so both come from the parent.
- **Corrected event names.** `--mode json` serializes `AgentSessionEvent`s, so
  results arrive as `message_end` (messages, usage, model, stop reason) and
  failures as `tool_execution_end`. A tool error does not by itself fail the run,
  because the agent may recover.
- **Bounded parallel output.** Parallel mode runs at most 4 of up to 8 tasks at
  once and caps each model-facing section at 50 KiB, appending an omission notice
  pointing at the tool details. The full results stay in `details` for rendering.
- **One mode, resolved first.** `resolveMode` runs before any process starts and
  returns a readable error instead of spawning; the TypeBox `maxItems` cap is
  re-checked there because programmatic callers such as `codemode` bypass schema
  validation.
- **Pure logic split from IO.** `stream.ts` and `format.ts` are pure, `render.ts`
  is pure except for an optional elapsed-time repaint, and `run.ts` takes an
  injectable `SpawnFn`, so tests can drive a scripted child process without
  launching `pi` or spending tokens.
- **Temp prompt file.** `--append-system-prompt` takes a path, so the agent's
  system prompt is written to a `0600` temp file and removed in `finally`; it is
  never written into the working tree.

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
