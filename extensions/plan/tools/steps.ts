/**
 * The `steps` action of the `plan` tool.
 *
 * It rewrites the plan file's checkboxes in one call, then mirrors the same
 * batch into the todo items approval seeded. A rejected batch leaves both
 * artifacts untouched.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { textResult } from "../../../lib/tool-result.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { callLine, type ToolCallText } from "../../../lib/tui/tool.ts";
import { describeUpdates, stepLabel } from "../format.ts";
import { PLAN_TOOL, type PlanRuntime } from "../runtime.ts";
import { extractPlanSteps } from "../steps.ts";
import type { PlanDetails, SetPlanStepsDetails } from "../types.ts";
import { planRefusal } from "./refusal.ts";
import { mirrorTodos } from "./todo-seed.ts";

/** One step of an `updates` batch, as the tool schema validates it. */
export const StepUpdateParams = Type.Object({
	step: Type.Integer({
		minimum: 1,
		description: "1-based step number, in the order the plan was approved.",
	}),
	status: StringEnum(["pending", "completed"] as const, {
		description:
			"The step's new state: `completed` ticks it, `pending` reopens it. A plan step has no in-progress state.",
	}),
	expected: Type.String({
		description:
			"The step's text as it was listed when the plan was approved. A mismatch refuses the whole batch, so a reordered plan is caught instead of mis-ticked.",
	}),
});

/** The fields `action: "steps"` reads. */
export interface SetPlanStepsArgs {
	plan_path?: string;
	updates?: Array<Static<typeof StepUpdateParams>>;
}

export async function executeSteps(
	runtime: PlanRuntime,
	args: SetPlanStepsArgs,
	ctx: ExtensionToolContext,
): Promise<AgentToolResult<PlanDetails>> {
	if (runtime.isEnabled()) {
		return planRefusal("steps", "Not while planning; refine the plan with `plan` action `write` instead.");
	}
	const planPath = args.plan_path?.trim() ?? "";
	if (planPath === "") {
		return planRefusal(
			"steps",
			"`steps` needs plan_path: the approved plan file, as `plan` action `exit` returned it.",
		);
	}
	const updates = args.updates ?? [];
	if (updates.length === 0) {
		return planRefusal("steps", "`steps` needs updates: the checkbox changes to apply, one entry per step.");
	}
	try {
		const plan = await runtime.plans.setSteps(ctx.cwd, planPath, updates);
		const steps = extractPlanSteps(plan.content);
		const done = steps.filter((step) => step.status === "completed").length;
		const todoNote = await mirrorTodos(ctx, updates);
		return textResult(
			`${describeUpdates(updates)} (${done}/${steps.length} done) in ${plan.relativePath}${todoNote}.`,
			{
				action: "steps",
				path: plan.path,
				relativePath: plan.relativePath,
				updates,
				done,
				total: steps.length,
			} satisfies SetPlanStepsDetails,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return planRefusal("steps", `Could not update the plan: ${message}`);
	}
}

export function callSteps(args: SetPlanStepsArgs, theme: Theme, last: unknown): ToolCallText {
	const updates = args.updates;
	const label =
		updates && updates.length === 1 && updates[0]?.step !== undefined
			? `steps ${updates[0].step}`
			: updates && updates.length > 1
				? `steps ${updates.length} steps`
				: "steps";
	return callLine(theme, last, PLAN_TOOL, label);
}

export function textSteps(details: SetPlanStepsDetails, theme: Theme): string {
	const completed = details.updates.filter((update) => update.status === "completed").map((u) => u.step);
	const pending = details.updates.filter((update) => update.status === "pending").map((u) => u.step);
	const heading =
		completed.length > 0
			? paint(theme, "ok", `${GLYPHS.check} ${stepLabel(completed)} done`) +
				(pending.length > 0 ? paint(theme, "meta", ` · ${stepLabel(pending)} reopened`) : "")
			: paint(theme, "meta", `${stepLabel(pending)} reopened`);
	return heading + paint(theme, "faint", ` · ${details.done}/${details.total}`);
}
