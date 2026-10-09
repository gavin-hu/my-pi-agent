/**
 * Model-facing registration for the `goal` tool.
 *
 * The tool is a whole-goal replacement: the model sends the complete objective,
 * and the previous goal is discarded. An empty objective clears. Validation
 * failures come back as an error result carrying the unchanged goal, so the
 * model can retry without corrupting state.
 */

import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatCallText, formatGoalText, goalObjective, previewObjective } from "./format.ts";
import type { GoalRuntime } from "./runtime.ts";
import { GoalParams, GoalResult, normalizeGoal, type GoalArgs } from "./schema.ts";
import { GoalResult as GoalResultView } from "./tui.ts";
import type { GoalAction, GoalDetails } from "./types.ts";

export const TOOL_NAME = "goal";

/** Longest objective shown in an unexpanded transcript result. */
const RESULT_PREVIEW_WIDTH = 72;

/** Best-effort action of a rejected call, for the error result's details. */
function attemptedAction(args: Partial<GoalArgs>): GoalAction {
	if (args.status === "achieved") return "achieve";
	if (typeof args.objective !== "string" || args.objective.trim() === "") return "clear";
	return "set";
}

/** Themed body for the transcript result: the collapsed preview or the full objective. */
function resultBody(goal: NonNullable<GoalDetails["goal"]>, expanded: boolean, theme: Theme): string {
	const text = expanded ? goal.objective : previewObjective(goal.objective, RESULT_PREVIEW_WIDTH);
	// Route both states through `goalObjective`, so an achieved goal is dimmed
	// whether it is collapsed or expanded.
	return goalObjective({ objective: text, status: goal.status }, theme);
}

/**
 * JSON-safe mirror of the goal for `structuredContent`.
 *
 * `JsonValue` forbids `undefined`, so `goal: null` is an explicit clear and
 * `error` is added only on failure, matching the `details` shape.
 */
function toStructuredContent(details: GoalDetails): Record<string, JsonValue> {
	const content: Record<string, JsonValue> = {
		goal: details.goal === null ? null : { objective: details.goal.objective, status: details.goal.status },
		action: details.action,
	};
	if (details.error !== undefined) content.error = details.error;
	return content;
}

/**
 * Build the tool result for one call. A rejected call (`error` set) carries the
 * unchanged goal so the model can retry, and is marked `isError`.
 */
function goalResult(details: GoalDetails, error?: string) {
	return {
		content: [{ type: "text" as const, text: error === undefined ? formatGoalText(details.goal) : `Error: ${error}` }],
		details,
		structuredContent: toStructuredContent(details),
		...(error === undefined ? {} : { isError: true as const }),
	};
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
			'To mark the goal achieved, resend the objective with status "achieved"; a blank objective is rejected, not a completion.',
			"Mark the goal achieved when it is done; do not leave a finished goal active.",
		],
		parameters: GoalParams,
		outputSchema: GoalResult,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as GoalArgs;
			try {
				const goal = normalizeGoal(args);
				const action = goal === null ? "clear" : goal.status === "achieved" ? "achieve" : "set";
				runtime.setGoal(goal, ctx);
				return goalResult({ goal, action });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return goalResult({ goal: runtime.getGoal(), action: attemptedAction(args), error: message }, message);
			}
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText(
				theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) +
					theme.fg("muted", formatCallText(args.objective, context.argsComplete, args.status)),
			);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = result.details as GoalDetails | undefined;
			if (!details) {
				const first = result.content[0];
				text.setText(first?.type === "text" ? first.text : "");
				return text;
			}
			if (details.error) {
				text.setText(theme.fg("error", `Error: ${details.error}`));
				return text;
			}
			if (!details.goal) {
				// A neutral marker, deliberately not the achieved `✓`.
				text.setText(theme.fg("dim", "⊘ ") + theme.fg("muted", "Cleared the goal"));
				return text;
			}
			const body = resultBody(details.goal, expanded, theme);
			const view =
				context.lastComponent instanceof GoalResultView
					? context.lastComponent
					: new GoalResultView(details.goal, body, theme);
			view.update(details.goal, body, theme);
			return view;
		},
	});
}
