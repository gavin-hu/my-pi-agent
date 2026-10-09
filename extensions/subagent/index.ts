/**
 * subagent — delegate tasks to specialized subagents.
 *
 * Each invocation spawns a separate `pi --mode json` process, giving the
 * subagent an isolated context window. Three modes are supported: `single`
 * (one agent + task), `parallel` (independent tasks with bounded concurrency),
 * and `chain` (sequential steps, with `{previous}` replaced by the prior
 * output).
 *
 * Agents are the built-ins in `agents.ts` plus optional user agents loaded from
 * `<agentDir>/agents` and project agents from the nearest `.pi/agents`; the
 * `agentScope` parameter decides which external directories are consulted.
 * Subagents inherit the dispatching session's model and thinking level.
 *
 * Load with:  pi --extension ./extensions/subagent
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { type AgentConfig, type AgentScope, BUILTIN_AGENTS, discoverAgents, formatAgentList } from "./agents.ts";
import { runChainMode, runParallelMode, runSingleMode, type ModeContext } from "./orchestrate.ts";
import { renderSubagentCall, renderSubagentResult } from "./render.ts";
import { runSingleAgent, type RunOptions } from "./run.ts";
import { SubagentParams, resolveMode, type SubagentArgs } from "./schema.ts";
import type { DispatchDefaults, SingleResult, SubagentDetails } from "./types.ts";

export const TOOL_NAME = "subagent";

/** Overridable runner, so tests can drive the three modes without spawning. */
interface SubagentDeps {
	run?: (options: RunOptions) => Promise<SingleResult>;
}

const AGENT_SUMMARY = formatAgentList(BUILTIN_AGENTS);

const DESCRIPTION = [
	"Delegate tasks to specialized subagents with isolated context windows.",
	"Modes: single (`agent` + `task`), parallel (`tasks` array), chain (sequential steps with a `{previous}` placeholder).",
	"Each subagent runs in its own process and inherits the current model and thinking level.",
	`Built-in agents: ${AGENT_SUMMARY}.`,
	"External agents load from `<agent-dir>/agents` and the nearest `.pi/agents`; set `agentScope` to `user`, `project`, or `both` to include them.",
	"Set `readOnly: true` to force every spawned agent to a read-only tool set (read/grep/find/ls and web readers only); plan mode sets it automatically.",
].join(" ");

const GUIDELINES = [
	"Use `subagent` to delegate broad codebase exploration, parallel research, or isolated implementation work so the main context stays small.",
	"Prefer an `explorer` first when another agent would otherwise need to re-read many files, then pass its output to `planner` or `worker`.",
	"Run independent tasks with `tasks` (max 8, up to 4 at once); use `chain` only when each step needs the previous step's output via `{previous}`.",
	"Recurring background or long-running work should still use the normal tools; subagents are for one-shot delegation.",
	"Project-local agents are repository-controlled; they load only when `agentScope` includes them, and an untrusted project requires confirmation.",
];

/** Names referenced by a call, across all three modes. */
function requestedAgentNames(args: SubagentArgs): string[] {
	const names = new Set<string>();
	if (args.chain) for (const step of args.chain) names.add(step.agent);
	if (args.tasks) for (const task of args.tasks) names.add(task.agent);
	if (args.agent) names.add(args.agent);
	return Array.from(names);
}

export default function subagent(pi: ExtensionAPI, deps: SubagentDeps = {}): void {
	if (!isExtensionEnabled("subagent")) return;
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
					content: [
						{ type: "text" as const, text: `${resolution.error} Available agents: ${formatAgentList(BUILTIN_AGENTS)}` },
					],
					details: { mode: "single", results: [] } satisfies SubagentDetails,
				};
			}

			const mode = resolution.mode;
			const agentScope: AgentScope = args.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const requestedTotal = args.chain?.length ?? args.tasks?.length ?? 1;
			const makeDetails = (results: SingleResult[]): SubagentDetails => ({
				mode,
				results,
				total: requestedTotal,
				agentScope,
				projectAgentsDir: discovery.projectAgentsDir,
				readOnly: args.readOnly === true,
			});

			// Project agents are repository-controlled. This gate is driven only by the
			// project's trusted state — the model cannot opt out of it.
			if (agentScope !== "user" && !ctx.isProjectTrusted()) {
				const projectAgents = requestedAgentNames(args)
					.map((name) => agents.find((candidate) => candidate.name === name))
					.filter((agent): agent is AgentConfig => agent?.source === "project");
				if (projectAgents.length > 0) {
					if (!ctx.hasUI) {
						return {
							content: [
								{
									type: "text" as const,
									text:
										"Refusing to run project-local agents without confirmation. " +
										'Trust the project or use agentScope: "user".',
								},
							],
							details: makeDetails([]),
						};
					}
					const names = projectAgents.map((agent) => agent.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const approved = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!approved) {
						return {
							content: [{ type: "text" as const, text: "Canceled: project-local agents not approved." }],
							details: makeDetails([]),
						};
					}
				}
			}

			const context: ModeContext = {
				run,
				args,
				defaults,
				defaultCwd: ctx.cwd,
				signal,
				onUpdate,
				makeDetails,
				agents,
			};

			if (mode === "chain" && args.chain) return runChainMode(context);
			if (mode === "parallel" && args.tasks) return runParallelMode(context);
			return runSingleMode(context);
		},

		renderCall(args, theme, context) {
			return renderSubagentCall(args as SubagentArgs, theme, {
				cwd: context.cwd,
				lastComponent: context.lastComponent,
			});
		},

		renderResult(result, options, theme, context) {
			return renderSubagentResult(result, options, theme, context);
		},
	});
}
