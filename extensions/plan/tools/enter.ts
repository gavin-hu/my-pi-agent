/**
 * The `enter` action of the `plan` tool.
 *
 * It asks for confirmation, then turns the runtime's enabled flag on; the tool
 * gating and persistence belong to `runtime.ts`.
 */

import type { AgentToolResult, ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import { isRemoteTurn, remoteLanguage } from "../../../lib/interaction.ts";
import { PLAN_CONSENT, PLAN_CONSENT_SHORT, PLAN_CONSENT_SHORT_ZH, READ_ONLY_SUMMARY } from "../../../lib/plan-entry.ts";
import { failedResult } from "../../../lib/tool-result.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { callLine, type ToolCallText } from "../../../lib/tui/tool.ts";
import { PLAN_TOOL, type PlanRuntime } from "../runtime.ts";
import type { EnterPlanModeDetails } from "../types.ts";

const ENTERED_TEXT =
	"You are now in plan mode. Explore read-only, then save the full plan with `plan` action `write` (a short title and the " +
	"markdown) and call `plan` action `exit` with the returned plan_path so the user can read the file and choose. " +
	`While planning, ${READ_ONLY_SUMMARY}.`;

export async function executeEnter(
	runtime: PlanRuntime,
	ctx: ExtensionToolContext,
): Promise<AgentToolResult<EnterPlanModeDetails>> {
	if (runtime.isEnabled()) {
		return {
			content: [{ type: "text", text: "Already in plan mode." }],
			details: { action: "enter", entered: true, already: true } satisfies EnterPlanModeDetails,
		};
	}
	if (!ctx.hasUI) {
		return failedResult(
			"No interactive UI is available to confirm entering plan mode. Ask the user whether they want a plan.",
			{ action: "enter", entered: false, unavailable: true } satisfies EnterPlanModeDetails,
		);
	}

	const consent = isRemoteTurn(ctx)
		? remoteLanguage(ctx) === "zh"
			? PLAN_CONSENT_SHORT_ZH
			: PLAN_CONSENT_SHORT
		: PLAN_CONSENT;
	const approved = await ctx.ui.confirm("Enter plan mode?", consent);
	if (!approved) {
		return {
			content: [{ type: "text", text: "Stayed in normal mode. Proceed, or ask the user how to continue." }],
			details: { action: "enter", entered: false } satisfies EnterPlanModeDetails,
		};
	}
	runtime.enable(ctx);
	if (isRemoteTurn(ctx)) {
		// The peer UI has no footer chip; say the mode and its exit in the chat.
		ctx.ui.notify("Plan mode on — write access is off. Say “exit plan mode” to leave without approving.", "info");
	}
	return {
		content: [{ type: "text", text: ENTERED_TEXT }],
		details: { action: "enter", entered: true } satisfies EnterPlanModeDetails,
	};
}

export function callEnter(theme: Theme, last: unknown): ToolCallText {
	return callLine(theme, last, PLAN_TOOL, "enter");
}

export function textEnter(details: EnterPlanModeDetails, theme: Theme): string {
	if (details.unavailable) return paint(theme, "warn", "No UI to confirm plan mode");
	if (details.already) return paint(theme, "meta", "Already in plan mode");
	if (details.entered) return paint(theme, "ok", `${GLYPHS.check} Plan mode enabled`);
	return paint(theme, "meta", "Stayed in normal mode");
}
