/**
 * goal — a persistent session objective for Pi.
 *
 * Registers a single `goal` tool that records the high-level objective for the
 * session, plus a `/goal` command and a widget that mirror it.
 * While the goal is active it is re-injected before each turn so the model
 * stays on task; once achieved it stays visible but stops being restated. The
 * goal is stored in tool-result `details`, so it follows the active session
 * branch and is restored on `/resume` and `/tree`.
 *
 * Load with:  pi --extension ./extensions/goal
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.ts";
import { createGoalRuntime } from "./runtime.ts";
import type { Goal } from "./types.ts";
import { registerTools } from "./tools.ts";

/** Marker embedded in the injected prompt, so it is recognizable in the transcript. */
export const GOAL_CONTEXT_MARKER = "[SESSION GOAL]";

/** Custom-entry type used for the injected context message. */
export const GOAL_CONTEXT_TYPE = "goal-context";

function buildGoalContext(goal: Goal): string {
	return `${GOAL_CONTEXT_MARKER}
The user set this session goal: ${goal.objective}

Keep this objective in mind as you work and let it guide your priorities. Use the goal tool to update it, and mark it achieved when it is done.`;
}

function isGoalContext(message: AgentMessage): boolean {
	// Only the injected message carries this custom type. Matching on the marker
	// text would also capture (and drop) a real user message that contains it.
	return (message as AgentMessage & { customType?: string }).customType === GOAL_CONTEXT_TYPE;
}

export default function goal(pi: ExtensionAPI): void {
	const runtime = createGoalRuntime();

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	pi.on("session_start", (_event, ctx) => runtime.reconstruct(ctx));
	pi.on("session_tree", (_event, ctx) => runtime.reconstruct(ctx));
	pi.on("session_shutdown", (_event, ctx) => runtime.clear(ctx));

	// Restate the goal at the start of each turn while it is active.
	pi.on("before_agent_start", () => {
		const goal = runtime.getGoal();
		if (goal?.status !== "active") return undefined;
		return { message: { customType: GOAL_CONTEXT_TYPE, content: buildGoalContext(goal), display: false } };
	});

	// Keep stale goal restatements out of later turns (for example after the goal
	// is cleared or achieved, or when /resume replays old history).
	pi.on("context", (event) => {
		const active = runtime.getGoal()?.status === "active";
		const contexts = event.messages.filter(isGoalContext);
		if (contexts.length === 0) return undefined;
		if (!active) return { messages: event.messages.filter((message) => !isGoalContext(message)) };
		// `before_agent_start` injects one each turn; keep only the newest so
		// repeated instructions do not accumulate.
		if (contexts.length <= 1) return undefined;
		const last = contexts[contexts.length - 1];
		return { messages: event.messages.filter((message) => !isGoalContext(message) || message === last) };
	});
}
