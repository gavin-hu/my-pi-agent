/**
 * Subagent orchestration: the three execution modes (`chain`, `parallel`,
 * `single`). Kept apart from tool registration in `index.ts` so the mode logic
 * is independent of the Pi tool surface.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { RunOptions } from "./run.ts";
import { MAX_CONCURRENCY, PER_TASK_OUTPUT_CAP, type SubagentArgs } from "./schema.ts";
import {
	createResult,
	getFinalOutput,
	getResultOutput,
	isFailedResult,
	mapWithConcurrencyLimit,
	truncateOutput,
} from "./stream.ts";
import type { DispatchDefaults, OnUpdateCallback, SingleResult, SubagentDetails } from "./types.ts";

/** Everything a mode runner needs, assembled once by `index.ts`. */
export interface ModeContext {
	run: (options: RunOptions) => Promise<SingleResult>;
	args: SubagentArgs;
	defaults: DispatchDefaults;
	defaultCwd: string;
	signal?: AbortSignal;
	onUpdate?: OnUpdateCallback;
	/** Builds the details payload for this mode from the current results. */
	makeDetails: (results: SingleResult[]) => SubagentDetails;
}

/** Sequential chain: each step's `{previous}` is the prior step's final output. */
export async function runChainMode(ctx: ModeContext): Promise<AgentToolResult<SubagentDetails>> {
	const { run, args, defaults, defaultCwd, signal, onUpdate, makeDetails } = ctx;
	const chain = args.chain ?? [];
	const results: SingleResult[] = [];
	let previous = "";

	for (let i = 0; i < chain.length; i++) {
		const step = chain[i];
		const task = step.task.replace(/\{previous\}/g, previous);
		const chainUpdate: OnUpdateCallback | undefined = onUpdate
			? (partial) => {
					const current = partial.details?.results[0];
					if (current) onUpdate({ content: [], details: makeDetails([...results, current]) });
				}
			: undefined;

		const result = await run({
			defaultCwd,
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

/** Independent tasks with bounded concurrency, reporting running/done progress. */
export async function runParallelMode(ctx: ModeContext): Promise<AgentToolResult<SubagentDetails>> {
	const { run, args, defaults, defaultCwd, signal, onUpdate, makeDetails } = ctx;
	const tasks = args.tasks ?? [];
	const allResults: SingleResult[] = tasks.map((task) => createResult(task.agent, task.task));

	const emitParallel = () => {
		if (!onUpdate) return;
		const running = allResults.filter((r) => r.exitCode === -1).length;
		const done = allResults.length - running;
		onUpdate({
			content: [{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running…` }],
			details: makeDetails([...allResults]),
		});
	};

	const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (task, index) => {
		const result = await run({
			defaultCwd,
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

/** One agent + task. */
export async function runSingleMode(ctx: ModeContext): Promise<AgentToolResult<SubagentDetails>> {
	const { run, args, defaults, defaultCwd, signal, onUpdate, makeDetails } = ctx;
	const result = await run({
		defaultCwd,
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
}
