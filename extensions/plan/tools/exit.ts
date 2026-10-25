/**
 * The `exit_plan_mode` tool registration.
 *
 * It presents the saved plan for approval, then seeds the approved steps into
 * the todo list and finalizes the session goal: a `planning` goal becomes the
 * plan's own `## Goal`, and a session with no goal is given the same. The
 * review loop and the browser lifecycle belong to `review.ts`; the nested writes
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
import { callLine, detailsOrLine, moreHint } from "../../../lib/tui/tool.ts";
import { failedResult } from "../../../lib/tool-result.ts";
import { feedbackSummary } from "../feedback.ts";
import { mergeSummary, overCap, preview, verificationNote } from "../format.ts";
import { sanitizePlanText } from "../plan-text.ts";
import { planTitle, type StoredPlan } from "../plans.ts";
import { reviewPlan } from "../review.ts";
import { EXIT_TOOL, SET_PLAN_STEPS_TOOL, type PlanRuntime } from "../runtime.ts";
import { goalSection, MAX_STEPS, planStepSummary } from "../steps.ts";
import type { ExitPlanModeDetails } from "../types.ts";
import type { PlanWebReview } from "../web.ts";
import { firstTextLine } from "./nested.ts";
import { seedTodos } from "./todo-seed.ts";

const ExitPlanModeParams = Type.Object({
	plan_path: Type.String({
		description:
			"Path to the plan file written by write_plan: the absolute path it returned, or the `~/…` form it displayed. A bare name resolves inside the plans directory. The user reviews this file.",
	}),
});

type ExitPlanModeArgs = Static<typeof ExitPlanModeParams>;

/** How the goal ended up: no action when it was already final. */
interface GoalOutcome {
	objective: string;
	/** `recorded` for a session with no goal, `promoted` for one that was planning. */
	action?: "recorded" | "promoted";
	error?: string;
}

/**
 * Finalise the session goal from the approved plan.
 *
 * Approving the plan *is* the decision, so neither a `planning` goal nor a
 * session with none is asked again. A final goal (`active` or `achieved`) is the
 * user's own: approving ordinary work never rewrites it. Recording runs through
 * the goal tool, so validation and the widget stay goal's, and no model turn is
 * spent.
 */
async function finalizeGoal(ctx: ExtensionToolContext, plan: StoredPlan): Promise<GoalOutcome> {
	const objective = planObjective(plan);
	const current = lastGoal(ctx.sessionManager.getBranch());
	if (current !== null && current.status !== "planning") return { objective };
	const outcome = await ctx.executeTool(GOAL_TOOL, { objective, status: "active" });
	const action = current === null ? "recorded" : "promoted";
	return outcome.isError ? { objective, action, error: firstTextLine(outcome) } : { objective, action };
}

/** The plan's own objective: its `## Goal` section, else the `# heading`, else the slug. */
function planObjective(plan: StoredPlan): string {
	const stated = goalSection(plan.content);
	if (stated) return sanitizeLine(stated);
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
			const args = params as ExitPlanModeArgs;
			const planPath = args.plan_path.trim();

			if (!runtime.isEnabled()) {
				return failedResult("Not in plan mode; there is no plan to approve.", {
					approved: false,
					plan: "",
					planPath,
				} satisfies ExitPlanModeDetails);
			}

			const file = await runtime.plans.read(ctx.cwd, planPath);
			if (!file) {
				return failedResult(
					`No plan file at "${planPath}". Save the plan with write_plan first, then pass the returned path.`,
					{ approved: false, plan: "", planPath } satisfies ExitPlanModeDetails,
				);
			}

			const total = planStepSummary(file.content).total;
			if (total > MAX_STEPS) {
				// A hand-edited or older plan file can still be over the cap; refuse it here
				// too, so approval never seeds a list it cannot hold in full.
				return failedResult(
					`${overCap(total)} It was not presented for approval; call write_plan with plan_path to group the steps, then exit_plan_mode again.`,
					{
						approved: false,
						plan: file.content,
						planPath: file.path,
						relativePath: file.relativePath,
					} satisfies ExitPlanModeDetails,
				);
			}

			if (!ctx.hasUI) {
				return failedResult(
					`No interactive UI is available to approve the plan. It is saved at ${file.relativePath}; present it and ask the user to approve it in their reply.`,
					{
						approved: false,
						plan: file.content,
						planPath: file.path,
						relativePath: file.relativePath,
						unavailable: true,
					} satisfies ExitPlanModeDetails,
				);
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
			if (decision.action === "cancel") {
				runtime.disable(ctx);
				const shown = decision.plan.relativePath;
				ctx.ui.notify("Plan mode off — full access restored. The plan was not approved.", "info");
				return {
					content: [
						{
							type: "text",
							text:
								"Plan mode is off and write access is restored. The plan was not approved and no steps were recorded. " +
								`The plan file ${shown} remains if the user wants to review it later.`,
						},
					],
					details: {
						approved: false,
						cancelled: true,
						plan: decision.plan.content,
						planPath: decision.plan.path,
						relativePath: decision.plan.relativePath,
					} satisfies ExitPlanModeDetails,
				};
			}

			runtime.disable(ctx);
			const { steps, merged, error } = await seedTodos(pi, ctx, decision.plan.content);
			const goal = await finalizeGoal(ctx, decision.plan);
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
				goal.action === undefined
					? ""
					: goal.error !== undefined
						? ` Could not ${goal.action === "recorded" ? "record" : "update"} the session goal: ${goal.error}. Use the goal tool to set it.`
						: goal.action === "recorded"
							? ` Recorded the session goal: ${goal.objective}.`
							: ` Set the session goal from the plan: ${goal.objective}.`;
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
			return callLine(theme, context?.lastComponent, EXIT_TOOL, "submitted a plan");
		},

		renderResult(result, { expanded }, theme, context) {
			const text = reuseText(context?.lastComponent);
			const outcome = detailsOrLine(theme, result, expanded, toolDetails<ExitPlanModeDetails>(result.details));
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			const details = outcome.details;
			const heading = details.unavailable
				? paint(theme, "warn", "No UI to approve the plan")
				: details.cancelled
					? paint(theme, "warn", "Plan mode off — plan not approved")
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
