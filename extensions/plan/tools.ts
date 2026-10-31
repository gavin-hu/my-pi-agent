/**
 * Model-facing registration for the `plan` tool.
 *
 * One tool with five actions, like `board` and `memory`: `enter` asks the user to
 * plan before touching code, `write` saves the plan artifact in the plans
 * directory and returns its path, `exit` reads that file back and presents it for
 * approval, `steps` keeps an approved plan current, and `cancel` leaves planning
 * without approving, so a phone user is never trapped in read-only mode.
 *
 * `exit` presents the plan through `review.ts` (a scrollable review screen in the
 * TUI, a select dialog elsewhere) and, on approval, seeds the `todo` tool with the
 * plan's steps through `ctx.executeTool`, so the todo widget and validation run
 * normally. After approval the model ticks each step off in place with `steps`, and
 * the todo item approval seeded from that step is ticked with it. The file is the
 * source of truth: the model executes from it.
 *
 * Each action lives in `tools/`: its execute handler and the block it draws stay
 * together, and the approval-time helpers they share live next to them. This
 * module only composes them, in the order the description names them.
 *
 * Without an interactive UI the two actions that need one (`enter`, `exit`) fail
 * with an actionable message instead of deciding for the user.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { detailsOrLine, messageText, callLine } from "../../lib/tui/tool.ts";
import { MAX_STEPS, PLAN_OUTLINE } from "./steps.ts";
import { PLAN_ACTIONS, PLAN_TOOL, type PlanAction, type PlanRuntime } from "./runtime.ts";
import { callCancel, executeCancel, textCancel } from "./tools/cancel.ts";
import { callEnter, executeEnter, textEnter } from "./tools/enter.ts";
import { callExit, executeExit, textExit } from "./tools/exit.ts";
import { callSteps, executeSteps, StepUpdateParams, textSteps } from "./tools/steps.ts";
import { callWrite, executeWrite, textWrite } from "./tools/write.ts";
import type { PlanDetails } from "./types.ts";
import { createLazyPlanWebReview, NO_SERVER_DEPS } from "./web-lazy.ts";
import type { PlanWebReview } from "./web.ts";

const PlanParams = Type.Object({
	action: StringEnum(PLAN_ACTIONS, {
		description:
			"`enter` asks to plan, `write` saves the plan file, `exit` presents it for approval, `steps` ticks its steps, `cancel` leaves without approving.",
	}),
	title: Type.Optional(
		Type.String({
			description: '`write`: short title for the plan, used as the file-name slug, e.g. "Add rate limiting".',
		}),
	),
	content: Type.Optional(
		Type.String({
			description: "`write`: the complete plan as markdown in the documented outline, including every step.",
		}),
	),
	plan_path: Type.Optional(
		Type.String({
			description:
				"`write`: overwrite an existing plan file (one an earlier `write` returned) to refine it instead of creating a new one. " +
				"`exit`: the file `write` returned, which the user reviews. " +
				"`steps`: the approved plan file, as `exit` returned it.",
		}),
	),
	updates: Type.Optional(
		Type.Array(StepUpdateParams, {
			minItems: 1,
			description:
				"`steps`: the steps to set; each entry sets one step's checkbox, and the last entry wins for a duplicate step.",
		}),
	),
});

const DESCRIPTION =
	"Plan mode and the plan file it is built around, in one tool. `enter` asks the user to enter read-only plan mode; " +
	"`write` saves the plan you designed as markdown in the plans directory; `exit` presents the saved plan for approval; " +
	"`steps` ticks its steps off in place; `cancel` leaves plan mode without approving. Each action refuses outside its " +
	"mode, and every field but `action` says which action reads it.\n\n" +
	"`write` takes the complete plan, not a summary, in this outline so it is consistent and scannable:\n\n" +
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
	`A plan with more than ${MAX_STEPS} top-level steps in its Steps section is refused, so approval never drops steps it ` +
	"cannot track. `write` returns the path to pass to `exit`; plan_path overwrites an existing file when refining.\n\n" +
	"`steps` sets the checkboxes of the given top-level steps of an approved plan in one write, and their todo items " +
	"with them. Each step number matches the order the plan was approved in; a step can be marked completed or reopened. " +
	"Only the checkboxes change; the step text is left as written. The file is rewritten once, and nothing changes when " +
	"any step is out of range or an entry's expected text no longer matches the file.\n\n" +
	"`exit` reads the plan file back and presents it with approve, keep, refine, and exit choices; on approval plan mode " +
	"ends, write access returns, and the plan's steps go into the todo list. The plan file stays the source of truth. " +
	"`cancel` is the escape hatch that needs no plan file: write access returns and nothing is recorded.";

/** The verb a call names, or undefined for a transcript recorded before the fold. */
function planActionOf(raw: unknown): PlanAction | undefined {
	return typeof raw === "string" ? PLAN_ACTIONS.find((action) => action === raw) : undefined;
}

