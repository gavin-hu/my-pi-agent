/**
 * Model-facing registration for the plan-mode tools.
 *
 * `enter_plan_mode` lets the model ask to plan before touching code; it needs
 * user confirmation. `write_plan` saves the plan artifact under `.pi/plans` and
 * returns its path. `exit_plan_mode` reads that file back, presents it for
 * approval (a scrollable review screen in the TUI, a select dialog elsewhere),
 * and on approval seeds the `todo` tool with the plan's steps (through
 * `ctx.executeTool`, so the todo widget and validation run normally). The file
 * is the source of truth: the model executes from it.
 *
 * Without an interactive UI the approval tools fail with an actionable message
 * instead of deciding for the user.
 */

import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { TODO_TOOL } from "../../lib/tool-names.ts";
import { FULL_SCREEN_OVERLAY } from "../../lib/tui.ts";
import { expandHint } from "../../lib/ui.ts";
import { READ_ONLY_SUMMARY } from "./policy.ts";
import { ENTER_TOOL, EXIT_TOOL, WRITE_PLAN_TOOL, type PlanRuntime } from "./runtime.ts";
import { extractPlanSteps, type PlanStep } from "./steps.ts";
import { PlanViewComponent, sanitizePlanText, type PlanViewAction } from "./tui.ts";
import type { EnterPlanModeDetails, ExitPlanModeDetails, WritePlanDetails } from "./types.ts";

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
		description: "The complete plan as markdown, including every step, so the user can read and judge it.",
	}),
	plan_path: Type.Optional(
		Type.String({
			description:
				"Overwrite an existing plan file (one returned by an earlier write_plan) to refine it instead of creating a new file.",
		}),
	),
});

type ExitPlanModeArgs = Static<typeof ExitPlanModeParams>;
type WritePlanArgs = Static<typeof WritePlanParams>;

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

/** Seed the todo list with the plan's steps; returns what was recorded. */
async function seedTodos(ctx: ExtensionToolContext, plan: string): Promise<{ recorded: number; steps: PlanStep[] }> {
	const steps = extractPlanSteps(plan);
	if (steps.length === 0) return { recorded: 0, steps };
	const outcome = await ctx.executeTool(TODO_TOOL, {
		todos: steps.map((step) => ({ content: step.content, status: step.status })),
	});
	return { recorded: outcome.isError ? 0 : steps.length, steps };
}

/** The review choice plus the refinement the user typed in the TUI, if any. */
interface PlanReviewOutcome {
	action: PlanViewAction;
	refinement?: string;
}

/** Prompt shown by the dialog-based refine editor in non-TUI modes. */
const REFINE_PROMPT = "Refine the plan — what should change? (Enter to save, Esc to cancel)";

/**
 * Ask the user to review the plan file. The TUI opens the scrollable review
 * screen (with an inline refine editor); dialog-capable modes (RPC) fall back
 * to a select plus the refine editor; the caller has already refused when there
 * is no UI.
 */
async function reviewPlan(
	ctx: ExtensionToolContext,
	plan: { path: string; relativePath: string; content: string; bytes: number },
): Promise<PlanReviewOutcome> {
	if (ctx.mode === "tui") {
		const outcome = await ctx.ui.custom<PlanReviewOutcome | undefined>(
			(tui, theme, _keybindings, done) =>
				new PlanViewComponent({
					plan,
					theme,
					onClose: (action, refinement) => done({ action, refinement }),
					requestRender: () => tui.requestRender(),
					viewportRows: () => tui.terminal?.rows,
					tui,
				}),
			FULL_SCREEN_OVERLAY,
		);
		return outcome ?? { action: "keep" };
	}

	const choice = await ctx.ui.select("Plan mode — what next?", [
		"Approve and execute",
		"Refine the plan",
		"Keep planning",
	]);
	if (choice === "Approve and execute") return { action: "approve" };
	if (choice === "Refine the plan") return { action: "refine" };
	return { action: "keep" };
}

