/**
 * Plan mode in the gallery: entering it, writing the plan, leaving it, and the step
 * ticks — one block per action of the folded `plan` tool.
 *
 * The fixtures carry a stored plan and its reviewed steps, so the blocks show
 * the document a session actually reads.
 */

import type {
	CancelPlanModeDetails,
	EnterPlanModeDetails,
	ExitPlanModeDetails,
	SetPlanStepsDetails,
	WritePlanDetails,
} from "../../../extensions/plan/types.ts";
import type { ToolFixture } from "./types.ts";

/**
 * The plan store the fixture's plan lives in.
 *
 * The `write` action saves into `<agent-dir>/plans/<repo-key>` — outside the checkout, under the
 * default agent directory — so no repository-relative path can name a plan the tool writes.
 */
const PLANS = "/home/u/.pi/agent/plans/8872d3adda0e";

/** The plan's file name: stamped and slugged the way the store names one. */
const PLAN_PATH = `${PLANS}/2026-10-29-1015-add-rate-limiting.md`;

/** How the tool shows a plan: `~`-shortened, which is `shortenPath`'s rule for this fake home. */
const shown = (path: string): string => path.replace("/home/u", "~");

const ENTERED: EnterPlanModeDetails = { action: "enter", entered: true };

const WRITTEN: WritePlanDetails = {
	action: "write",
	path: PLAN_PATH,
	relativePath: shown(PLAN_PATH),
	bytes: 2140,
};

const APPROVED: ExitPlanModeDetails = {
	action: "exit",
	approved: true,
	planPath: PLAN_PATH,
	relativePath: shown(PLAN_PATH),
	plan: [
		"# Add rate limiting",
		"",
		"## Goal",
		"Cap public API traffic per client to avoid overload.",
		"",
		"## Steps",
		"- [ ] Add a token-bucket limiter",
		"- [ ] Wire it into the API middleware",
		"- [ ] Add tests for burst and sustained rates",
	].join("\n"),
};

const STEPPED: SetPlanStepsDetails = {
	action: "steps",
	path: PLAN_PATH,
	relativePath: shown(PLAN_PATH),
	updates: [{ step: 1, status: "completed", expected: "Add a token-bucket limiter" }],
	done: 1,
	total: 3,
};

/** The batch form: one call that ticks a whole plan, which is where the call line's label showed. */
const STEPPED_BATCH: SetPlanStepsDetails = {
	action: "steps",
	path: PLAN_PATH,
	relativePath: shown(PLAN_PATH),
	updates: [
		{ step: 1, status: "completed", expected: "Add a token-bucket limiter" },
		{ step: 2, status: "completed", expected: "Wire it into the API middleware" },
		{ step: 3, status: "completed", expected: "Add tests for burst and sustained rates" },
	],
	done: 3,
	total: 3,
};

const CANCELLED: CancelPlanModeDetails = { action: "cancel", cancelled: true };

/** One entry per action of the `plan` tool, in gallery order, plus the batch form of `steps`. */
export const PLAN_FIXTURES: ToolFixture[] = [
	{
		name: "plan",
		group: "package",
		label: "plan mode entered",
		args: { action: "enter" },
		result: { content: [{ type: "text", text: "You are now in plan mode." }], details: ENTERED },
	},
	{
		name: "plan-write",
		tool: "plan",
		group: "package",
		label: "a saved plan",
		// The saved path is the row's identity: a middle clip keeps its tail from where the head
		// cuts, so the file is still named at 40 columns (#738).
		identity: "rate-limiting.md",
		args: { action: "write", title: "Add rate limiting", content: "# Add rate limiting\n" },
		result: {
			content: [{ type: "text", text: `Wrote the plan to ${shown(PLAN_PATH)}` }],
			details: WRITTEN,
		},
	},
	{
		name: "plan-exit",
		tool: "plan",
		group: "package",
		label: "an approved plan",
		identity: "rate-limiting.md",
		args: { action: "exit", plan_path: PLAN_PATH },
		result: {
			content: [{ type: "text", text: "Plan approved. Plan mode is off and write access is restored." }],
			details: APPROVED,
		},
	},
	{
		name: "plan-steps",
		tool: "plan",
		group: "package",
		label: "a step ticked off",
		args: {
			action: "steps",
			plan_path: PLAN_PATH,
			updates: [{ step: 1, status: "completed", expected: "Add a token-bucket limiter" }],
		},
		result: {
			content: [{ type: "text", text: `Step 1 completed (1/3 done) in ${shown(PLAN_PATH)}` }],
			details: STEPPED,
		},
	},
	{
		name: "plan-steps-batch",
		tool: "plan",
		group: "package",
		label: "three steps ticked in one call",
		args: {
			action: "steps",
			plan_path: PLAN_PATH,
			updates: [
				{ step: 1, status: "completed", expected: "Add a token-bucket limiter" },
				{ step: 2, status: "completed", expected: "Wire it into the API middleware" },
				{ step: 3, status: "completed", expected: "Add tests for burst and sustained rates" },
			],
		},
		result: {
			content: [{ type: "text", text: `Steps 1, 2, 3 completed (3/3 done) in ${shown(PLAN_PATH)}` }],
			details: STEPPED_BATCH,
		},
	},
	{
		name: "plan-cancel",
		tool: "plan",
		group: "package",
		label: "plan mode left without approval",
		args: { action: "cancel" },
		result: {
			content: [{ type: "text", text: "Plan mode is off and write access is restored." }],
			details: CANCELLED,
		},
	},
];
