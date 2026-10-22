/**
 * Subagent orchestration: the three execution modes (`chain`, `parallel`,
 * `single`). Kept apart from tool registration in `index.ts` so the mode logic
 * is independent of the Pi tool surface.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { failedResult, textResult } from "../../lib/tool-result.ts";
import type { AgentConfig } from "./agents.ts";
import type { TranscriptMode } from "./config.ts";
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
	/** Resolved agent pool passed to every run. */
	agents?: readonly AgentConfig[];
	defaults: DispatchDefaults;
	defaultCwd: string;
	signal?: AbortSignal;
	onUpdate?: OnUpdateCallback;
	/** Builds the details payload for this mode from the current results. */
	makeDetails: (results: SingleResult[]) => SubagentDetails;
	/** Per-run wall-clock limit in ms; `0` or absent disables it. */
	timeoutMs?: number;
	/** Where and when a finished run writes a transcript. */
	transcripts?: { dir: string; mode: Exclude<TranscriptMode, "off"> };
}

/** Sequential chain: each step's `{previous}` is the prior step's final output. */
export async function runChainMode(ctx: ModeContext): Promise<AgentToolResult<SubagentDetails>> {
	const { run, args, defaults, defaultCwd, signal, onUpdate, makeDetails, agents, timeoutMs, transcripts } = ctx;
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
			agents,
			task,
			taskTemplate: step.task,
			cwd: step.cwd,
			step: i + 1,
			readOnly: args.readOnly,
			signal,
			onUpdate: chainUpdate,
			makeDetails,
			timeoutMs,
			transcripts,
		});
		results.push(result);

		if (isFailedResult(result)) {
			return failedResult(
				`Chain stopped at step ${i + 1} (${step.agent}): ${getResultOutput(result)}`,
				makeDetails(results),
			);
		}
		previous = getFinalOutput(result.messages);
	}

	const last = results[results.length - 1];
	return textResult(last ? getFinalOutput(last.messages) || "(no output)" : "(no output)", makeDetails(results));
}

/** Independent tasks with bounded concurrency, reporting running/done progress. */
export async function runParallelMode(ctx: ModeContext): Promise<AgentToolResult<SubagentDetails>> {
	const { run, args, defaults, defaultCwd, signal, onUpdate, makeDetails, agents, timeoutMs, transcripts } = ctx;
	const tasks = args.tasks ?? [];
	const allResults: SingleResult[] = tasks.map((task) => createResult(task.agent, task.task));

	const emitParallel = () => {
		if (!onUpdate) return;
		const running = allResults.filter((r) => r.exitCode === -1).length;
		const done = allResults.length - running;
		onUpdate(
			textResult(`Parallel: ${done}/${allResults.length} done, ${running} running…`, makeDetails([...allResults])),
		);
	};

	const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (task, index) => {
		const result = await run({
			defaultCwd,
			defaults,
			agentName: task.agent,
			agents,
			task: task.task,
			cwd: task.cwd,
			readOnly: args.readOnly,
			signal,
			// Elapsed time is per run, so a deadline is too: one timer around the mode
			// would bound the batch rather than each child.
			timeoutMs,
			transcripts,
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

	return textResult(
		`Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
		makeDetails(results),
	);
}

/** One agent + task. */
export async function runSingleMode(ctx: ModeContext): Promise<AgentToolResult<SubagentDetails>> {
	const { run, args, defaults, defaultCwd, signal, onUpdate, makeDetails, agents, timeoutMs, transcripts } = ctx;
	const result = await run({
		defaultCwd,
		defaults,
		agentName: args.agent ?? "",
		agents,
		task: args.task ?? "",
		cwd: args.cwd,
		readOnly: args.readOnly,
		signal,
		onUpdate,
		makeDetails,
		timeoutMs,
		transcripts,
	});

	if (isFailedResult(result)) {
		return failedResult(
			`Agent ${result.agent} ${result.stopReason ?? "failed"}: ${getResultOutput(result)}`,
			makeDetails([result]),
		);
	}

	return textResult(getFinalOutput(result.messages) || "(no output)", makeDetails([result]));
}
