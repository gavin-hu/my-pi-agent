/**
 * Model-facing registration for the plan-mode tools.
 *
 * `enter_plan_mode` lets the model ask to plan before touching code; it needs
 * user confirmation. `write_plan` saves the plan artifact under `.pi/plans` and
 * returns its path. `exit_plan_mode` reads that file back, presents it for
 * approval (a scrollable review screen in the TUI, a select dialog elsewhere),
 * and on approval seeds the `todo` tool with the plan's steps (through
 * `ctx.executeTool`, so the todo widget and validation run normally).
 * `set_plan_steps` then keeps the plan current: after approval the model ticks
 * each step off in place as it finishes it, and the todo item approval seeded
 * from that step is ticked with it. The file is the source of truth: the model
 * executes from it.
 *
 * Without an interactive UI the approval tools fail with an actionable message
 * instead of deciding for the user.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { sanitizeLine } from "../../lib/format.ts";
import { lastGoal } from "../../lib/goal-state.ts";
import { GOAL_TOOL, TODO_TOOL } from "../../lib/tool-names.ts";
import { lastTodos } from "../../lib/todo-state.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { rejectionLine, reuseCallText, toolCallTitle } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { expandHint, GLYPHS } from "../../lib/tui/glyphs.ts";
import { READ_ONLY_SUMMARY } from "./policy.ts";
import { feedbackSummary } from "./feedback.ts";
import { ENTER_TOOL, EXIT_TOOL, SET_PLAN_STEPS_TOOL, WRITE_PLAN_TOOL, type PlanRuntime } from "./runtime.ts";
import {
	MAX_STEP_LENGTH,
	MAX_STEPS,
	PLAN_OUTLINE,
	extractPlanSteps,
	planStepSummary,
	verificationItem,
	type PlanStep,
	type StepUpdate,
} from "./steps.ts";
import { basename } from "node:path";
import { planTitle, type StoredPlan } from "./plans.ts";
import { DEFAULT_TODO_MAX, mergeTodos, mirrorStepStatuses, type TodoMerge } from "./todos.ts";
import { reviewPlan } from "./review.ts";
import { sanitizePlanText } from "./plan-text.ts";
import type { EnterPlanModeDetails, ExitPlanModeDetails, SetPlanStepsDetails, WritePlanDetails } from "./types.ts";
import { createPlanWebReview, type PlanWebReview } from "./web.ts";

const ExitPlanModeParams = Type.Object({
	plan_path: Type.String({
		description:
			"Path to the plan file written by write_plan (absolute, or relative to the working directory). The user reviews this file.",
	}),
});

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

type ExitPlanModeArgs = Static<typeof ExitPlanModeParams>;
type WritePlanArgs = Static<typeof WritePlanParams>;
type SetPlanStepsArgs = Static<typeof SetPlanStepsParams>;

/** Lines of plan shown in an unexpanded result. */
const PREVIEW_LINES = 8;

const ENTER_CONFIRM =
	`Plan mode is read-only exploration: ${READ_ONLY_SUMMARY}. ` +
	"Enter plan mode to investigate and propose an approach before making changes?";

const ENTERED_TEXT =
	"You are now in plan mode. Explore read-only, then save the full plan with write_plan (a short title and the markdown) " +
	"and call exit_plan_mode with the returned path so the user can read the file and choose. " +
	`While planning, ${READ_ONLY_SUMMARY}.`;

function preview(plan: string): { body: string; more: number } {
	const lines = plan.split("\n");
	if (lines.length <= PREVIEW_LINES) return { body: plan, more: 0 };
	return { body: lines.slice(0, PREVIEW_LINES).join("\n"), more: lines.length - PREVIEW_LINES };
}

/**
 * One sentence when a step is longer than the display cap. The text stays in the
 * plan file either way; only the todo list and the approval listing shorten it.
 */
function stepElisionNote(elided: number): string {
	if (elided === 0) return "";
	const plural = elided === 1 ? " is" : "s are";
	return ` Note: ${elided} step${plural} longer than ${MAX_STEP_LENGTH} characters and will be shortened in the todo list.`;
}

