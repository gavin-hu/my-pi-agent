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
import { renderSubagentCall, renderSubagentResult } from "./render.ts";
import { runSingleAgent, type RunOptions } from "./run.ts";
import { MAX_CONCURRENCY, PER_TASK_OUTPUT_CAP, SubagentParams, resolveMode, type SubagentArgs } from "./schema.ts";
import { emptyUsage, getFinalOutput, getResultOutput, isFailedResult, mapWithConcurrencyLimit, truncateOutput } from "./stream.ts";
import type { DispatchDefaults, OnUpdateCallback, SingleResult, SubagentDetails } from "./types.ts";

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
			const makeDetails = (results: SingleResult[]): SubagentDetails => ({ mode, results });

			if (mode === "chain" && args.chain) {
				const results: SingleResult[] = [];
				let previous = "";

				for (let i = 0; i < args.chain.length; i++) {
					const step = args.chain[i];
					const task = step.task.replace(/\{previous\}/g, previous);
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								const current = partial.details?.results[0];
								if (current) onUpdate({ content: partial.content, details: makeDetails([...results, current]) });
							}
						: undefined;

					const result = await run({
						defaultCwd: ctx.cwd,
						defaults,
						agentName: step.agent,
						task,
						cwd: step.cwd,
						step: i + 1,
						signal,
						onUpdate: chainUpdate,
						makeDetails,
					});
					results.push(result);

					if (isFailedResult(result)) {
						return {
							content: [
								{
									type: "text" as const,
									text: `Chain stopped at step ${i + 1} (${step.agent}): ${getResultOutput(result)}`,
								},
							],
							details: makeDetails(results),
							isError: true,
						};
					}
					previous = getFinalOutput(result.messages);
				}

				const last = results[results.length - 1];
				return {
					content: [{ type: "text" as const, text: last ? getFinalOutput(last.messages) || "(no output)" : "(no output)" }],
					details: makeDetails(results),
				};
			}

			if (mode === "parallel" && args.tasks) {
				const tasks = args.tasks;
				const allResults: SingleResult[] = tasks.map((task) => ({
					agent: task.agent,
					task: task.task,
					exitCode: -1,
					messages: [],
					stderr: "",
					usage: emptyUsage(),
				}));

				const emitParallel = () => {
					if (!onUpdate) return;
					const running = allResults.filter((r) => r.exitCode === -1).length;
					const done = allResults.length - running;
					onUpdate({
						content: [{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` }],
						details: makeDetails([...allResults]),
					});
				};

				const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (task, index) => {
					const result = await run({
						defaultCwd: ctx.cwd,
						defaults,
						agentName: task.agent,
						task: task.task,
						cwd: task.cwd,
						signal,
						onUpdate: (partial) => {
							const current = partial.details?.results[0];
							if (!current) return;
							allResults[index] = current;
							emitParallel();
						},
						makeDetails,
					});
					allResults[index] = result;
					emitParallel();
					return result;
				});

				const successCount = results.filter((result) => !isFailedResult(result)).length;
				const summaries = results.map((result) => {
					const output = truncateOutput(getResultOutput(result), PER_TASK_OUTPUT_CAP);
					const status = isFailedResult(result)
						? `failed${result.stopReason && result.stopReason !== "end" ? ` (${result.stopReason})` : ""}`
						: "completed";
					return `### [${result.agent}] ${status}\n\n${output}`;
				});

				return {
					content: [
						{
							type: "text" as const,
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails(results),
				};
			}

			// Single mode.
			const result = await run({
				defaultCwd: ctx.cwd,
				defaults,
				agentName: args.agent ?? "",
				task: args.task ?? "",
				cwd: args.cwd,
				signal,
				onUpdate,
				makeDetails,
			});

			if (isFailedResult(result)) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Agent ${result.agent} ${result.stopReason ?? "failed"}: ${getResultOutput(result)}`,
						},
					],
					details: makeDetails([result]),
					isError: true,
				};
			}

			return {
				content: [{ type: "text" as const, text: getFinalOutput(result.messages) || "(no output)" }],
				details: makeDetails([result]),
			};
		},

		renderCall(args, theme) {
			return renderSubagentCall(args as SubagentArgs, theme);
		},

		renderResult(result, options, theme) {
			return renderSubagentResult(result, options, theme);
		},
	});
}
