/**
 * Model-facing registration for the plan-mode tools.
 *
 * `enter_plan_mode` lets the model ask to plan before touching code; it needs
 * user confirmation. `write_plan` saves the plan artifact under `.pi/plans` and
 * returns its path. `exit_plan_mode` reads that file back, presents it for
 * approval (a scrollable review screen in the TUI, a select dialog elsewhere),
 * and on approval seeds the `todo` tool with the plan's steps (through
 * `ctx.executeTool`, so the todo widget and validation run normally).
 * `set_plan_step` then keeps the file current: after approval the model ticks
 * each step off in place as it finishes it. The file is the source of truth:
 * the model executes from it.
 *
 * Without an interactive UI the approval tools fail with an actionable message
 * instead of deciding for the user.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import { Type, type Static } from "typebox";
import { sanitizeLine } from "../../lib/format.ts";
import { askHuman } from "../../lib/interaction.ts";
import { TODO_TOOL } from "../../lib/tool-names.ts";
import { FULL_SCREEN_OVERLAY, reuseText, toolDetails } from "../../lib/tui.ts";
import { expandHint } from "../../lib/ui.ts";
import { READ_ONLY_SUMMARY } from "./policy.ts";
import { feedbackSummary } from "./feedback.ts";
import { ENTER_TOOL, EXIT_TOOL, SET_PLAN_STEP_TOOL, WRITE_PLAN_TOOL, type PlanRuntime } from "./runtime.ts";
import { PLAN_OUTLINE, extractPlanSteps, type PlanStep } from "./steps.ts";
import { PlanViewComponent, sanitizePlanText, type PlanViewAction } from "./tui.ts";
import type { EnterPlanModeDetails, ExitPlanModeDetails, SetPlanStepDetails, WritePlanDetails } from "./types.ts";
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

const SetPlanStepParams = Type.Object({
	plan_path: Type.String({
		description: "Path to the approved plan file, as returned by write_plan or exit_plan_mode.",
	}),
	step: Type.Integer({
		minimum: 1,
		description: "1-based step number, in the order the plan was approved.",
	}),
	status: StringEnum(["pending", "completed"] as const, {
		description: "The step's new state.",
	}),
});

type ExitPlanModeArgs = Static<typeof ExitPlanModeParams>;
type WritePlanArgs = Static<typeof WritePlanParams>;
type SetPlanStepArgs = Static<typeof SetPlanStepParams>;

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
async function seedTodos(
	ctx: ExtensionToolContext,
	plan: string,
): Promise<{ recorded: number; steps: PlanStep[]; error?: string }> {
	const steps = extractPlanSteps(plan);
	if (steps.length === 0) return { recorded: 0, steps };
	const outcome = await ctx.executeTool(TODO_TOOL, {
		todos: steps.map((step) => ({ content: step.content, status: step.status })),
	});
	if (!outcome.isError) return { recorded: steps.length, steps };
	// The nested call fails both when the tool is unavailable and when it rejects
	// the steps; surface its first line so the caller reports the real reason.
	const part = outcome.result?.content?.find((entry) => entry.type === "text");
	const firstLine = part?.type === "text" ? part.text.split("\n", 1)[0] : undefined;
	return { recorded: 0, steps, error: firstLine ? sanitizeLine(firstLine) : undefined };
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
	return askHuman(ctx, {
		custom: async () => {
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
		},
		dialogs: async () => {
			const choice = await ctx.ui.select("Plan mode — what next?", [
				"Approve and execute",
				"Refine the plan",
				"Keep planning",
			]);
			if (choice === "Approve and execute") return { action: "approve" };
			if (choice === "Refine the plan") return { action: "refine" };
			return { action: "keep" };
		},
		// A remote turn gets the plan file up front, falling back to the full text;
		// a local TUI turn ignores both and renders the component.
		file: { path: plan.path, name: basename(plan.relativePath) },
		body: plan.content,
	});
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
		annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },

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
			const text = reuseText(context?.lastComponent);
			text.setText(theme.fg("toolTitle", theme.bold(`${ENTER_TOOL} `)) + theme.fg("muted", "requested plan mode"));
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<EnterPlanModeDetails>(result.details);
			if (!details) {
				const first = result.content[0];
				text.setText(first?.type === "text" ? first.text : "");
				return text;
			}
			if (details.unavailable) text.setText(theme.fg("warning", "No UI to confirm plan mode"));
			else if (details.already) text.setText(theme.fg("muted", "Already in plan mode"));
			else if (details.entered) text.setText(theme.fg("success", "✓ Plan mode enabled"));
			else text.setText(theme.fg("muted", "Stayed in normal mode"));
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
			"Returns the path to pass to exit_plan_mode; plan_path overwrites an existing file when refining.",
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
			const text = reuseText(context?.lastComponent);
			const title = (args as Partial<WritePlanArgs>).title;
			const suffix = title ? theme.fg("muted", sanitizeLine(title)) : theme.fg("muted", "plan");
			text.setText(theme.fg("toolTitle", theme.bold(`${WRITE_PLAN_TOOL} `)) + suffix);
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<WritePlanDetails>(result.details);
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
			"Present the saved plan and ask the user to approve it. Reads the file written by write_plan, so call it with " +
			"plan_path. On approval plan mode ends, write access returns, and the plan's steps go into the todo list; the " +
			"user may instead keep planning or request a refinement. The plan file stays the source of truth.",
		promptSnippet: "Present the saved plan and ask the user to approve leaving plan mode.",
		parameters: ExitPlanModeParams,
		defaultActive: false,
		executionMode: "sequential",
		// readOnlyHint stays true: it writes no files, and the review dialog inside
		// execute is the human gate, so an outer prompt would only double-ask.
		annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const planPath = (params as ExitPlanModeArgs).plan_path.trim();

			if (!runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Not in plan mode; there is no plan to approve." }],
					details: { approved: false, plan: "", planPath } satisfies ExitPlanModeDetails,
					isError: true,
				};
			}

			let file = await runtime.plans.read(ctx.cwd, planPath);
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
			// Review, refine, and browser review all loop back here until the user
			// approves, keeps planning, or a refinement is handed to the model. The
			// dialog-based refine editor carries no text from the review screen, so an
			// empty or cancelled editor returns to the review instead of being reported
			// as "not approved".
			for (;;) {
				if (outcome.action === "browser") {
					const session = await web.start(ctx.cwd, file).catch(() => undefined);
					if (!session) {
						ctx.ui.notify("Plan review: could not start the browser review server.", "error");
						outcome = await reviewPlan(ctx, file);
						continue;
					}
					ctx.ui.notify(`Plan review: opened ${session.url}`, "info");
					const result = await session.done;
					await session.close();
					if (result.status === "saved") {
						// The comments are already in the file; hand them back as a refinement so
						// the model revises the same plan and calls exit_plan_mode again.
						const refinement = feedbackSummary(result.annotations) || "See the review comments in the plan file.";
						return {
							content: [
								{
									type: "text",
									text: `The user reviewed the plan in the browser and left feedback:\n${refinement}\nStay in plan mode, revise the plan (write_plan, reusing plan_path), then call exit_plan_mode again.`,
								},
							],
							details: {
								approved: false,
								plan: result.plan.content,
								planPath: result.plan.path,
								relativePath: result.plan.relativePath,
								refined: true,
								refinement,
							} satisfies ExitPlanModeDetails,
						};
					}
					// Cancelled or the tab closed: re-read the file and review again.
					file = (await runtime.plans.read(ctx.cwd, file.path)) ?? file;
					outcome = await reviewPlan(ctx, file);
					continue;
				}
				if (outcome.action === "refine" && !outcome.refinement) {
					const refinement = (await ctx.ui.editor(REFINE_PROMPT, ""))?.trim();
					if (refinement) outcome = { action: "refine", refinement };
					else outcome = await reviewPlan(ctx, file);
					continue;
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
				break;
			}

			runtime.disable(ctx);
			const { recorded, steps, error } = await seedTodos(ctx, file.content);
			const listing =
				steps.length > 0
					? `\n\n${steps
							.map((step, index) => `${index + 1}. [${step.status === "completed" ? "x" : " "}] ${step.content}`)
							.join("\n")}`
					: "";
			const tail =
				recorded > 0
					? ` Recorded ${recorded} step${recorded === 1 ? "" : "s"} in the todo list. As you finish each step, mark it done there and tick it off in the file with ${SET_PLAN_STEP_TOOL}.`
					: steps.length > 0
						? ` Could not record the steps in the todo list${error ? `: ${error}` : ""}. Keep these steps in mind and tick them off with ${SET_PLAN_STEP_TOOL} as you go.`
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
				} satisfies ExitPlanModeDetails,
			};
		},

		renderCall(_args, theme, context) {
			const text = reuseText(context?.lastComponent);
			text.setText(theme.fg("toolTitle", theme.bold(`${EXIT_TOOL} `)) + theme.fg("muted", "submitted a plan"));
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<ExitPlanModeDetails>(result.details);
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

	pi.registerTool({
		name: SET_PLAN_STEP_TOOL,
		label: "Set plan step",
		description:
			"Keep an approved plan file current by setting one top-level step's checkbox in place. The step number matches " +
			"the order the plan was approved in. Only the checkbox changes; the step text is left as written. Call it as you " +
			"finish (or reopen) each step so the file mirrors reality.",
		promptSnippet: "Tick a step off in the approved plan file.",
		promptGuidelines: [
			"After a plan is approved, call set_plan_step as you complete each step so the plan file stays current.",
		],
		parameters: SetPlanStepParams,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as SetPlanStepArgs;
			if (runtime.isEnabled()) {
				return {
					content: [{ type: "text", text: "Not while planning; refine the plan with write_plan instead." }],
					details: undefined,
					isError: true,
				};
			}
			try {
				const plan = await runtime.plans.setStep(ctx.cwd, args.plan_path, args.step, args.status);
				const steps = extractPlanSteps(plan.content);
				const done = steps.filter((step) => step.status === "completed").length;
				return {
					content: [
						{
							type: "text",
							text: `Step ${args.step} is ${args.status} (${done}/${steps.length} done) in ${plan.relativePath}.`,
						},
					],
					details: {
						path: plan.path,
						relativePath: plan.relativePath,
						step: args.step,
						status: args.status,
						done,
						total: steps.length,
					} satisfies SetPlanStepDetails,
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
			const text = reuseText(context?.lastComponent);
			const step = (args as Partial<SetPlanStepArgs>).step;
			const suffix = theme.fg("muted", step === undefined ? "a step" : `step ${step}`);
			text.setText(theme.fg("toolTitle", theme.bold(`${SET_PLAN_STEP_TOOL} `)) + suffix);
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<SetPlanStepDetails>(result.details);
			if (!details) {
				const first = result.content[0];
				text.setText(first?.type === "text" ? first.text : "");
				return text;
			}
			const heading =
				details.status === "completed"
					? theme.fg("success", `✓ Step ${details.step} done`)
					: theme.fg("muted", `Step ${details.step} reopened`);
			text.setText(heading + theme.fg("dim", ` · ${details.done}/${details.total}`));
			return text;
		},
	});
}