/**
 * The diagnosis both cap refusals share: a step list longer than approval can
 * track. Each caller appends the fix that is available from where it stands.
 */
function overCap(total: number): string {
	return `The plan has ${total} top-level steps but approval tracks at most ${MAX_STEPS}.`;
}

/** "Step 2" or "Steps 1, 2" for a set of step numbers. */
function stepLabel(steps: number[]): string {
	return `${steps.length === 1 ? "Step" : "Steps"} ${steps.join(", ")}`;
}

/** "Steps 1, 2 completed; step 3 reopened" for the tool's text result. */
function describeUpdates(updates: StepUpdate[]): string {
	const completed = updates.filter((update) => update.status === "completed").map((update) => update.step);
	const pending = updates.filter((update) => update.status === "pending").map((update) => update.step);
	const parts: string[] = [];
	if (completed.length > 0) parts.push(`${stepLabel(completed)} completed`);
	if (pending.length > 0) parts.push(`${stepLabel(pending)} reopened`);
	return parts.join("; ");
}

/**
 * The todo tool's item cap, read from its registered schema so the merge stops
 * before the nested call would reject the list. Falls back to the documented
 * default when the tool is absent or has not declared one.
 */
function todoMaxItems(pi: ExtensionAPI): number {
	const info = pi.getAllTools().find((tool) => tool.name === TODO_TOOL);
	const parameters = info?.parameters as { properties?: { todos?: { maxItems?: unknown } } } | undefined;
	const max = parameters?.properties?.todos?.maxItems;
	return typeof max === "number" && Number.isInteger(max) && max > 0 ? max : DEFAULT_TODO_MAX;
}

/**
 * Record the plan's steps in the todo list. The list is whole-list replacement,
 * so the steps are merged into what the branch already holds: existing items
 * keep their place and status, duplicates are skipped, and the cap defers the
 * rest. Returns what happened for the approval message.
 */
async function seedTodos(
	pi: ExtensionAPI,
	ctx: ExtensionToolContext,
	plan: string,
): Promise<{ steps: PlanStep[]; merged?: TodoMerge; error?: string }> {
	const steps = extractPlanSteps(plan);
	const verification = verificationItem(plan);
	if (steps.length === 0 && !verification) return { steps };
	const merged = mergeTodos(lastTodos(ctx.sessionManager.getBranch()), steps, todoMaxItems(pi), verification);
	// Nothing new to write: every step (and the verification item) is already in
	// the list, or the list is full, so a rewrite would only churn the widget.
	if (merged.added === 0 && merged.trailing !== "added") return { steps, merged };
	const outcome = await ctx.executeTool(TODO_TOOL, { todos: merged.todos });
	if (!outcome.isError) return { steps, merged };
	// The nested call fails both when the tool is unavailable and when it rejects
	// the steps; surface its first line so the caller reports the real reason.
	const part = outcome.result?.content?.find((entry) => entry.type === "text");
	const firstLine = part?.type === "text" ? part.text.split("\n", 1)[0] : undefined;
	return { steps, merged, error: firstLine ? sanitizeLine(firstLine) : undefined };
}

/**
 * Bring the todo items seeded at approval in line with the batch, and describe
 * what happened for the result text.
 *
 * The plan file is authoritative and has already been written, so a nested
 * failure is reported in the result instead of becoming an error result: once
 * one of the two artifacts changed there is no previous state to hand back.
 * Nothing is written when no item changed, so a repeated call does not churn the
 * widget.
 */
async function mirrorTodos(ctx: ExtensionToolContext, updates: readonly StepUpdate[]): Promise<string> {
	const mirror = mirrorStepStatuses(lastTodos(ctx.sessionManager.getBranch()), updates);
	if (mirror.updated === 0) {
		if (mirror.unmatched === 0) return "";
		const steps = mirror.unmatched === 1 ? "1 step has" : `${mirror.unmatched} steps have`;
		return `; ${steps} no matching todo item`;
	}
	const items = mirror.updated === 1 ? "1 todo item" : `${mirror.updated} todo items`;
	const outcome = await ctx.executeTool(TODO_TOOL, { todos: mirror.todos });
	if (!outcome.isError) return `; ${items} updated`;
	const part = outcome.result?.content?.find((entry) => entry.type === "text");
	const firstLine = part?.type === "text" ? part.text.split("\n", 1)[0] : undefined;
	return `; could not update ${items} in the todo list${firstLine ? `: ${sanitizeLine(firstLine)}` : ""}`;
}

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
	const part = outcome.result?.content?.find((entry) => entry.type === "text");
	const firstLine = part?.type === "text" ? part.text.split("\n", 1)[0] : undefined;
	return { objective, recorded: false, error: firstLine ? sanitizeLine(firstLine) : undefined };
}

