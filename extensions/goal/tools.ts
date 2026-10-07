/**
 * Model-facing registration for the `goal` tool.
 *
 * The tool is a whole-goal replacement: the model sends the complete objective,
 * and the previous goal is discarded. An empty objective clears. Validation
 * failures come back as an error result carrying the unchanged goal, so the
 * model can retry without corrupting state.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatCallText, formatGoalText, goalObjective, previewObjective } from "./format.ts";
import type { GoalRuntime } from "./runtime.ts";
import { GoalParams, normalizeGoal, type GoalArgs } from "./schema.ts";
import { GoalResult } from "./tui.ts";
import type { GoalAction, GoalDetails } from "./types.ts";

export const TOOL_NAME = "goal";

/** Longest objective shown in an unexpanded transcript result. */
const RESULT_PREVIEW_WIDTH = 72;

/** Best-effort action of a rejected call, for the error result's details. */
function attemptedAction(args: Partial<GoalArgs>): GoalAction {
	if (typeof args.objective !== "string" || args.objective.trim() === "") return "clear";
	return args.status === "achieved" ? "achieve" : "set";
}

/** Themed body for the transcript result: the collapsed preview or the full objective. */
function resultBody(goal: NonNullable<GoalDetails["goal"]>, expanded: boolean, theme: Theme): string {
	const text = expanded ? goal.objective : previewObjective(goal.objective, RESULT_PREVIEW_WIDTH);
	// Route both states through `goalObjective`, so an achieved goal is dimmed
	// whether it is collapsed or expanded.
	return goalObjective({ objective: text, status: goal.status }, theme);
}

export function registerTools(pi: ExtensionAPI, runtime: GoalRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Goal",
		description:
			"Record and track the high-level objective for the current session. Send the complete objective on every call; " +
			"it replaces the previous goal, and an empty objective clears it. Set `status` to `active` while pursuing the " +
			"goal and `achieved` when it is done. The active goal is shown above the editor and restated to you before each " +
			"turn so you stay on task.",
		promptSnippet: "Record the session's high-level objective and keep it in view.",
		promptGuidelines: [
			"Use goal to capture the session's high-level objective when starting a substantial task.",
			"Send the complete objective on every goal call; an empty objective clears the goal.",
			"Mark the goal achieved when it is done; do not leave a finished goal active.",
		],
		parameters: GoalParams,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as GoalArgs;
			try {
				const goal = normalizeGoal(args);
				const action = goal === null ? "clear" : goal.status === "achieved" ? "achieve" : "set";
				runtime.setGoal(goal, ctx);
				return {
					content: [{ type: "text", text: formatGoalText(goal) }],
					details: { goal, action } satisfies GoalDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { goal: runtime.getGoal(), action: attemptedAction(args), error: message } satisfies GoalDetails,
					isError: true,
				};
			}
		},

		renderCall(args, theme, context) {
			return new Text(
				theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) +
					theme.fg("muted", formatCallText(args.objective, context.argsComplete, args.status)),
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as GoalDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			if (!details.goal) {
				// A neutral marker, deliberately not the achieved `✓`.
				return new Text(theme.fg("dim", "⊘ ") + theme.fg("muted", "Cleared the goal"), 0, 0);
			}
			return new GoalResult(details.goal, resultBody(details.goal, expanded, theme), theme);
		},
	});
}
