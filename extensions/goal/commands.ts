/**
 * Slash commands for the goal extension.
 *
 * `/goal <prompt>` refines the prompt, lets the user confirm or edit it, then
 * sets the goal and starts the agent on it. Because the command does not produce
 * a tool result, every change is persisted as a `goal` custom entry
 * (`pi.appendEntry`) so the goal follows the session branch like a tool-set goal.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatGoalNotice } from "./format.ts";
import { prepareGoalPrompt } from "./refine.ts";
import type { GoalRuntime } from "./runtime.ts";
import { normalizeGoal } from "./schema.ts";
import { GOAL_ENTRY_TYPE, type Goal } from "./types.ts";

export function registerCommands(pi: ExtensionAPI, runtime: GoalRuntime): void {
	const persist = (goal: Goal | null): void => pi.appendEntry(GOAL_ENTRY_TYPE, { goal });

	pi.registerCommand("goal", {
		description:
			"Set the session goal and start working on it, or show/clear/complete it: /goal [prompt | clear | done]",
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
				const typed = normalizeGoal({ objective: input, status: "active" });
				if (typed === null) {
					ctx.ui.notify("No goal set.", "info");
					return;
				}

				// Refine the prompt, then let the user confirm or edit it. A dismissed
				// dialog cancels the command; a failed or unusable refinement falls back
				// to the typed text.
				const outcome = await prepareGoalPrompt(ctx, typed.objective);
				if (outcome.action === "cancel") return;

				const goal = normalizeGoal({ objective: outcome.text, status: "active" });
				if (goal === null) {
					// An empty editor submission is a cancel, not a clear.
					ctx.ui.notify("Goal not set: the prompt is empty.", "warning");
					return;
				}

				runtime.setGoal(goal, ctx);
				persist(goal);
				ctx.ui.notify(`Goal set (active): ${goal.objective}`, "info");

				// Set the goal before the turn so the reminder it injects carries it.
				// `expandPromptTemplates` stays off: the goal is literal text.
				if (ctx.isIdle()) await pi.sendUserMessage(goal.objective);
				else await pi.sendUserMessage(goal.objective, { deliverAs: "followUp" });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Goal not set: ${message}`, "warning");
			}
		},
	});
}