/** The plan's own title: its first `# heading`, else the file-name slug. */
function planObjective(plan: StoredPlan): string {
	const heading = /^ {0,3}#\s+(.+)$/m.exec(plan.content)?.[1];
	const title = heading === undefined ? "" : sanitizeLine(heading).trim();
	return title || planTitle(basename(plan.path));
}

/**
 * One sentence about the plan's verification item, or "" when the plan has none
 * (or it was already in the list). The item is a todo, not a plan step, so it is
 * ticked in the list rather than in the file.
 */
function verificationNote(merged: TodoMerge | undefined): string {
	if (merged?.trailing === "added") {
		return "\nThe plan's verification section is the last todo item; tick it in the todo list, not in the file.";
	}
	if (merged?.trailing === "deferred") {
		return "\nThe plan's verification section did not fit in the full todo list; keep it in mind.";
	}
	return "";
}

/** What the merge did, for the approval message; `steps` is the plan's step count. */
function mergeSummary(merged: TodoMerge, steps: PlanStep[]): string {
	const total = steps.length;
	const counted = `${merged.added + merged.skipped} of ${total} plan step${total === 1 ? "" : "s"}`;
	const notes = [
		merged.skipped > 0 ? `${merged.skipped} already present` : "",
		merged.kept > 0 ? `${merged.kept} existing kept` : "",
		merged.deferred > 0 ? `${merged.deferred} deferred, list full` : "",
	].filter(Boolean);
	const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
	const tick = `Tick each one off in the file with ${SET_PLAN_STEPS_TOOL} as you finish it, passing the step's text as \`expected\`.`;
	if (merged.added === 0 && merged.skipped === 0) {
		return ` The todo list is full, so no plan steps were added${suffix}. Keep these steps in mind. ${tick}`;
	}
	if (merged.added === 0)
		return ` ${total === 1 ? "The plan's step is" : "Every plan step is"} already in the todo list${suffix}. ${tick}`;
	return ` Merged ${counted} into the todo list${suffix}. ${tick}`;
}

