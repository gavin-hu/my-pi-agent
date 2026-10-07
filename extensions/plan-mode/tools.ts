/**
 * Model-facing registration for the plan-mode tool pair.
 *
 * `enter_plan_mode` lets the model ask to plan before touching code; it needs
 * user confirmation. `exit_plan_mode` presents the finished plan for approval;
 * on approval it leaves plan mode and seeds the `todo` tool with the plan's
 * steps (through `ctx.executeTool`, so the todo widget and validation run
 * normally). Without an interactive UI neither tool can ask, so it fails with
 * an actionable message instead of deciding for the user.
 */

import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { ENTER_TOOL, EXIT_TOOL, type PlanRuntime } from "./runtime.ts";
import { extractPlanSteps, type PlanStep } from "./steps.ts";
import type { EnterPlanModeDetails, ExitPlanModeDetails } from "./types.ts";

/** Tool that records the seeded steps; plan-mode only calls it if it exists. */
const TODO_TOOL = "todo";

export const ExitPlanModeParams = Type.Object({
	plan: Type.String({
		description: "The complete plan to execute, as markdown. Include every step so the user can judge it.",
	}),
});

export type ExitPlanModeArgs = Static<typeof ExitPlanModeParams>;

/** Lines of plan shown in an unexpanded result. */
const PREVIEW_LINES = 8;

const ENTER_CONFIRM =
	"Plan mode is read-only exploration: write and edit are disabled and bash is limited to read-only commands. " +
	"Enter plan mode to investigate and propose an approach before making changes?";

const ENTERED_TEXT =
	"You are now in plan mode. Explore read-only, write the full plan in your reply, then call exit_plan_mode and wait " +
	"for the user to approve, keep planning, or ask for a refinement. Write and edit are disabled and bash is limited " +
	"to read-only commands.";

function preview(plan: string): string {
	const lines = plan.split("\n");
	if (lines.length <= PREVIEW_LINES) return plan;
	return [...lines.slice(0, PREVIEW_LINES), `… ${lines.length - PREVIEW_LINES} more lines`].join("\n");
}

/** Seed the todo list with the plan's steps; returns what was recorded. */
async function seedTodos(
	ctx: ExtensionToolContext,
	plan: string,
): Promise<{ recorded: number; steps: PlanStep[] }> {
	const steps = extractPlanSteps(plan);
	if (steps.length === 0) return { recorded: 0, steps };
	const outcome = await ctx.executeTool(TODO_TOOL, {
		todos: steps.map((step) => ({ content: step.content, status: step.status })),
	});
	return { recorded: outcome.isError ? 0 : steps.length, steps };
}

export function registerTools(pi: ExtensionAPI, runtime: PlanRuntime): void {
	pi.registerTool({
		name: ENTER_TOOL,
		label: "Enter plan mode",
		description:
			"Use this proactively before starting a non-trivial implementation task. Getting the user's sign-off on the " +
			"approach before writing code prevents wasted effort and keeps you aligned. Entering plan mode switches you to " +
			"read-only exploration so you can investigate and design, then call exit_plan_mode to present the plan for " +
			"approval. Requires the user to confirm. Not needed for small or obvious changes.",
		promptSnippet: "Ask the user to enter read-only plan mode before a non-trivial implementation task.",
		promptGuidelines: [
			"Call enter_plan_mode before a non-trivial implementation task; skip it for small, obvious changes.",
		],
		parameters: Type.Object({}),
		executionMode: "sequential",
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Already in plan mode." }],
					details: { entered: true } satisfies EnterPlanModeDetails,
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

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold(`${ENTER_TOOL} `)) + theme.fg("muted", "requested plan mode"), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as EnterPlanModeDetails | undefined;
			if (details?.unavailable) return new Text(theme.fg("warning", "No UI to confirm plan mode"), 0, 0);
			if (details?.entered) return new Text(theme.fg("success", "✓ Plan mode enabled"), 0, 0);
			return new Text(theme.fg("muted", "Stayed in normal mode"), 0, 0);
		},
	});

	pi.registerTool({
		name: EXIT_TOOL,
		label: "Exit plan mode",
		description:
			"Present the finished plan and ask the user to approve it. Write the plan in your reply first, then call this " +
			"tool so the user can read it before choosing. On approval, plan mode ends, write access is restored, and the " +
			"plan's steps are recorded in the todo list; the user may instead keep planning or ask for a refinement.",
		promptSnippet: "Present the plan and ask the user to approve leaving plan mode.",
		promptGuidelines: [
			"When plan mode is active, do not edit files; investigate and produce a plan.",
			"Write the full plan in your reply, then call exit_plan_mode so the user can review it before deciding.",
		],
		parameters: ExitPlanModeParams,
		defaultActive: false,
		executionMode: "sequential",
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const plan = (params as ExitPlanModeArgs).plan.trim();

			if (!runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Not in plan mode; there is no plan to approve." }],
					details: { approved: false, plan } satisfies ExitPlanModeDetails,
					isError: true,
				};
			}
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "No interactive UI is available to approve the plan. Present the plan and ask the user to approve it in their reply.",
						},
					],
					details: { approved: false, plan, unavailable: true } satisfies ExitPlanModeDetails,
					isError: true,
				};
			}

			const choice = await ctx.ui.select("Plan mode — what next?", [
				"Approve and execute",
				"Keep planning",
				"Refine the plan",
			]);

			if (choice === "Refine the plan") {
				const refinement = (await ctx.ui.editor("Refine the plan:", ""))?.trim();
				if (refinement) {
					return {
						content: [
							{
								type: "text",
								text: `The user asked to refine the plan: ${refinement}\nStay in plan mode, revise the plan, then call exit_plan_mode again.`,
							},
						],
						details: { approved: false, plan, refined: true, refinement } satisfies ExitPlanModeDetails,
					};
				}
			}

			if (choice !== "Approve and execute") {
				return {
					content: [
						{ type: "text", text: "Plan not approved. Stay in plan mode, ask what to change, and revise the plan." },
					],
					details: { approved: false, plan } satisfies ExitPlanModeDetails,
				};
			}

			runtime.disable(ctx);
			const { recorded, steps } = await seedTodos(ctx, plan);
			const listing =
				steps.length > 0
					? `\n\n${steps.map((step) => `- [${step.status === "completed" ? "x" : " "}] ${step.content}`).join("\n")}`
					: "";
			const tail =
				recorded > 0
					? ` Recorded ${recorded} step${recorded === 1 ? "" : "s"} in the todo list; mark each completed as you finish it.`
					: steps.length > 0
						? " The todo tool is unavailable; keep these steps in mind as you work."
						: " If the todo tool is available, record the steps with it before you start.";
			return {
				content: [
					{ type: "text", text: `Plan approved. Plan mode is off and write access is restored.${tail}${listing}` },
				],
				details: { approved: true, plan, seeded: recorded, steps } satisfies ExitPlanModeDetails,
			};
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold(`${EXIT_TOOL} `)) + theme.fg("muted", "submitted a plan"), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as ExitPlanModeDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			const heading = details.unavailable
				? theme.fg("warning", "No UI to approve the plan")
				: details.approved
					? theme.fg("success", "✓ Plan approved")
					: details.refined
						? theme.fg("accent", "Refining the plan")
						: theme.fg("warning", "Plan not approved");
			const extra = details.refined && details.refinement ? `\n${theme.fg("muted", `↳ ${details.refinement}`)}` : "";
			const body = expanded ? details.plan : preview(details.plan);
			return new Text(`${heading}${extra}\n${theme.fg("dim", body)}`, 0, 0);
		},
	});
}
