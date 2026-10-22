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
import { GOAL_TOOL } from "../../lib/tool-names.ts";
import { failedResult, textResult } from "../../lib/tool-result.ts";
import { callLine, detailsOrLine } from "../../lib/tui/tool.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { formatCallText, formatGoalText } from "./format.ts";
import { goalPhase } from "./plan-route.ts";
import type { GoalRuntime } from "./runtime.ts";
import { GoalParams, GoalResult, normalizeGoal, type GoalArgs } from "./schema.ts";
import { openTodoCount } from "./state.ts";
import { GoalHeader } from "./tui.ts";
import type { Goal, GoalAction, GoalDetails } from "./types.ts";

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
function goalResult(details: GoalDetails, options: { error?: string; openTodos?: number } = {}) {
	const { error, openTodos = 0 } = options;
	const text = error === undefined ? formatGoalText(details.goal, openTodos) : `Error: ${error}`;
	const structuredContent = toStructuredContent(details);
	return error === undefined
		? textResult(text, details, structuredContent)
		: failedResult(text, details, structuredContent);
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
			const previous = runtime.getGoal();
			try {
				const parsed = normalizeGoal(args);
				if (parsed === null) {
					runtime.setGoal(null, ctx);
					return goalResult({ goal: null, action: "clear" });
				}
				// A `set` may start the planning phase: the phase is asked about and
				// recorded in one place (`plan-route.ts`). An explicit status is the
				// caller's decision — it finalizes a draft and is never asked about — while
				// omitting it lets the workflow decide; `achieved` skips the question either
				// way. A tool run without a context (a wrapped definition outside a session)
				// records the objective without a dialog.
				const explicit = args.status !== undefined;
				const goal: Goal =
					parsed.status === "achieved" || explicit
						? parsed
						: {
								objective: parsed.objective,
								status: ctx ? await goalPhase(pi, ctx, previous, { ask: true }) : "active",
							};
				runtime.setGoal(goal, ctx);
				const action = goal.status === "achieved" ? "achieve" : "set";
				const openTodos = action === "achieve" && ctx ? openTodoCount(ctx.sessionManager.getBranch()) : 0;
				return goalResult({ goal, action }, { openTodos });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return goalResult({ goal: previous, action: attemptedAction(args), error: message }, { error: message });
			}
		},

		renderCall(args, theme, context) {
			return callLine(
				theme,
				context.lastComponent,
				TOOL_NAME,
				formatCallText(args.objective, context.argsComplete, args.status),
			);
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context.lastComponent);
			const outcome = detailsOrLine(theme, result, options.expanded, toolDetails<GoalDetails>(result.details));
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			const details = outcome.details;
			if (!details.goal) {
				// A neutral marker, deliberately not the achieved check.
				text.setText(paint(theme, "faint", `${GLYPHS.stopped} `) + paint(theme, "meta", "Cleared the goal"));
				return text;
			}
			const view =
				context.lastComponent instanceof GoalHeader ? context.lastComponent : new GoalHeader(details.goal, theme);
			view.update(details.goal, theme);
			return view;
		},
	});
}
