/**
 * Plan mode: entering it, writing the plan, leaving it, and the step ticks.
 *
 * The fixtures carry a stored plan and its reviewed steps, so the blocks show
 * the document a session actually reads.
 */

import type { ToolFixture } from "./types.ts";

/**
 * The plan store the fixture's plan lives in.
 *
 * `write_plan` saves into `<agent-dir>/plans/<repo-key>` — outside the checkout, under the
 * default agent directory — so no repository-relative path can name a plan the tool writes.
 */
const PLANS = "/home/u/.pi/agent/plans/8872d3adda0e";

/** The plan's file name: stamped and slugged the way the store names one. */
const PLAN_PATH = `${PLANS}/2026-10-29-1015-add-rate-limiting.md`;

/** How the tools show a plan: `~`-shortened, which is `shortenPath`'s rule for this fake home. */
const shown = (path: string): string => path.replace("/home/u", "~");

/** One entry per plan tool, in gallery order. */
export const PLAN_FIXTURES: ToolFixture[] = [
	{
		name: "enter_plan_mode",
		group: "package",
		label: "plan mode entered",
		args: {},
		result: { content: [{ type: "text", text: "You are now in plan mode." }], details: { entered: true } },
	},
	{
		name: "write_plan",
		group: "package",
		label: "a saved plan",
		args: { title: "Add rate limiting", content: "# Add rate limiting\n" },
		result: {
			content: [{ type: "text", text: `Wrote the plan to ${shown(PLAN_PATH)}` }],
			details: {
				path: PLAN_PATH,
				relativePath: shown(PLAN_PATH),
				bytes: 2140,
			},
		},
	},
	{
		name: "exit_plan_mode",
		group: "package",
		label: "an approved plan",
		args: { plan_path: PLAN_PATH },
		result: {
			content: [{ type: "text", text: "Plan approved. Plan mode is off and write access is restored." }],
			details: {
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
			},
		},
	},
	{
		name: "cancel_plan_mode",
		group: "package",
		label: "plan mode left without approval",
		args: {},
		result: {
			content: [{ type: "text", text: "Plan mode is off and write access is restored." }],
			details: { cancelled: true },
		},
	},
	{
		name: "set_plan_steps",
		group: "package",
		label: "one step ticked off",
		args: {
			plan_path: PLAN_PATH,
			updates: [{ step: 1, status: "completed", expected: "Add a token-bucket limiter" }],
		},
		result: {
			content: [{ type: "text", text: "Step 1 completed (1/3 done)." }],
			details: {
				path: PLAN_PATH,
				relativePath: shown(PLAN_PATH),
				updates: [{ step: 1, status: "completed", expected: "Add a token-bucket limiter" }],
				done: 1,
				total: 3,
			},
		},
	},
];