export function registerTools(pi: ExtensionAPI, runtime: PlanRuntime): void {
	pi.registerTool({
		name: ENTER_TOOL,
		label: "Enter plan mode",
		description:
			"Use this proactively before starting a non-trivial implementation task. Getting the user's sign-off on the " +
			"approach before writing code prevents wasted effort and keeps you aligned. Entering plan mode switches you to " +
			"read-only exploration so you can investigate and design, then save the plan with write_plan and call " +
			"exit_plan_mode to present it for approval. Requires the user to confirm. Not needed for small or obvious changes.",
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
			const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold(`${ENTER_TOOL} `)) + theme.fg("muted", "requested plan mode"));
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = result.details as EnterPlanModeDetails | undefined;
			if (details?.unavailable) text.setText(theme.fg("warning", "No UI to confirm plan mode"));
			else if (details?.already) text.setText(theme.fg("muted", "Already in plan mode"));
			else if (details?.entered) text.setText(theme.fg("success", "✓ Plan mode enabled"));
			else text.setText(theme.fg("muted", "Stayed in normal mode"));
			return text;
		},
	});

	pi.registerTool({
		name: WRITE_PLAN_TOOL,
		label: "Write plan",
		description:
			"Save the plan you have designed as a markdown file under .pi/plans (project root, or the agent directory " +
			"outside a repository). The file is the plan the user reviews and approves, so write the complete plan, not a " +
			"summary. Returns the path; pass it to exit_plan_mode. Use plan_path to overwrite the same file when refining a " +
			"plan instead of creating a new one.",
		promptSnippet: "Save the designed plan as a markdown file under .pi/plans.",
		promptGuidelines: [
			"While plan mode is active, write the full plan with write_plan, then call exit_plan_mode with the returned path.",
			"Use a short, descriptive title; it becomes the plan file's slug.",
		],
		parameters: WritePlanParams,
		defaultActive: false,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Not in plan mode; call enter_plan_mode first." }],
					details: undefined,
					isError: true,
				};
			}
			const args = params as WritePlanArgs;
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
							text: `Wrote the plan to ${file.relativePath}. Call exit_plan_mode with plan_path: ${file.path}`,
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
			const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const title = (args as Partial<WritePlanArgs>).title;
			const suffix = title ? theme.fg("muted", title) : theme.fg("muted", "plan");
			text.setText(theme.fg("toolTitle", theme.bold(`${WRITE_PLAN_TOOL} `)) + suffix);
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = result.details as WritePlanDetails | undefined;
			if (!details) {
				const first = result.content[0];
				text.setText(first?.type === "text" ? first.text : "");
				return text;
			}
			text.setText(theme.fg("success", "✓ Saved plan ") + theme.fg("muted", details.relativePath));
			return text;
		},
	});

	pi.registerTool({
		name: EXIT_TOOL,
		label: "Exit plan mode",
		description:
			"Present the saved plan and ask the user to approve it. Read the plan file written by write_plan, then call this " +
			"tool with plan_path so the user can review it before choosing. On approval plan mode ends, write access is " +
			"restored, and the plan's steps are recorded in the todo list; the user may instead keep planning or ask for a " +
			"refinement. The plan file stays the source of truth as you execute.",
		promptSnippet: "Present the saved plan and ask the user to approve leaving plan mode.",
		promptGuidelines: [
			"When plan mode is active, do not edit files; investigate and produce a plan.",
			"Save the plan with write_plan, then call exit_plan_mode with the returned plan_path.",
			"After approval, treat the plan file as the source of truth and follow its steps.",
		],
		parameters: ExitPlanModeParams,
		defaultActive: false,
		executionMode: "sequential",
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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

			let outcome = await reviewPlan(ctx, file);
			// The dialog-based refine editor carries no text from the review screen; an
			// empty or cancelled editor returns to the review instead of being reported
			// as "not approved".
			while (outcome.action === "refine" && !outcome.refinement) {
				const refinement = (await ctx.ui.editor(REFINE_PROMPT, ""))?.trim();
				if (refinement) {
					outcome = { action: "refine", refinement };
					break;
				}
				outcome = await reviewPlan(ctx, file);
			}

			if (outcome.action === "refine") {
				const refinement = outcome.refinement ?? "";
				return {
					content: [
						{
							type: "text",
							text: `The user asked to refine the plan: ${refinement}\nStay in plan mode, revise the plan (write_plan, reusing plan_path), then call exit_plan_mode again.`,
						},
					],
					details: {
						approved: false,
						plan: file.content,
						planPath: file.path,
						relativePath: file.relativePath,
						refined: true,
						refinement,
					} satisfies ExitPlanModeDetails,
				};
			}

			if (outcome.action !== "approve") {
				return {
					content: [
						{ type: "text", text: "Plan not approved. Stay in plan mode, ask what to change, and revise the plan." },
					],
					details: {
						approved: false,
						plan: file.content,
						planPath: file.path,
						relativePath: file.relativePath,
					} satisfies ExitPlanModeDetails,
				};
			}

			runtime.disable(ctx);
			const { recorded, steps } = await seedTodos(ctx, file.content);
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
					{
						type: "text",
						text: `Plan approved. Plan mode is off and write access is restored. The plan file ${file.relativePath} is the source of truth; follow its steps.${tail}${listing}`,
					},
				],
				details: {
					approved: true,
					plan: file.content,
					planPath: file.path,
					relativePath: file.relativePath,
					seeded: recorded,
					steps,
				} satisfies ExitPlanModeDetails,
			};
		},

		renderCall(_args, theme, context) {
			const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold(`${EXIT_TOOL} `)) + theme.fg("muted", "submitted a plan"));
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = result.details as ExitPlanModeDetails | undefined;
			if (!details) {
				const first = result.content[0];
				text.setText(first?.type === "text" ? first.text : "");
				return text;
			}
			const heading = details.unavailable
				? theme.fg("warning", "No UI to approve the plan")
				: details.approved
					? theme.fg("success", "✓ Plan approved")
					: details.refined
						? theme.fg("accent", "Refining the plan")
						: theme.fg("warning", "Plan not approved");
			const extra =
				details.refined && details.refinement
					? `\n${theme.fg("muted", `↳ ${sanitizePlanText(details.refinement)}`)}`
					: "";
			const shown = details.relativePath ?? details.planPath;
			const path = shown ? `\n${theme.fg("muted", shown)}` : "";
			const planText = sanitizePlanText(details.plan);
			let out = `${heading}${extra}${path}`;
			if (planText) {
				const { body, more } = expanded ? { body: planText, more: 0 } : preview(planText);
				// A blank line separates the header block from the plan body.
				out += `\n\n${theme.fg("toolOutput", body)}`;
				if (more > 0) out += `\n${theme.fg("dim", `… ${more} more lines`)} ${expandHint(theme)}`;
			}
			text.setText(out);
			return text;
		},
	});
}
