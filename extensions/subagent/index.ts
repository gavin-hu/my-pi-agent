/**
 * subagent — delegate tasks to specialized built-in subagents.
 *
 * Each invocation spawns a separate `pi --mode json` process, giving the
 * subagent an isolated context window. Three modes are supported: `single`
 * (one agent + task), `parallel` (independent tasks with bounded concurrency),
 * and `chain` (sequential steps, with `{previous}` replaced by the prior
 * output).
 *
 * Agents are the built-ins in `agents.ts`; there is no external agents
 * directory and no project-local loading. Subagents inherit the dispatching
 * session's model and thinking level.
 *
 * Load with:  pi --extension ./extensions/subagent
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatAgentList, listAgents } from "./agents.ts";
import { runChainMode, runParallelMode, runSingleMode, type ModeContext } from "./orchestrate.ts";
import { renderSubagentCall, renderSubagentResult } from "./render.ts";
import { runSingleAgent, type RunOptions } from "./run.ts";
import { SubagentParams, resolveMode, type SubagentArgs } from "./schema.ts";
import type { DispatchDefaults, SingleResult, SubagentDetails } from "./types.ts";

export const TOOL_NAME = "subagent";

/** Overridable runner, so tests can drive the three modes without spawning. */
export interface SubagentDeps {
	run?: (options: RunOptions) => Promise<SingleResult>;
}

const AGENT_SUMMARY = listAgents()
	.map((agent) => `${agent.name} (${agent.description})`)
	.join("; ");

const DESCRIPTION = [
	"Delegate tasks to specialized built-in subagents with isolated context windows.",
	"Modes: single (`agent` + `task`), parallel (`tasks` array), chain (sequential steps with a `{previous}` placeholder).",
	"Each subagent runs in its own process and inherits the current model and thinking level.",
	`Built-in agents: ${AGENT_SUMMARY}.`,
].join(" ");

const GUIDELINES = [
	"Use `subagent` to delegate broad codebase exploration, parallel research, or isolated implementation work so the main context stays small.",
	"Prefer an `explorer` first when another agent would otherwise need to re-read many files, then pass its output to `planner` or `worker`.",
	"Run independent tasks with `tasks` (max 8, up to 4 at once); use `chain` only when each step needs the previous step's output via `{previous}`.",
	"Recurring background or long-running work should still use the normal tools; subagents are for one-shot delegation.",
];

export default function subagent(pi: ExtensionAPI, deps: SubagentDeps = {}): void {
	const run = deps.run ?? runSingleAgent;

	pi.registerTool({
		name: TOOL_NAME,
		label: "Subagent",
		description: DESCRIPTION,
		promptSnippet: "Delegate a task to a specialized built-in subagent with an isolated context window.",
		promptGuidelines: GUIDELINES,
		parameters: SubagentParams,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: false, openWorldHint: true },

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const args = params as SubagentArgs;
			const defaults: DispatchDefaults = {
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				thinkingLevel: ctx.thinkingLevel,
			};

			const resolution = resolveMode(args);
			if ("error" in resolution) {
				return {
					content: [{ type: "text" as const, text: `${resolution.error} Available agents: ${formatAgentList()}` }],
					details: { mode: "single", results: [] } satisfies SubagentDetails,
				};
			}

			const mode = resolution.mode;
			const context: ModeContext = {
				run,
				args,
				defaults,
				defaultCwd: ctx.cwd,
				signal,
				onUpdate,
				makeDetails: (results: SingleResult[]): SubagentDetails => ({ mode, results }),
			};

			if (mode === "chain" && args.chain) return runChainMode(context);
			if (mode === "parallel" && args.tasks) return runParallelMode(context);
			return runSingleMode(context);
		},

		renderCall(args, theme, context) {
			return renderSubagentCall(args as SubagentArgs, theme, { cwd: context.cwd });
		},

		renderResult(result, options, theme, context) {
			return renderSubagentResult(result, options, theme, context);
		},
	});
}