export function registerTools(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview = createPlanWebReview(runtime.plans),
): void {
	pi.registerTool({
		name: ENTER_TOOL,
		label: "Enter plan mode",
		description:
			"Enter read-only plan mode: investigate and design, then save the plan with write_plan and present it with " +
			"exit_plan_mode. Entering switches the session's active tool set to read-only and requires the user to confirm.",
		promptSnippet: "Ask the user to enter read-only plan mode.",
		promptGuidelines: [
			"Call enter_plan_mode before a non-trivial implementation task; skip it for small, obvious changes.",
		],
		parameters: Type.Object({}),
		executionMode: "sequential",
		// readOnlyHint stays true: entering plan mode changes only the session's
		// tool set, never files or system state, so it needs no approval.
		annotations: { readOnlyHint: true, openWorldHint: false },

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Already in plan mode." }],
					details: { entered: true, already: true } satisfies EnterPlanModeDetails,
				};
			}
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "No interactive UI is available to confirm entering plan mode. Ask the user whether they want a plan.",
						},
					],
					details: { entered: false, unavailable: true } satisfies EnterPlanModeDetails,
					isError: true,
				};
			}

			const approved = await ctx.ui.confirm("Enter plan mode?", ENTER_CONFIRM);
			if (!approved) {
				return {
					content: [{ type: "text", text: "Stayed in normal mode. Proceed, or ask the user how to continue." }],
					details: { entered: false } satisfies EnterPlanModeDetails,
				};
			}
			runtime.enable(ctx);
			return {
				content: [{ type: "text", text: ENTERED_TEXT }],
				details: { entered: true } satisfies EnterPlanModeDetails,
			};
		},

		renderCall(_args, theme, context) {
			const text = reuseCallText(context?.lastComponent);
			text.setText(toolCallTitle(theme, `${ENTER_TOOL} `) + paint(theme, "meta", "requested plan mode"));
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<EnterPlanModeDetails>(result.details);
			if (!details) {
				text.setText(rejectionLine(theme, result, options.expanded));
				return text;
			}
			if (details.unavailable) text.setText(paint(theme, "warn", "No UI to confirm plan mode"));
			else if (details.already) text.setText(paint(theme, "meta", "Already in plan mode"));
			else if (details.entered) text.setText(paint(theme, "ok", `${GLYPHS.check} Plan mode enabled`));
			else text.setText(paint(theme, "meta", "Stayed in normal mode"));
			return text;
		},
	});

	pi.registerTool({
		name: WRITE_PLAN_TOOL,
		label: "Write plan",
		description:
			"Save the plan you designed as a markdown file under .pi/plans (project root, or the agent directory outside a " +
			"repository). Write the complete plan, not a summary, in this outline so it is consistent and scannable:\n\n" +
			`${PLAN_OUTLINE}\n\n` +
			"Returns the path to pass to exit_plan_mode; plan_path overwrites an existing file when refining. " +
			`A plan with more than ${MAX_STEPS} top-level steps in its Steps section is refused, so approval never drops steps it cannot track.`,
		promptSnippet: "Save the designed plan as a markdown file under .pi/plans.",
		promptGuidelines: [
			"While plan mode is active, write the full plan with write_plan, then call exit_plan_mode with the returned path.",
		],
		parameters: WritePlanParams,
		defaultActive: false,
		executionMode: "sequential",
		// destructiveHint is true because plan_path overwrites an existing plan
		// file; a plain write creates a new one.
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Not in plan mode; call enter_plan_mode first." }],
					details: undefined,
					isError: true,
				};
			}
			const args = params as WritePlanArgs;
			const summary = planStepSummary(args.content);
			if (summary.total > MAX_STEPS) {
				// Refuse before writing: a note after the fact arrives once the file exists and
				// the review has listed every step, so the overflow is already lost.
				return {
					content: [
						{
							type: "text",
							text: `${overCap(summary.total)} Nothing was written; group the steps (one outcome each, sub-bullets for detail) and call write_plan again.`,
						},
					],
					details: undefined,
					isError: true,
				};
			}
			try {
				const file = await runtime.plans.write(ctx.cwd, {
					title: args.title,
					content: args.content,
					planPath: args.plan_path,
				});
				runtime.setLastPlan(ctx, file.path);
				return {
					content: [
						{
							type: "text",
							text: `Wrote the plan to ${file.relativePath}. Call exit_plan_mode with plan_path: ${file.path}${stepElisionNote(summary.elided)}`,
						},
					],
					details: { path: file.path, relativePath: file.relativePath, bytes: file.bytes } satisfies WritePlanDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Could not write the plan: ${message}` }],
					details: undefined,
					isError: true,
				};
			}
		},

		renderCall(args, theme, context) {
			const text = reuseCallText(context?.lastComponent);
			const title = (args as Partial<WritePlanArgs>).title;
			const suffix = title ? paint(theme, "meta", sanitizeLine(title)) : paint(theme, "meta", "plan");
			text.setText(toolCallTitle(theme, `${WRITE_PLAN_TOOL} `) + suffix);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<WritePlanDetails>(result.details);
			if (!details) {
				text.setText(rejectionLine(theme, result, options.expanded));
				return text;
			}
			text.setText(paint(theme, "ok", `${GLYPHS.check} Saved plan `) + paint(theme, "meta", details.relativePath));
			return text;
		},
	});

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
				if (more > 0) out += `\n${paint(theme, "faint", `… ${more} more lines`)} ${expandHint(theme)}`;
			}
			text.setText(out);
			return text;
		},
	});

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
