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

/** The one question the clarify fixtures ask, in the clarifier's JSON shape. */
export const SCOPE_QUESTION = {
	question: "Which parser?",
	options: [{ label: "The new one" }, { label: "The old one" }],
};

/** A clarifier JSON reply: not understood with one question unless overridden. */
export function clarifyReply(overrides: { understood?: boolean; goal?: string; questions?: unknown[] } = {}): string {
	return JSON.stringify({ understood: false, goal: "Add parser tests", questions: [SCOPE_QUESTION], ...overrides });
}

/**
 * A model-registry double for the goal clarifier.
 *
 * Returns each reply in turn (the last repeats), and records every request's user
 * text so a test can assert the calls and the answers they carried.
 */
export function clarifyRegistry(replies: Array<string | undefined>): { calls: string[]; registry: unknown } {
	const calls: string[] = [];
	let index = 0;
	return {
		calls,
		registry: {
			complete: async (_model: unknown, context: { messages: Array<{ content: Array<{ text: string }> }> }) => {
				calls.push(context.messages[0].content[0].text);
				const text = replies[Math.min(index, replies.length - 1)];
				index += 1;
				if (text === undefined) return { stopReason: "aborted", content: [] };
				return { stopReason: "stop", content: [{ type: "text", text }] };
			},
		},
	};
}

/** A session entry carrying one `todo` tool result, which is how the goal reads progress. */
export function todoEntry(todos: unknown): unknown {
	return { type: "message", message: { role: "toolResult", toolName: "todo", details: { todos, action: "write" } } };
}
