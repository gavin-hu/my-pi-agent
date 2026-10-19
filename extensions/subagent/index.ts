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

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled, resolveEffectiveCwd } from "../../lib/env.ts";
import {
	type AgentConfig,
	type AgentScope,
	BUILTIN_AGENTS,
	discoverAgents,
	formatAgentList,
	formatAgentNames,
} from "./agents.ts";
import { loadSubagentConfig, type SubagentConfig } from "./config.ts";
import { runChainMode, runParallelMode, runSingleMode, type ModeContext } from "./orchestrate.ts";
import { renderSubagentCall, renderSubagentResult } from "./render.ts";
import { pruneTranscripts, transcriptsDirFor } from "./transcripts.ts";
import { SUBAGENT_FINISHED_CHANNEL } from "../../lib/events.ts";
import { finishedEvent } from "./accounting.ts";
import { runSingleAgent, type RunOptions } from "./run.ts";
import { SubagentParams, resolveMode, type SubagentArgs } from "./schema.ts";
import type { DispatchDefaults, SingleResult, SubagentDetails } from "./types.ts";

export const TOOL_NAME = "subagent";

/** Overridable runner, so tests can drive the three modes without spawning. */
interface SubagentDeps {
	run?: (options: RunOptions) => Promise<SingleResult>;
}

const AGENT_NAMES = formatAgentNames(BUILTIN_AGENTS);

const DESCRIPTION = [
	"Delegate tasks to specialized subagents with isolated context windows.",
	"Modes: single (`agent` + `task`), parallel (`tasks`), chain (sequential, `{previous}` placeholder).",
	"Each runs in its own process, inheriting the current model and thinking level.",
	`Built-in agents: ${AGENT_NAMES}.`,
].join(" ");

const GUIDELINES = [
	"Use `subagent` for broad codebase exploration, parallel research, or isolated implementation work that would bloat the main context.",
	"Prefer `explorer` first when another agent would otherwise re-read many files, then pass its output to `planner` or `worker`.",
	"Run independent tasks with `tasks` (max 8, up to 4 at once); use `chain` only when each step needs the previous step's output.",
	"Project-local agents are repository-controlled and load only when `agentScope` includes them; an untrusted project requires confirmation.",
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
	const runner = deps.run ?? runSingleAgent;
	// Read once per session; a call that arrives before `session_start` reads the
	// same files lazily, so the two paths cannot disagree.
	let settings: SubagentConfig | undefined;

	const startSession = async (ctx: ExtensionContext): Promise<void> => {
		settings = loadSubagentConfig(ctx.cwd);
		if (settings.transcripts === "off") return;
		try {
			pruneTranscripts(await transcriptsDirFor(pi, ctx.cwd), settings);
		} catch {
			// Retention is housekeeping: an unreadable store must not fail a session.
		}
	};

	pi.on("session_start", (_event, ctx) => startSession(ctx));

	/**
	 * Account for each finished child, then hand the result on unchanged.
	 *
	 * Every mode (`single`, `parallel` per task, `chain` per step) calls this once
	 * per child, so one wrapper reports each run exactly once. The emit is guarded:
	 * a bus listener that throws must not fail a delegation that already ran.
	 */
	const run = async (options: RunOptions): Promise<SingleResult> => {
		const result = await runner(options);
		const event = finishedEvent(result);
		if (event) {
			try {
				pi.events.emit(SUBAGENT_FINISHED_CHANNEL, event);
			} catch {
				// Accounting is best-effort; the run's own result is what matters.
			}
		}
		return result;
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Subagent",
		description: DESCRIPTION,
		promptSnippet: "Delegate a task to a specialized subagent with an isolated context window.",
		promptGuidelines: GUIDELINES,
		parameters: SubagentParams,
		// Deliberately no `executionMode`: sibling subagent calls are independent
		// (each spawns its own child process), so they stay parallel by default.
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const args = params as SubagentArgs;
			// A subagent is a fresh process and may not load the worktree extension, so
			// it must start in the active worktree root itself rather than the parent's
			// recorded cwd (Pi has no mutable session cwd).
			const root = resolveEffectiveCwd(ctx.cwd);
			const defaults: DispatchDefaults = {
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				thinkingLevel: ctx.thinkingLevel,
			};

			const resolution = resolveMode(args);
			if ("error" in resolution) {
				const roster = discoverAgents(root, args.agentScope ?? "user").agents;
				return {
					content: [
						{ type: "text" as const, text: `${resolution.error} Available agents: ${formatAgentList(roster)}` },
					],
					details: { mode: "single", results: [] } satisfies SubagentDetails,
				};
			}

			const mode = resolution.mode;
			const agentScope: AgentScope = args.agentScope ?? "user";
			const discovery = discoverAgents(root, agentScope);
			const agents = discovery.agents;
			const requestedTotal = args.chain?.length ?? args.tasks?.length ?? 1;
			const config = settings ?? loadSubagentConfig(ctx.cwd);
			// Resolved against the session cwd, not the active root: a run's record outlives
			// the worktree it ran in, the way the `job` registry does.
			const transcripts =
				config.transcripts === "off"
					? undefined
					: { dir: await transcriptsDirFor(pi, ctx.cwd), mode: config.transcripts };
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
				defaultCwd: root,
				signal,
				onUpdate,
				makeDetails,
				agents,
				timeoutMs: config.timeoutMs,
				transcripts,
			};

			if (mode === "chain" && args.chain) return runChainMode(context);
			if (mode === "parallel" && args.tasks) return runParallelMode(context);
			return runSingleMode(context);
		},

		renderCall(args, theme, context) {
			return renderSubagentCall(args, theme, {
				cwd: context.cwd,
				lastComponent: context.lastComponent,
			});
		},

		renderResult(result, options, theme, context) {
			return renderSubagentResult(result, options, theme, context);
		},
	});
}