export function registerTools(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview = createLazyPlanWebReview(runtime.plans, NO_SERVER_DEPS),
): void {
	pi.registerTool<typeof PlanParams, PlanDetails>({
		name: PLAN_TOOL,
		label: "Plan",
		description: DESCRIPTION,
		promptSnippet: "Enter read-only plan mode, save the plan, present it for approval, tick its steps, or leave it.",
		promptGuidelines: [
			"Call plan with action enter before a non-trivial implementation task; skip it for small, obvious changes.",
			"While plan mode is active, write the full plan with action write, then call action exit with the returned plan_path.",
			"When refining with plan_path, keep every section heading as it was: the review marks changed sections by heading, " +
				"so a rename reads as an edit.",
			"After a plan is approved, call action steps as you complete steps, passing each step's text as expected so a " +
				"reordered plan is refused instead of mis-ticked.",
			"Call action cancel when the user asks to leave or abandon planning without approving a plan.",
		],
		parameters: PlanParams,
		executionMode: "sequential",
		// One annotation set for five verbs, so it takes the strictest of them: `write`
		// overwrites a plan file with plan_path. The actions that only change the mode
		// are exempted by the guard in `index.ts`, which is the only place that can
		// still tell them apart.
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			switch (params.action) {
				case "enter":
					return await executeEnter(runtime, ctx);
				case "write":
					return await executeWrite(runtime, params, ctx);
				case "exit":
					return await executeExit(pi, runtime, web, params, ctx, signal);
				case "steps":
					return await executeSteps(runtime, params, ctx);
				case "cancel":
					return await executeCancel(runtime, ctx);
			}
		},

		renderCall(args, theme, context) {
			const last = context?.lastComponent;
			switch (planActionOf(args.action)) {
				case "enter":
					return callEnter(theme, last);
				case "write":
					return callWrite(args, theme, last);
				case "exit":
					return callExit(args, theme, last);
				case "steps":
					return callSteps(args, theme, last);
				case "cancel":
					return callCancel(theme, last);
				case undefined:
					return callLine(theme, last, PLAN_TOOL, "");
			}
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<PlanDetails>(result.details);
			const outcome = detailsOrLine(theme, result, options.expanded, details);
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			const found = outcome.details;
			// No `action` means a refusal (which reports only its verb and reason), or a
			// result recorded before the tool was folded; its own text is what is left.
			if (!("action" in found)) {
				text.setText(paint(theme, "toolOutput", messageText(result)));
				return text;
			}
			switch (found.action) {
				case "enter":
					text.setText(textEnter(found, theme));
					break;
				case "write":
					text.setText(textWrite(found, theme));
					break;
				case "exit":
					text.setText(textExit(found, options.expanded, theme));
					break;
				case "steps":
					text.setText(textSteps(found, theme));
					break;
				case "cancel":
					text.setText(textCancel(found, theme));
					break;
			}
			return text;
		},
	});
}
