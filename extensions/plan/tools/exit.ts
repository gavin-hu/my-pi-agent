/**
 * The `exit` action of the `plan` tool.
 *
 * It presents the saved plan for approval, then seeds the approved steps into
 * the todo list and finalizes the session goal: a `planning` goal becomes the
 * plan's own `## Goal`, and a session with no goal is given the same. The
 * review loop and the browser lifecycle belong to `review.ts`; the nested writes
 * belong to `todo-seed.ts` and the goal tool.
 */

import { basename } from "node:path";
import type { AgentToolResult, ExtensionAPI, ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../lib/format.ts";
import { lastGoal } from "../../../lib/goal-state.ts";
import { GOAL_TOOL } from "../../../lib/tool-names.ts";
import { failedResult } from "../../../lib/tool-result.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { callLine, moreHint, type ToolCallText } from "../../../lib/tui/tool.ts";
import { feedbackSummary } from "../feedback.ts";
import { mergeSummary, overCap, preview, TICK_CALL, verificationNote } from "../format.ts";
import { sanitizePlanText } from "../plan-text.ts";
import { planTitle, type StoredPlan } from "../plans.ts";
import { reviewPlan } from "../review-lazy.ts";
import { PLAN_TOOL, type PlanRuntime } from "../runtime.ts";
import { goalSection, MAX_STEPS, planStepSummary } from "../steps.ts";
import type { ExitPlanModeDetails, PlanDetails } from "../types.ts";
import type { PlanWebReview } from "../web.ts";
import { firstTextLine } from "./nested.ts";
import { planRefusal } from "./refusal.ts";
import { seedTodos } from "./todo-seed.ts";

/** The fields `action: "exit"` reads. */
export interface ExitPlanModeArgs {
	plan_path?: string;
}

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
 * the goal tool when it is registered — validation and the widget stay goal's,
 * and no model turn is spent — and stays silent when that sibling extension is
 * not installed, because there is nothing to report and nothing to act on.
 */
async function finalizeGoal(pi: ExtensionAPI, ctx: ExtensionToolContext, plan: StoredPlan): Promise<GoalOutcome> {
	const objective = planObjective(plan);
	const current = lastGoal(ctx.sessionManager.getBranch());
	if (current !== null && current.status !== "planning") return { objective };
	if (!pi.getAllTools().some((tool) => tool.name === GOAL_TOOL)) return { objective };
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

export async function executeExit(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview,
	args: ExitPlanModeArgs,
	ctx: ExtensionToolContext,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<PlanDetails>> {
	const planPath = args.plan_path?.trim() ?? "";

	if (!runtime.isEnabled()) {
		return planRefusal("exit", "Not in plan mode; there is no plan to approve.");
	}
	if (planPath === "") {
		return planRefusal("exit", "`exit` needs plan_path: the file `plan` action `write` returned.");
	}

	const file = await runtime.plans.read(ctx.cwd, planPath);
	if (!file) {
		return planRefusal(
			"exit",
			`No plan file at "${planPath}". Save the plan with \`plan\` action \`write\` first, then pass the returned path.`,
		);
	}

	const total = planStepSummary(file.content).total;
	if (total > MAX_STEPS) {
		// A hand-edited or older plan file can still be over the cap; refuse it here
		// too, so approval never seeds a list it cannot hold in full. The refusal
		// carries the file it read, so the block still shows what was not presented.
		return failedResult(
			`Error: ${overCap(total)} It was not presented for approval; call \`plan\` action \`write\` with plan_path to group the steps, then \`exit\` again.`,
			{
				action: "exit",
				approved: false,
				plan: file.content,
				planPath: file.path,
				relativePath: file.relativePath,
			} satisfies ExitPlanModeDetails,
		);
	}

	if (!ctx.hasUI) {
		return failedResult(
			`Error: No interactive UI is available to approve the plan. It is saved at ${file.relativePath}; present it and ask the user to approve it in their reply.`,
			{
				action: "exit",
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
					text: `${feedback}\nStay in plan mode, revise the plan (\`plan\` action \`write\`, reusing plan_path), then call \`plan\` action \`exit\` again.`,
				},
			],
			details: {
				action: "exit",
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
				action: "exit",
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
				action: "exit",
				approved: false,
				cancelled: true,
				plan: decision.plan.content,
				planPath: decision.plan.path,
				relativePath: decision.plan.relativePath,
			} satisfies ExitPlanModeDetails,
		};
	}

	runtime.disable(ctx);
	// A plan refined and approved again seeds over the list its first approval made:
	// the steps that approval appended are the ones this one may replace.
	const previous = runtime.seeded(decision.plan.path);
	const { steps, merged, error } = await seedTodos(pi, ctx, decision.plan.content, previous);
	if (error === undefined && steps.length > 0) {
		runtime.markSeeded(
			decision.plan.path,
			steps.map((step) => step.content),
		);
	}
	const goal = await finalizeGoal(pi, ctx, decision.plan);
	const listing =
		steps.length > 0
			? `\n\n${steps
					.map((step, index) => `${index + 1}. [${step.status === "completed" ? "x" : " "}] ${step.content}`)
					.join("\n")}`
			: "";
	const tick = TICK_CALL;
	const tail =
		steps.length === 0
			? " The plan has no steps to record."
			: error
				? ` Could not record the steps in the todo list: ${error}. Keep these steps in mind and tick them off with ${tick} as you go.`
				: merged
					? mergeSummary(merged, steps)
					: ` Could not read the todo list. Record these steps with the todo tool before you start, and tick them off with ${tick}.`;
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
			action: "exit",
			approved: true,
			plan: decision.plan.content,
			planPath: decision.plan.path,
			relativePath: decision.plan.relativePath,
			annotations: decision.comments.length > 0 ? decision.comments : undefined,
		} satisfies ExitPlanModeDetails,
	};
}

export function callExit(args: ExitPlanModeArgs, theme: Theme, last: unknown): ToolCallText {
	const path = args.plan_path?.trim() ?? "";
	return callLine(theme, last, PLAN_TOOL, path === "" ? "exit" : `exit ${basename(path)}`);
}

export function textExit(details: ExitPlanModeDetails, expanded: boolean, theme: Theme): string {
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
		out += `\n\n${paint(theme, "toolOutput", body)}`;
		if (more > 0) out += `\n${moreHint(theme, more)}`;
	}
	return out;
}
