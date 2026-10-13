/**
 * Slash commands for the goal extension.
 *
 * `/goal <prompt>` classifies the prompt with one model call, then either lets
 * the user confirm or edit it, or — when the goal needs clarification and the
 * question tool is available — delegates the proposed questions to the agent,
 * which asks them and records the clarified goal itself. Because the command
 * does not produce a tool result, every goal it sets is persisted as a `goal`
 * custom entry (`pi.appendEntry`) so it follows the session branch.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL } from "../../lib/tool-names.ts";
import { buildDelegateUserText } from "./clarify-prompt.ts";
import { prepareGoalPrompt } from "./clarify.ts";
import { formatGoalNotice } from "./format.ts";
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

				// Classify the goal, then confirm/edit it. When the clarifier asks for
				// clarification and the question tool is available, hand the questions to
				// the agent instead of setting the goal here. A dismissed dialog cancels
				// the command; a failed or unusable clarification falls back to the typed
				// text.
				const canAsk = pi.getActiveTools().includes(ASK_USER_QUESTION_TOOL);
				const outcome = await prepareGoalPrompt(ctx, typed.objective, canAsk);
				if (outcome.action === "cancel") return;

				if (outcome.action === "ask") {
					ctx.ui.notify("Goal needs clarification; asking the user first.", "info");
					const content = buildDelegateUserText(outcome.original, outcome.goal, outcome.questions);
					// Set no goal: the agent asks, then records the clarified goal itself.
					if (ctx.isIdle()) await pi.sendUserMessage(content);
					else await pi.sendUserMessage(content, { deliverAs: "followUp" });
					return;
				}

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
