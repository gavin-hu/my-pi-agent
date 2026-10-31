/**
 * The `write` action of the `plan` tool.
 *
 * The cap refusal happens before the file is written, so approval never lists a
 * step it cannot track; the store owns naming, containment, and atomicity.
 */

import type { AgentToolResult, ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../lib/format.ts";
import { textResult } from "../../../lib/tool-result.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { callLine, type ToolCallText } from "../../../lib/tui/tool.ts";
import { overCap, stepElisionNote } from "../format.ts";
import { PLAN_TOOL, type PlanRuntime } from "../runtime.ts";
import { MAX_STEPS, planStepSummary } from "../steps.ts";
import type { PlanDetails, WritePlanDetails } from "../types.ts";
import { planRefusal } from "./refusal.ts";

/** The fields `action: "write"` reads. */
export interface WritePlanArgs {
	title?: string;
	content?: string;
	plan_path?: string;
}

export async function executeWrite(
	runtime: PlanRuntime,
	args: WritePlanArgs,
	ctx: ExtensionToolContext,
): Promise<AgentToolResult<PlanDetails>> {
	if (!runtime.isEnabled()) {
		return planRefusal("write", "Not in plan mode; call `plan` action `enter` first.");
	}
	const title = args.title?.trim() ?? "";
	if (title === "") {
		return planRefusal("write", "`write` needs a title: a short name for the plan, used as the file-name slug.");
	}
	const content = args.content ?? "";
	if (content.trim() === "") {
		return planRefusal("write", "`write` needs content: the complete plan as markdown in the documented outline.");
	}
	const summary = planStepSummary(content);
	if (summary.total > MAX_STEPS) {
		// Refuse before writing: a note after the fact arrives once the file exists and
		// the review has listed every step, so the overflow is already lost.
		return planRefusal(
			"write",
			`${overCap(summary.total)} Nothing was written; group the steps (one outcome each, sub-bullets for detail) and call \`plan\` action \`write\` again.`,
		);
	}
	try {
		const file = await runtime.plans.write(ctx.cwd, { title, content, planPath: args.plan_path });
		runtime.setLastPlan(ctx, file.path);
		// A store an older version kept in the checkout was moved in by this
		// write; say so once, where the user is looking.
		const moved = runtime.plans.takeNotice();
		if (moved) ctx.ui.notify(moved, "info");
		// A refinement says where the text it replaced went: a reviewer's comment that was
		// carried to a block that moved can be checked against what she actually read.
		const kept =
			file.replaced === undefined ? "" : `, keeping the revision it replaced at ${file.replaced.relativePath}`;
		// A plan that was approved before is now out of step with the todo list, and
		// the list is only re-seeded by approving it again. Say so here, where the
		// refinement is made, instead of letting the two disagree in silence.
		const reseed =
			runtime.seeded(file.path) === undefined
				? ""
				: " This plan was approved before: its todo items are the ones that approval seeded, and approving it again replaces the steps that changed (an item you started or finished is left alone and named).";
		return textResult(
			`Wrote the plan to ${file.relativePath}${kept}. Call \`plan\` action \`exit\` with plan_path: ${file.path}${stepElisionNote(summary.elided)}${reseed}`,
			{
				action: "write",
				path: file.path,
				relativePath: file.relativePath,
				bytes: file.bytes,
			} satisfies WritePlanDetails,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return planRefusal("write", `Could not write the plan: ${message}`);
	}
}

export function callWrite(args: WritePlanArgs, theme: Theme, last: unknown): ToolCallText {
	const title = args.title?.trim() ?? "";
	return callLine(theme, last, PLAN_TOOL, title === "" ? "write" : `write ${sanitizeLine(title)}`);
}

export function textWrite(details: WritePlanDetails, theme: Theme): string {
	return paint(theme, "ok", `${GLYPHS.check} Saved plan `) + paint(theme, "meta", details.relativePath);
}
