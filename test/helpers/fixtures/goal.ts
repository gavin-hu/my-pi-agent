import type { Goal } from "../../../extensions/goal/types.ts";
import { GOAL_CONTEXT_TYPE } from "../../../extensions/goal/index.ts";
import { toolResultEntry } from "../entries.ts";

/** A stored `goal` tool-result entry, as it appears on a session branch. */
export function resultEntry(goal: Goal | null, toolName = "goal"): unknown {
	const action = goal === null ? "clear" : goal.status === "achieved" ? "achieve" : "set";
	return toolResultEntry(toolName, { goal, action });
}

/** The injected goal context message, as it appears in `context` messages. */
export function goalContextMessage(objective = "ship it"): unknown {
	return {
		role: "custom",
		customType: GOAL_CONTEXT_TYPE,
		content: `The user set this session goal: ${objective}`,
		display: false,
	};
}
