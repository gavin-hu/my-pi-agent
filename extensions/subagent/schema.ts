/**
 * Tool parameter schema and mode resolution.
 *
 * `resolveMode` keeps the three execution shapes mutually exclusive and runs
 * before anything else, so an invalid call returns a readable error instead of
 * spawning a process.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import type { SubagentMode } from "./types.ts";

/** Hard cap on tasks in one parallel call. */
export const MAX_PARALLEL_TASKS = 8;
/** How many parallel tasks may run at once. */
export const MAX_CONCURRENCY = 4;
/** Model-facing bytes returned per task in parallel mode. */
export const PER_TASK_OUTPUT_CAP = 50 * 1024;
/** Display items shown per result before collapsing. */
export const COLLAPSED_ITEM_COUNT = 10;
/** Text lines shown per item in a collapsed result. */
export const COLLAPSED_TEXT_LINES = 3;
/** Max characters of error detail shown in a collapsed result. */
export const COLLAPSED_ERROR_MAX = 300;

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the built-in agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the built-in agent to invoke" }),
	task: Type.String({
		description: "Task with an optional {previous} placeholder for the prior step's output",
	}),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

export const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (single mode)" })),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, task} for parallel execution",
			maxItems: MAX_PARALLEL_TASKS,
		}),
	),
	chain: Type.Optional(
		Type.Array(ChainItem, {
			description: "Array of {agent, task} for sequential execution; {previous} is replaced by the prior output",
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	agentScope: Type.Optional(
		StringEnum(["user", "project", "both"] as const, {
			description:
				'Which external agent directories to load on top of the built-ins. Default: "user". Use "both" to include project-local agents.',
			default: "user",
		}),
	),
	readOnly: Type.Optional(
		Type.Boolean({
			description:
				"Force every spawned agent to a read-only tool set (read/grep/find/ls and web readers only). Used by plan mode.",
		}),
	),
});

export type SubagentArgs = Static<typeof SubagentParams>;

type ModeResolution = { mode: SubagentMode } | { error: string };

/**
 * Return the single requested mode, or an error describing what is wrong.
 *
 * A parallel call over the task cap is rejected here because the schema's
 * `maxItems` is not enforced for programmatic callers such as `codemode`.
 */
export function resolveMode(params: SubagentArgs): ModeResolution {
	const chainCount = params.chain?.length ?? 0;
	const taskCount = params.tasks?.length ?? 0;
	const hasChain = chainCount > 0;
	const hasTasks = taskCount > 0;
	const hasSingle = Boolean(params.agent && params.task);

	if (hasChain && hasTasks) return { error: "Provide either `chain` or `tasks`, not both." };
	if (hasChain && hasSingle) return { error: "Provide either `chain` or `agent`+`task`, not both." };
	if (hasTasks && hasSingle) return { error: "Provide either `tasks` or `agent`+`task`, not both." };
	if (!hasChain && !hasTasks && !hasSingle) {
		return { error: "Provide one mode: `agent`+`task`, `tasks`, or `chain`." };
	}
	if (hasTasks && taskCount > MAX_PARALLEL_TASKS) {
		return { error: `Too many parallel tasks (${taskCount}). Max is ${MAX_PARALLEL_TASKS}.` };
	}

	return { mode: hasChain ? "chain" : hasTasks ? "parallel" : "single" };
}
