/**
 * The `exit_plan_mode` tool registration.
 *
 * It presents the saved plan for approval, then seeds the approved steps into
 * the todo list and offers to record the plan as the session goal. The review
 * loop and the browser lifecycle belong to `review.ts`; the nested writes
 * belong to `todo-seed.ts` and the goal tool.
 */

import { basename } from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { sanitizeLine } from "../../../lib/format.ts";
import { lastGoal } from "../../../lib/goal-state.ts";
import { GOAL_TOOL } from "../../../lib/tool-names.ts";
import { reuseText, toolDetails } from "../../../lib/tui/chrome.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { moreHint, rejectionLine, reuseCallText, toolCallTitle } from "../../../lib/tui/tool.ts";
import { feedbackSummary } from "../feedback.ts";
import { mergeSummary, overCap, preview, verificationNote } from "../format.ts";
import { sanitizePlanText } from "../plan-text.ts";
import { planTitle, type StoredPlan } from "../plans.ts";
import { reviewPlan } from "../review.ts";
import { EXIT_TOOL, SET_PLAN_STEPS_TOOL, type PlanRuntime } from "../runtime.ts";
import { MAX_STEPS, planStepSummary } from "../steps.ts";
import type { ExitPlanModeDetails } from "../types.ts";
import type { PlanWebReview } from "../web.ts";
import { firstTextLine } from "./nested.ts";
import { seedTodos } from "./todo-seed.ts";

const ExitPlanModeParams = Type.Object({
	plan_path: Type.String({
		description:
			"Path to the plan file written by write_plan (absolute, or relative to the working directory). The user reviews this file.",
	}),
});

type ExitPlanModeArgs = Static<typeof ExitPlanModeParams>;

/** What the goal offer did: `recorded` undefined when there was nothing to offer. */
interface GoalOffer {
	objective: string;
	recorded?: boolean;
	error?: string;
}

/**
 * Offer to record the approved plan as the session goal — only when the session
 * has no goal at all (an active or achieved one is the user's, never replaced) and
 * the session can ask. The objective is the plan's own `# title`, or the file-name
 * slug; recording runs through the goal tool, so validation and the widget stay
 * goal's, and no model turn is spent.
 */
async function offerSessionGoal(ctx: ExtensionToolContext, plan: StoredPlan): Promise<GoalOffer> {
	const objective = planObjective(plan);
	if (!ctx.hasUI) return { objective };
	// The branch already carries a goal: leave it alone, and say nothing.
	if (lastGoal(ctx.sessionManager.getBranch()) !== null) return { objective };
	const approved = await ctx.ui.confirm("Record this plan as the session goal?", objective);
	if (!approved) return { objective };
	const outcome = await ctx.executeTool(GOAL_TOOL, { objective });
	if (!outcome.isError) return { objective, recorded: true };
	return { objective, recorded: false, error: firstTextLine(outcome) };
}

/** The plan's own title: its first `# heading`, else the file-name slug. */
function planObjective(plan: StoredPlan): string {
	const heading = /^ {0,3}#\s+(.+)$/m.exec(plan.content)?.[1];
	const title = heading === undefined ? "" : sanitizeLine(heading).trim();
	return title || planTitle(basename(plan.path));
}

