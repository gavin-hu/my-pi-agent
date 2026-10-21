/**
 * The `enter_plan_mode` tool registration.
 *
 * It asks for confirmation, then turns the runtime's enabled flag on; the tool
 * gating and persistence belong to `runtime.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { reuseText, toolDetails } from "../../../lib/tui/chrome.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { rejectionLine, reuseCallText, toolCallTitle } from "../../../lib/tui/tool.ts";
import { READ_ONLY_SUMMARY } from "../policy.ts";
import { ENTER_TOOL, type PlanRuntime } from "../runtime.ts";
import type { EnterPlanModeDetails } from "../types.ts";

const ENTER_CONFIRM =
	`Plan mode is read-only exploration: ${READ_ONLY_SUMMARY}. ` +
	"Enter plan mode to investigate and propose an approach before making changes?";

const ENTERED_TEXT =
	"You are now in plan mode. Explore read-only, then save the full plan with write_plan (a short title and the markdown) " +
	"and call exit_plan_mode with the returned path so the user can read the file and choose. " +
	`While planning, ${READ_ONLY_SUMMARY}.`;

export function registerEnterTool(pi: ExtensionAPI, runtime: PlanRuntime): void {
	pi.registerTool({
		name: ENTER_TOOL,
		label: "Enter plan mode",
		description:
			"Enter read-only plan mode: investigate and design, then save the plan with write_plan and present it with " +
			"exit_plan_mode. Entering switches the session's active tool set to read-only and requires the user to confirm.",
		promptSnippet: "Ask the user to enter read-only plan mode.",
		promptGuidelines: [
			"Call enter_plan_mode before a non-trivial implementation task; skip it for small, obvious changes.",
		],
		parameters: Type.Object({}),
		executionMode: "sequential",
		// readOnlyHint stays true: entering plan mode changes only the session's
		// tool set, never files or system state, so it needs no approval.
		annotations: { readOnlyHint: true, openWorldHint: false },

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Already in plan mode." }],
					details: { entered: true, already: true } satisfies EnterPlanModeDetails,
				};
			}
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "No interactive UI is available to confirm entering plan mode. Ask the user whether they want a plan.",
						},
					],
					details: { entered: false, unavailable: true } satisfies EnterPlanModeDetails,
					isError: true,
				};
			}

			const approved = await ctx.ui.confirm("Enter plan mode?", ENTER_CONFIRM);
			if (!approved) {
				return {
					content: [{ type: "text", text: "Stayed in normal mode. Proceed, or ask the user how to continue." }],
					details: { entered: false } satisfies EnterPlanModeDetails,
				};
			}
			runtime.enable(ctx);
			return {
				content: [{ type: "text", text: ENTERED_TEXT }],
				details: { entered: true } satisfies EnterPlanModeDetails,
			};
		},

		renderCall(_args, theme, context) {
			const text = reuseCallText(context?.lastComponent);
			text.setText(toolCallTitle(theme, `${ENTER_TOOL} `) + paint(theme, "meta", "requested plan mode"));
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<EnterPlanModeDetails>(result.details);
			if (!details) {
				text.setText(rejectionLine(theme, result, options.expanded));
				return text;
			}
			if (details.unavailable) text.setText(paint(theme, "warn", "No UI to confirm plan mode"));
			else if (details.already) text.setText(paint(theme, "meta", "Already in plan mode"));
			else if (details.entered) text.setText(paint(theme, "ok", `${GLYPHS.check} Plan mode enabled`));
			else text.setText(paint(theme, "meta", "Stayed in normal mode"));
			return text;
		},
	});
}
