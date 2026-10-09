/**
 * Slash commands for the goal extension.
 *
 * Because the command does not produce a tool result, it persists every change
 * as a `goal` custom entry (`pi.appendEntry`) so the goal follows the session
 * branch like a tool-set goal does.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatGoalNotice } from "./format.ts";
import type { GoalRuntime } from "./runtime.ts";
import { normalizeGoal } from "./schema.ts";
import { GOAL_ENTRY_TYPE, type Goal } from "./types.ts";

export function registerCommands(pi: ExtensionAPI, runtime: GoalRuntime): void {
	const persist = (goal: Goal | null): void => pi.appendEntry(GOAL_ENTRY_TYPE, { goal });

	pi.registerCommand("goal", {
		description: "Show, set, clear, or complete the session goal: /goal [text | clear | done]",
		handler: async (args, ctx) => {
			const input = args.trim();

			if (!input) {
				const goal = runtime.getGoal();
				ctx.ui.notify(goal ? formatGoalNotice(goal) : "No goal set.", "info");
				return;
			}

			const keyword = input.toLowerCase();
			if (keyword === "clear") {
				if (!runtime.getGoal()) {
					ctx.ui.notify("No goal set.", "info");
					return;
				}
				runtime.setGoal(null, ctx);
				persist(null);
				ctx.ui.notify("Goal cleared.", "info");
				return;
			}
			if (keyword === "done" || keyword === "achieved") {
				const current = runtime.getGoal();
				if (!current) {
					ctx.ui.notify("No goal set.", "warning");
					return;
				}
				const achieved: Goal = { objective: current.objective, status: "achieved" };
				runtime.setGoal(achieved, ctx);
				persist(achieved);
				ctx.ui.notify(`Goal achieved: ${current.objective}`, "info");
				return;
			}

			try {
				const goal = normalizeGoal({ objective: input, status: "active" });
				if (goal === null) {
					ctx.ui.notify("No goal set.", "info");
					return;
				}
				runtime.setGoal(goal, ctx);
				persist(goal);
				ctx.ui.notify(`Goal set (active): ${goal.objective}`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Goal not set: ${message}`, "warning");
			}
		},
	});
}