export function registerExitTool(pi: ExtensionAPI, runtime: PlanRuntime, web: PlanWebReview): void {
	pi.registerTool({
		name: EXIT_TOOL,
		label: "Exit plan mode",
		description:
			"Present the saved plan and ask the user to approve it. Reads the file written by write_plan, so call it with " +
			"plan_path. On approval plan mode ends, write access returns, and the plan's steps go into the todo list; the " +
			"user may instead keep planning or request a refinement. The plan file stays the source of truth.",
		promptSnippet: "Present the saved plan and ask the user to approve leaving plan mode.",
		parameters: ExitPlanModeParams,
		defaultActive: false,
		executionMode: "sequential",
		// readOnlyHint stays true: it writes no files, and the review dialog inside
		// execute is the human gate, so an outer prompt would only double-ask.
		annotations: { readOnlyHint: true, openWorldHint: false },

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const planPath = (params as ExitPlanModeArgs).plan_path.trim();

			if (!runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Not in plan mode; there is no plan to approve." }],
					details: { approved: false, plan: "", planPath } satisfies ExitPlanModeDetails,
					isError: true,
				};
			}

			const file = await runtime.plans.read(ctx.cwd, planPath);
			if (!file) {
				return {
					content: [
						{
							type: "text",
							text: `No plan file at "${planPath}". Save the plan with write_plan first, then pass the returned path.`,
						},
					],
					details: { approved: false, plan: "", planPath } satisfies ExitPlanModeDetails,
					isError: true,
				};
			}

			const total = planStepSummary(file.content).total;
			if (total > MAX_STEPS) {
				// A hand-edited or older plan file can still be over the cap; refuse it here
				// too, so approval never seeds a list it cannot hold in full.
				return {
					content: [
						{
							type: "text",
							text: `${overCap(total)} It was not presented for approval; call write_plan with plan_path to group the steps, then exit_plan_mode again.`,
						},
					],
					details: {
						approved: false,
						plan: file.content,
						planPath: file.path,
						relativePath: file.relativePath,
					} satisfies ExitPlanModeDetails,
					isError: true,
				};
			}

			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: `No interactive UI is available to approve the plan. It is saved at ${file.relativePath}; present it and ask the user to approve it in their reply.`,
						},
					],
					details: {
						approved: false,
						plan: file.content,
						planPath: file.path,
						relativePath: file.relativePath,
						unavailable: true,
					} satisfies ExitPlanModeDetails,
					isError: true,
				};
			}

			// One decision, however the session is attached; `review.ts` owns the loop,
			// the baseline, and closing the browser review when the turn is aborted.
			const decision = await reviewPlan({
				ctx,
				web,
				plans: runtime.plans,
				baselines: runtime,
				plan: file,
				signal,
			});

			if (decision.action === "refine") {
				// A browser save already wrote its comments into the file; either way the
				// model revises the same plan and presents it again.
				const feedback = decision.fromBrowser
					? `The user reviewed the plan in the browser and left feedback:\n${decision.refinement}`
					: `The user asked to refine the plan: ${decision.refinement}`;
				return {
					content: [
						{
							type: "text",
							text: `${feedback}\nStay in plan mode, revise the plan (write_plan, reusing plan_path), then call exit_plan_mode again.`,
						},
					],
					details: {
						approved: false,
						plan: decision.plan.content,
						planPath: decision.plan.path,
						relativePath: decision.plan.relativePath,
						refined: true,
						refinement: decision.refinement,
						annotations: decision.comments.length > 0 ? decision.comments : undefined,
					} satisfies ExitPlanModeDetails,
				};
			}
			if (decision.action === "keep") {
				return {
					content: [
						{ type: "text", text: "Plan not approved. Stay in plan mode, ask what to change, and revise the plan." },
					],
					details: {
						approved: false,
						plan: decision.plan.content,
						planPath: decision.plan.path,
						relativePath: decision.plan.relativePath,
					} satisfies ExitPlanModeDetails,
				};
			}

			runtime.disable(ctx);
			const { steps, merged, error } = await seedTodos(pi, ctx, decision.plan.content);
			const goal = await offerSessionGoal(ctx, decision.plan);
			const listing =
				steps.length > 0
					? `\n\n${steps
							.map((step, index) => `${index + 1}. [${step.status === "completed" ? "x" : " "}] ${step.content}`)
							.join("\n")}`
					: "";
			const tail =
				steps.length === 0
					? " The plan has no steps to record."
					: error
						? ` Could not record the steps in the todo list: ${error}. Keep these steps in mind and tick them off with ${SET_PLAN_STEPS_TOOL} as you go.`
						: merged
							? mergeSummary(merged, steps)
							: ` Could not read the todo list. Record these steps with the todo tool before you start, and tick them off with ${SET_PLAN_STEPS_TOOL}.`;
			const verification = verificationNote(merged);
			const goalNote =
				goal.recorded === undefined
					? ""
					: goal.recorded
						? ` Recorded the session goal: ${goal.objective}.`
						: ` Could not record the session goal: ${goal.error ?? "unknown error"}. Use the goal tool to set it.`;
			const browserNote = decision.comments.length
				? `\n\nThe user approved from the browser review with these comments:\n${feedbackSummary(decision.comments)}`
				: "";
			return {
				content: [
					{
						type: "text",
						text: `Plan approved. Plan mode is off and write access is restored. The plan file ${decision.plan.relativePath} is the source of truth; follow its steps.${browserNote}${tail}${verification}${goalNote}${listing}`,
					},
				],
				details: {
					approved: true,
					plan: decision.plan.content,
					planPath: decision.plan.path,
					relativePath: decision.plan.relativePath,
					annotations: decision.comments.length > 0 ? decision.comments : undefined,
				} satisfies ExitPlanModeDetails,
			};
		},

		renderCall(_args, theme, context) {
			const text = reuseCallText(context?.lastComponent);
			text.setText(toolCallTitle(theme, `${EXIT_TOOL} `) + paint(theme, "meta", "submitted a plan"));
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<ExitPlanModeDetails>(result.details);
			if (!details) {
				text.setText(rejectionLine(theme, result, expanded));
				return text;
			}
			const heading = details.unavailable
				? paint(theme, "warn", "No UI to approve the plan")
				: details.approved
					? paint(theme, "ok", `${GLYPHS.check} Plan approved`)
					: details.refined
						? paint(theme, "accent", "Refining the plan")
						: paint(theme, "warn", "Plan not approved");
			const extra =
				details.refined && details.refinement
					? `\n${paint(theme, "meta", `↳ ${sanitizePlanText(details.refinement)}`)}`
					: "";
			const shown = details.relativePath ?? details.planPath;
			const path = shown ? `\n${paint(theme, "meta", shown)}` : "";
			const planText = sanitizePlanText(details.plan);
			let out = `${heading}${extra}${path}`;
			if (planText) {
				const { body, more } = expanded ? { body: planText, more: 0 } : preview(planText);
				// A blank line separates the header block from the plan body.
				out += `\n\n${theme.fg("toolOutput", body)}`;
				if (more > 0) out += `\n${moreHint(theme, more)}`;
			}
			text.setText(out);
			return text;
		},
	});
}
