/**
 * The `set_plan_steps` tool registration.
 *
 * It rewrites the plan file's checkboxes in one call, then mirrors the same
 * batch into the todo items approval seeded. A rejected batch leaves both
 * artifacts untouched.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { reuseText, toolDetails } from "../../../lib/tui/chrome.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { rejectionLine, reuseCallText, toolCallTitle } from "../../../lib/tui/tool.ts";
import { describeUpdates, stepLabel } from "../format.ts";
import { SET_PLAN_STEPS_TOOL, type PlanRuntime } from "../runtime.ts";
import { extractPlanSteps } from "../steps.ts";
import type { SetPlanStepsDetails } from "../types.ts";
import { mirrorTodos } from "./todo-seed.ts";

const StepUpdateParams = Type.Object({
	step: Type.Integer({
		minimum: 1,
		description: "1-based step number, in the order the plan was approved.",
	}),
	status: StringEnum(["pending", "completed"] as const, {
		description: "The step's new state.",
	}),
	expected: Type.String({
		description:
			"The step's text as it was listed when the plan was approved. A mismatch refuses the whole batch, so a reordered plan is caught instead of mis-ticked.",
	}),
});

const SetPlanStepsParams = Type.Object({
	plan_path: Type.String({
		description: "Path to the approved plan file, as returned by write_plan or exit_plan_mode.",
	}),
	updates: Type.Array(StepUpdateParams, {
		minItems: 1,
		description:
			"The steps to set; each entry sets one step's checkbox, and the last entry wins for a duplicate step. Pass expected as well to refuse a stale step number.",
	}),
});

type SetPlanStepsArgs = Static<typeof SetPlanStepsParams>;

export function registerSetPlanStepsTool(pi: ExtensionAPI, runtime: PlanRuntime): void {
	pi.registerTool({
		name: SET_PLAN_STEPS_TOOL,
		label: "Set plan steps",
		description:
			"Keep an approved plan file current by setting the checkboxes of the given top-level steps in place. Each step " +
			"number matches the order the plan was approved in; a step can be marked completed or reopened. Only the " +
			"checkboxes change; the step text is left as written. The file is rewritten once, and nothing changes when any " +
			"step is out of range or an entry's expected text no longer matches the file.",
		promptSnippet: "Tick steps off in the approved plan file.",
		promptGuidelines: [
			"After a plan is approved, call set_plan_steps as you complete steps, passing each step's text as expected so a reordered plan is refused instead of mis-ticked.",
		],
		parameters: SetPlanStepsParams,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as SetPlanStepsArgs;
			if (runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Not while planning; refine the plan with write_plan instead." }],
					details: undefined,
					isError: true,
				};
			}
			try {
				const plan = await runtime.plans.setSteps(ctx.cwd, args.plan_path, args.updates);
				const steps = extractPlanSteps(plan.content);
				const done = steps.filter((step) => step.status === "completed").length;
				const todoNote = await mirrorTodos(ctx, args.updates);
				return {
					content: [
						{
							type: "text",
							text: `${describeUpdates(args.updates)} (${done}/${steps.length} done) in ${plan.relativePath}${todoNote}.`,
						},
					],
					details: {
						path: plan.path,
						relativePath: plan.relativePath,
						updates: args.updates,
						done,
						total: steps.length,
					} satisfies SetPlanStepsDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Could not update the plan: ${message}` }],
					details: undefined,
					isError: true,
				};
			}
		},

		renderCall(args, theme, context) {
			const text = reuseCallText(context?.lastComponent);
			const updates = (args as Partial<SetPlanStepsArgs>).updates;
			const label =
				updates && updates.length === 1 && updates[0]?.step !== undefined
					? `step ${updates[0].step}`
					: updates && updates.length > 1
						? `${updates.length} steps`
						: "steps";
			text.setText(toolCallTitle(theme, `${SET_PLAN_STEPS_TOOL} `) + paint(theme, "meta", label));
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<SetPlanStepsDetails>(result.details);
			if (!details) {
				text.setText(rejectionLine(theme, result, options.expanded));
				return text;
			}
			const completed = details.updates.filter((update) => update.status === "completed").map((u) => u.step);
			const pending = details.updates.filter((update) => update.status === "pending").map((u) => u.step);
			const heading =
				completed.length > 0
					? paint(theme, "ok", `${GLYPHS.check} ${stepLabel(completed)} done`) +
						(pending.length > 0 ? paint(theme, "meta", ` · ${stepLabel(pending)} reopened`) : "")
					: paint(theme, "meta", `${stepLabel(pending)} reopened`);
			text.setText(heading + paint(theme, "faint", ` · ${details.done}/${details.total}`));
			return text;
		},
	});
}
