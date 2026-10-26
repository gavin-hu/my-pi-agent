/**
 * The `write_plan` tool registration.
 *
 * The cap refusal happens before the file is written, so approval never lists a
 * step it cannot track; the store owns naming, containment, and atomicity.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { sanitizeLine } from "../../../lib/format.ts";
import { reuseText, toolDetails } from "../../../lib/tui/chrome.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { callLine, detailsOrLine } from "../../../lib/tui/tool.ts";
import { failedResult, textResult } from "../../../lib/tool-result.ts";
import { overCap, stepElisionNote } from "../format.ts";
import { WRITE_PLAN_TOOL, type PlanRuntime } from "../runtime.ts";
import { MAX_STEPS, PLAN_OUTLINE, planStepSummary } from "../steps.ts";
import type { WritePlanDetails } from "../types.ts";

const WritePlanParams = Type.Object({
	title: Type.String({
		description: 'Short title for the plan, used as the file-name slug, e.g. "Add rate limiting".',
	}),
	content: Type.String({
		description: "The complete plan as markdown in the documented outline, including every step.",
	}),
	plan_path: Type.Optional(
		Type.String({
			description:
				"Overwrite an existing plan file (one returned by an earlier write_plan) to refine it instead of creating a new file.",
		}),
	),
});

type WritePlanArgs = Static<typeof WritePlanParams>;

export function registerWriteTool(pi: ExtensionAPI, runtime: PlanRuntime): void {
	pi.registerTool({
		name: WRITE_PLAN_TOOL,
		label: "Write plan",
		description:
			"Save the plan you designed as a markdown file in the plans directory (the agent directory, keyed by " +
			"repository). Write the complete plan, not a summary, in this outline so it is consistent and scannable:\n\n" +
			`${PLAN_OUTLINE}\n\n` +
			"Each section has one job: lead it with its outcome, keep a prose section to a few bullets or two or three " +
			"sentences, give each step one verifiable outcome with the detail in a nested note, and put the sketch, files, " +
			"and commands in inline code or a fence rather than pasted prose. " +
			"When the change alters a surface that already exists, Visual shows it before and after in one fence each; " +
			"tag a fence only when every line in it is code. " +
			"The outline is a guide, not a form: drop Context, Approach, Visual, or Risks when there is nothing to say. " +
			"Keep Steps and Verification — the steps are read from that section (without it, the shallowest list " +
			"anywhere becomes the steps), and Verification becomes the last todo item. " +
			"In Steps, each top-level bullet is one outcome in the order you will do them; " +
			"an indented line continues that outcome, and a deeper bullet is a note. " +
			"Returns the path to pass to exit_plan_mode; plan_path overwrites an existing file when refining. " +
			`A plan with more than ${MAX_STEPS} top-level steps in its Steps section is refused, so approval never drops steps it cannot track.`,
		promptSnippet: "Save the designed plan as a markdown file in the plans directory.",
		promptGuidelines: [
			"While plan mode is active, write the full plan with write_plan, then call exit_plan_mode with the returned path.",
			"When refining with plan_path, keep every section heading as it was: the review marks changed sections by heading, " +
				"so a rename reads as an edit.",
		],
		parameters: WritePlanParams,
		defaultActive: false,
		executionMode: "sequential",
		// destructiveHint is true because plan_path overwrites an existing plan
		// file; a plain write creates a new one.
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!runtime.isEnabled()) {
				return failedResult("Not in plan mode; call enter_plan_mode first.", undefined);
			}
			const args = params as WritePlanArgs;
			const summary = planStepSummary(args.content);
			if (summary.total > MAX_STEPS) {
				// Refuse before writing: a note after the fact arrives once the file exists and
				// the review has listed every step, so the overflow is already lost.
				return failedResult(
					`${overCap(summary.total)} Nothing was written; group the steps (one outcome each, sub-bullets for detail) and call write_plan again.`,
					undefined,
				);
			}
			try {
				const file = await runtime.plans.write(ctx.cwd, {
					title: args.title,
					content: args.content,
					planPath: args.plan_path,
				});
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
					`Wrote the plan to ${file.relativePath}${kept}. Call exit_plan_mode with plan_path: ${file.path}${stepElisionNote(summary.elided)}${reseed}`,
					{ path: file.path, relativePath: file.relativePath, bytes: file.bytes } satisfies WritePlanDetails,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return failedResult(`Could not write the plan: ${message}`, undefined);
			}
		},

		renderCall(args, theme, context) {
			const title = (args as Partial<WritePlanArgs>).title;
			return callLine(theme, context?.lastComponent, WRITE_PLAN_TOOL, title ? sanitizeLine(title) : "plan");
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const outcome = detailsOrLine(theme, result, options.expanded, toolDetails<WritePlanDetails>(result.details));
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			text.setText(
				paint(theme, "ok", `${GLYPHS.check} Saved plan `) + paint(theme, "meta", outcome.details.relativePath),
			);
			return text;
		},
	});
}
