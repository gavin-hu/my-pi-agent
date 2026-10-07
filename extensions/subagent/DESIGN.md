# subagent — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Let the model delegate a bounded task to a specialized agent that runs with an
isolated context window, then hand the result back. This keeps broad exploration
and parallel research out of the main transcript.

## Non-goals

- **No external agents.** Agents are built-in TypeScript constants. There is no
  `~/.pi/agent/agents` or `.pi/agents` discovery, no `agentScope`, and no
  project-local prompts, so a repository cannot inject an agent merely by
  adding a file.
- **No in-process agent loop.** Subagents are real `pi` processes; the extension
  does not reimplement tool execution or model streaming.
- **No pinned models.** Built-in agents set no `model`, so a subprocess inherits
  the dispatching session's provider/model and thinking level. Pinning model IDs
  would break wherever the host lacks that model.
- **No persistence.** Subagent transcripts live only in the tool result details;
  they are not written to the parent session.

## Decisions

**Subprocess over `streamSimple`.** A separate `pi --mode json` process gives
true isolation (own context, system prompt, tools) and reuses the host's full
agent loop and tool handling. The cost is process startup and the need to parse
a JSON event stream, which is worth it for real delegation. The bundled
`examples/extensions/subagent` is the reference implementation.

**Built-in registry instead of markdown discovery.** Built-ins make behavior
auditable and deterministic: the tool description, agent list, prompts, and tool
allowlists all live in `agents.ts`. Because there is nothing to discover, the
tool surface drops the example's `agentScope` and `confirmProjectAgents`
parameters and the project-trust prompt; the unknown-agent error lists the fixed
roster instead.

**Inherit model and thinking level.** `buildAgentArgs` passes `--model` from the
agent only when set, and falls back to `ctx.model` (`provider/id`). `--thinking`
is only forwarded when the agent did not pin a model, mirroring the example's
"inherits dispatch config" rule. Built-ins pin neither, so both come from the
parent.

**Corrected event names.** The example listens for `tool_result_end`, which this
Pi version no longer emits. `--mode json` serializes `AgentSessionEvent`s, so
tool results arrive as ordinary `message_end` messages and failures as
`tool_execution_end`. `stream.ts` folds `message_end` (messages, usage, model,
stop reason) and counts `tool_execution_end` errors; a tool error does not by
itself fail the run, because the agent may recover.

**Pure logic split from IO.** `stream.ts`, `format.ts`, and `render.ts` are pure
and `run.ts` takes an injectable `SpawnFn`. Tests drive a scripted child process
and assert on parsed results, usage sums, abort behavior, and temp-file cleanup
without launching `pi` or spending tokens.

**The temp prompt file.** `--append-system-prompt` takes a path, so the agent's
system prompt is written to a `0600` temp file via `withFileMutationQueue` and
removed in `finally`. It is never written into the working tree.

**Bounded parallel output.** Parallel mode runs at most 4 of up to 8 tasks at
once and caps each model-facing section at 50 KiB, appending an omission notice
pointing at the tool details. The full results stay in `details` for rendering.

**One mode, resolved first.** `resolveMode` runs before any process starts and
returns a readable error instead of spawning; the TypeBox `maxItems` cap is
re-checked there because programmatic callers such as `codemode` bypass schema
validation.

## Model surface

| Aspect | Value |
|---|---|
| Name | `subagent` |
| Exposure | `direct`, active by default |
| Annotations | `readOnlyHint: false`, `openWorldHint: true` |
| Params | `agent`/`task`/`cwd`, `tasks[]`, `chain[]` |
| Modes | exactly one of single, parallel, chain |
| Limits | 8 tasks, 4 concurrent, 50 KiB/task output |

## Result shape

```
SubagentDetails {
  mode: "single" | "parallel" | "chain"
  results: SingleResult[]   // agent, task, exitCode, messages, stderr,
                            // usage, model, stopReason, errorMessage, step, toolErrors
}
```

`renderResult` reads `details`; the model-facing `content` is the final output
(single), the last step (chain), or a `### [agent] status` summary per task
(parallel). A failed single or chain step returns `isError: true`.
