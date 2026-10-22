/**
 * The `cancel_plan_mode` tool registration.
 *
 * This is the escape hatch that does not need a plan file or a review dialog:
 * when the user asks to leave planning, the model can restore write access
 * without approving anything. The plan store is untouched; a later `/plan` can
 * still review the saved artifact.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { reuseText, toolDetails } from "../../../lib/tui/chrome.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { callLine, detailsOrLine } from "../../../lib/tui/tool.ts";
import { failedResult } from "../../../lib/tool-result.ts";
import { CANCEL_TOOL, type PlanRuntime } from "../runtime.ts";
import type { CancelPlanModeDetails } from "../types.ts";

const CANCELLED_TEXT =
	"Plan mode is off and write access is restored. The plan was not approved; no todo items or goal were recorded. " +
	"Any saved plan file remains for a later review.";

export function registerCancelTool(pi: ExtensionAPI, runtime: PlanRuntime): void {
	pi.registerTool({
		name: CANCEL_TOOL,
		label: "Cancel plan mode",
		description:
			"Leave plan mode without approving a plan. Restores write access; no todo items or goal are recorded. " +
			"Use when the user asks to exit, cancel, or abandon planning.",
		promptSnippet: "Leave plan mode without approving the plan.",
		promptGuidelines: [
			"Call cancel_plan_mode when the user asks to leave or abandon planning without approving a plan.",
		],
		parameters: Type.Object({}),
		defaultActive: false,
		executionMode: "sequential",
		// The mode change touches no files; like enter_plan_mode, it needs no
		// destructive annotation.
		annotations: { readOnlyHint: true, openWorldHint: false },

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (!runtime.isEnabled()) {
				return failedResult("Not in plan mode; there is nothing to cancel.", {
					cancelled: false,
				} satisfies CancelPlanModeDetails);
			}
			runtime.disable(ctx);
			ctx.ui.notify("Plan mode off — full access restored. The plan was not approved.", "info");
			return {
				content: [{ type: "text", text: CANCELLED_TEXT }],
				details: { cancelled: true } satisfies CancelPlanModeDetails,
			};
		},

		renderCall(_args, theme, context) {
			return callLine(theme, context?.lastComponent, CANCEL_TOOL, "left plan mode");
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const outcome = detailsOrLine(
				theme,
				result,
				options.expanded,
				toolDetails<CancelPlanModeDetails>(result.details),
			);
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			text.setText(
				outcome.details.cancelled
					? paint(theme, "warn", "Plan mode off — plan not approved")
					: paint(theme, "meta", "Not in plan mode"),
			);
			return text;
		},
	});
}
