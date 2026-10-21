/**
 * goal — a persistent session objective for Pi.
 *
 * Registers a single `goal` tool that records the high-level objective for the
 * session, plus a `/goal` command and a widget that mirror it.
 * The goal has a phase: `planning` while a plan is being designed, `active` once
 * the objective is final, `achieved` when it is done. While it is pursued
 * (`planning` or `active`) it is re-injected before each turn so the model stays
 * on task; once achieved it stays visible but stops being restated. The goal is
 * stored in tool-result `details` and in a `goal` custom entry, so it follows the
 * active session branch and is restored on `/resume` and `/tree`.
 *
 * Load with:  pi --extension ./extensions/goal
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { isPursuedGoal } from "../../lib/goal-state.ts";
import { isPlanModeEnabled } from "../../lib/plan-state.ts";
import { registerCommands } from "./commands.ts";
import { loadGoalConfig } from "./config.ts";
import { createGoalRuntime } from "./runtime.ts";
import { settledGoal } from "./state.ts";
import { GOAL_ENTRY_TYPE, type Goal } from "./types.ts";
import { registerTools } from "./tools.ts";

/** Marker embedded in the injected prompt, so it is recognizable in the transcript. */
export const GOAL_CONTEXT_MARKER = "[SESSION GOAL]";

/** Custom-entry type used for the injected context message. */
export const GOAL_CONTEXT_TYPE = "goal-context";

export function buildGoalContext(goal: Goal): string {
	return `${GOAL_CONTEXT_MARKER}\n${goal.objective}`;
}

function isGoalContext(message: AgentMessage): boolean {
	// Only the injected message carries this custom type. Matching on the marker
	// text would also capture (and drop) a real user message that contains it.
	return (message as AgentMessage & { customType?: string }).customType === GOAL_CONTEXT_TYPE;
}

export default function goal(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("goal")) return;
	const runtime = createGoalRuntime(pi);

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	/**
	 * Settle a goal whose plan phase has ended without an approved plan.
	 *
	 * Plan mode can be left by the toggle, the shortcut, or a resumed branch, and
	 * none of those can call a tool, so the promotion happens here: the draft
	 * becomes the objective because the user chose to act on it. Approval itself
	 * writes the plan's own goal through the tool, so this only catches the exits
	 * that have no plan.
	 */
	const settle = (ctx: ExtensionContext): void => {
		const next = settledGoal(runtime.getGoal(), isPlanModeEnabled(ctx.sessionManager.getBranch()));
		if (next === null) return;
		runtime.setGoal(next, ctx);
		pi.appendEntry(GOAL_ENTRY_TYPE, { goal: next });
	};

	// Load the widget config once per session, before the first reconstruction;
	// a tree jump keeps it and only rebuilds the state.
	const restore = (ctx: ExtensionContext, loadConfig: boolean): void => {
		if (loadConfig) runtime.setConfig(loadGoalConfig(ctx.cwd ?? process.cwd()));
		runtime.reconstruct(ctx);
		settle(ctx);
	};

	pi.on("session_start", (_event, ctx) => restore(ctx, true));
	pi.on("session_tree", (_event, ctx) => restore(ctx, false));
	pi.on("session_shutdown", (_event, ctx) => runtime.clear(ctx));

	// Restate the goal at the start of each turn while it is pursued.
	pi.on("before_agent_start", (_event, ctx) => {
		settle(ctx);
		const goal = runtime.getGoal();
		if (!isPursuedGoal(goal)) return undefined;
		return { message: { customType: GOAL_CONTEXT_TYPE, content: buildGoalContext(goal), display: false } };
	});

	// Keep stale goal restatements out of later turns (for example after the goal
	// is cleared or achieved, or when /resume replays old history).
	pi.on("context", (event) => {
		const pursued = isPursuedGoal(runtime.getGoal());
		const contexts = event.messages.filter(isGoalContext);
		if (contexts.length === 0) return undefined;
		if (!pursued) return { messages: event.messages.filter((message) => !isGoalContext(message)) };
		// `before_agent_start` injects one each turn; keep only the newest so
		// repeated instructions do not accumulate.
		if (contexts.length <= 1) return undefined;
		const last = contexts[contexts.length - 1];
		return { messages: event.messages.filter((message) => !isGoalContext(message) || message === last) };
	});
}
