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
import { checkbox } from "../../../lib/tui/rows.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { callLine, moreHint, type ToolCallText } from "../../../lib/tui/tool.ts";
import { feedbackSummary } from "../feedback.ts";
import { mergeSummary, overCap, preview, TICK_CALL, verificationNote } from "../format.ts";
import { sanitizePlanText, taskMarker } from "../plan-text.ts";
import { planTitle, type StoredPlan } from "../plans.ts";
import { reviewPlan } from "../review-lazy.ts";
import { PLAN_TOOL, type PlanRuntime } from "../runtime.ts";
import { goalSection, MAX_STEPS, planStepSummary } from "../steps.ts";
import type { ExitPlanModeDetails, PlanDetails } from "../types.ts";
import type { PlanWebReview } from "../web.ts";
import { firstTextLine } from "./nested.ts";
import { planRefusal } from "./refusal.ts";
import { seededCount, seedTodos } from "./todo-seed.ts";

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
 * What approving would do to the session goal, asked both before the review — so
 * the screen can say it — and after it, so the act reads one rule.
 *
 * Approving the plan *is* the decision, so neither a `planning` goal nor a session
 * with none is asked again. A final goal (`active` or `achieved`) is the user's
 * own: approving ordinary work never rewrites it. A missing `goal` tool leaves
 * nothing to report and nothing to act on.
 */
function goalAction(pi: ExtensionAPI, ctx: ExtensionToolContext): GoalOutcome["action"] {
	const current = lastGoal(ctx.sessionManager.getBranch());
	if (current !== null && current.status !== "planning") return undefined;
	if (!pi.getAllTools().some((tool) => tool.name === GOAL_TOOL)) return undefined;
	return current === null ? "recorded" : "promoted";
}

/**
 * Finalise the session goal from the approved plan, when {@link goalAction} says
 * there is one to set. Recording runs through the goal tool — validation and the
 * widget stay goal's, and no model turn is spent.
 */
async function finalizeGoal(pi: ExtensionAPI, ctx: ExtensionToolContext, plan: StoredPlan): Promise<GoalOutcome> {
	const objective = planObjective(plan);
	const action = goalAction(pi, ctx);
	if (action === undefined) return { objective };
	const outcome = await ctx.executeTool(GOAL_TOOL, { objective, status: "active" });
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

	if (file.content.trim() === "") {
		// Nothing to approve, and approving it would finalize a goal named after the
		// file's slug. Refused here rather than on the review screen, so no surface —
		// screen, dialog, or browser page — ever offers `a` for it.
		return planRefusal(
			"exit",
			`The plan file ${file.relativePath} is empty, so there is nothing to approve. Write it with \`plan\` action \`write\` (pass plan_path to reuse that file), or leave plan mode with \`plan\` action \`cancel\`.`,
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

	// What an approval would add, asked before anyone answers: the screen names the steps it
	// seeds, not the plan's step count, so a re-approval whose items are already there drops
	// the clause instead of promising a merge it will not make.
	const seeded = seededCount(pi, ctx, file.content, runtime.seeded(file.path));
	// One decision, however the session is attached; `review.ts` owns the loop,
	// the baseline, and closing the browser review when the turn is aborted.
	const decision = await reviewPlan({
		ctx,
		web,
		plans: runtime.plans,
		baselines: runtime,
		plan: file,
		approval: { steps: seeded, setsGoal: goalAction(pi, ctx) !== undefined },
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
	if (decision.action === "interrupt") {
		// The reader asked for the turn to stop, not for a decision about the plan,
		// so plan mode is left as it was and nothing is written down but this block.
		// Aborting is what ends the turn; the result is the record it leaves.
		ctx.abort();
		return {
			content: [
				{
					type: "text",
					text: "The review was interrupted. Plan mode is still on, write access is still off, and the plan was not approved; nothing was recorded. Wait for the user's next message.",
				},
			],
			details: {
				action: "exit",
				approved: false,
				interrupted: true,
				plan: decision.plan.content,
				planPath: decision.plan.path,
				relativePath: decision.plan.relativePath,
			} satisfies ExitPlanModeDetails,
		};
	}
	if (decision.action === "cancel") {
		runtime.disable(ctx);
		const shown = decision.plan.relativePath;
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
	// the items those approvals appended are the ones this one may replace.
	const previous = runtime.seeded(decision.plan.path);
	const { steps, merged, error } = await seedTodos(pi, ctx, decision.plan.content, previous);
	// The record is the items this plan owns, not the plan's steps: a step the list
	// already held is the reader's item and is never claimed, and the verification line is
	// recorded because it is seeded like a step is.
	if (error === undefined && merged !== undefined) runtime.markSeeded(decision.plan.path, merged.seeded);
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
		: details.interrupted
			? paint(theme, "warn", "Plan review interrupted")
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
		out += `\n\n${planBody(theme, body)}`;
		if (more > 0) out += `\n${moreHint(theme, more)}`;
	}
	return out;
}

/**
 * The plan body as this block shows it: the plan's own text, with its task items
 * drawn through the review screen's `◼`/`◻` boxes.
 *
 * Line by line because the box carries its own role: one `paint` over the whole body
 * would end at the box's reset and leave the rest of that line plain.
 */
function planBody(theme: Theme, body: string): string {
	return body
		.split("\n")
		.map((line) => {
			const marker = taskMarker(line);
			if (marker === null) return paint(theme, "toolOutput", line);
			const pre = paint(theme, "toolOutput", marker.pre);
			const post = paint(theme, "toolOutput", marker.post);
			return `${pre}${checkbox(theme, marker.checked)}${post}`;
		})
		.join("\n");
}
