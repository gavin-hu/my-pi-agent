/**
 * Model-facing registration for the `goal` tool.
 *
 * The tool is a whole-goal replacement: the model sends the complete objective,
 * and the previous goal is discarded. An empty objective clears. Validation
 * failures come back as an error result carrying the unchanged goal, so the
 * model can retry without corrupting state.
 */

import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import { GOAL_TOOL } from "../../lib/tool-names.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { rejectionLine, reuseCallText, toolCallTitle } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { formatCallText, formatGoalText } from "./format.ts";
import type { GoalRuntime } from "./runtime.ts";
import { GoalParams, GoalResult, normalizeGoal, type GoalArgs } from "./schema.ts";
import { GoalResult as GoalResultView } from "./tui.ts";
import type { GoalAction, GoalDetails } from "./types.ts";

export const TOOL_NAME = GOAL_TOOL;

/** Best-effort action of a rejected call, for the error result's details. */
function attemptedAction(args: Partial<GoalArgs>): GoalAction {
	if (args.status === "achieved") return "achieve";
	if (typeof args.objective !== "string" || args.objective.trim() === "") return "clear";
	return "set";
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
			"goal and `achieved` when done. It is shown above the editor and restated before each turn.",
		promptSnippet: "Record the session's high-level objective.",
		promptGuidelines: [
			"Use goal to capture the session's high-level objective when starting a substantial task.",
			'Mark it achieved by resending the objective with status "achieved"; a blank objective clears the goal, so it is rejected as a completion.',
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
			const text = reuseCallText(context.lastComponent);
			text.setText(
				toolCallTitle(theme, `${TOOL_NAME} `) +
					paint(theme, "meta", formatCallText(args.objective, context.argsComplete, args.status)),
			);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context.lastComponent);
			const details = toolDetails<GoalDetails>(result.details);
			if (!details) {
				text.setText(rejectionLine(theme, result, options.expanded));
				return text;
			}
			if (details.error) {
				text.setText(paint(theme, "bad", `Error: ${sanitizeLine(details.error)}`));
				return text;
			}
			if (!details.goal) {
				// A neutral marker, deliberately not the achieved check.
				text.setText(paint(theme, "faint", `${GLYPHS.stopped} `) + paint(theme, "meta", "Cleared the goal"));
				return text;
			}
			const view =
				context.lastComponent instanceof GoalResultView
					? context.lastComponent
					: new GoalResultView(details.goal, theme);
			view.update(details.goal, theme);
			return view;
		},
	});
}
