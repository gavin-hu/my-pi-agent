/**
 * The `cancel` action of the `plan` tool.
 *
 * This is the escape hatch that does not need a plan file or a review dialog:
 * when the user asks to leave planning, the model can restore write access
 * without approving anything. The plan store is untouched; a later `/plan` can
 * still review the saved artifact.
 */

import type { AgentToolResult, ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import { paint } from "../../../lib/tui/tokens.ts";
import { callLine, type ToolCallText } from "../../../lib/tui/tool.ts";
import { planRefusal } from "./refusal.ts";
import { PLAN_TOOL, type PlanRuntime } from "../runtime.ts";
import type { CancelPlanModeDetails, PlanDetails } from "../types.ts";

const CANCELLED_TEXT =
	"Plan mode is off and write access is restored. The plan was not approved; no todo items or goal were recorded. " +
	"Any saved plan file remains for a later review.";

export async function executeCancel(
	runtime: PlanRuntime,
	ctx: ExtensionToolContext,
): Promise<AgentToolResult<PlanDetails>> {
	if (!runtime.isEnabled()) {
		return planRefusal("cancel", "Not in plan mode; there is nothing to cancel.");
	}
	runtime.disable(ctx);
	ctx.ui.notify("Plan mode off — full access restored. The plan was not approved.", "info");
	return {
		content: [{ type: "text", text: CANCELLED_TEXT }],
		details: { action: "cancel", cancelled: true } satisfies CancelPlanModeDetails,
	};
}

export function callCancel(theme: Theme, last: unknown): ToolCallText {
	return callLine(theme, last, PLAN_TOOL, "cancel");
}

export function textCancel(details: CancelPlanModeDetails, theme: Theme): string {
	return details.cancelled
		? paint(theme, "warn", "Plan mode off — plan not approved")
		: paint(theme, "meta", "Not in plan mode");
}
