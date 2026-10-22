/**
 * Plan mode: entering it, writing the plan, leaving it, and the step ticks.
 *
 * The fixtures carry a stored plan and its reviewed steps, so the blocks show
 * the document a session actually reads.
 */

import type { ToolFixture } from "./types.ts";
import { CWD } from "./workspace.ts";

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
			content: [{ type: "text", text: "Wrote the plan to .pi/plans/add-rate-limiting.md" }],
			details: {
				path: `${CWD}/.pi/plans/add-rate-limiting.md`,
				relativePath: ".pi/plans/add-rate-limiting.md",
				bytes: 2140,
			},
		},
	},
	{
		name: "exit_plan_mode",
		group: "package",
		label: "an approved plan",
		args: { plan_path: `${CWD}/.pi/plans/add-rate-limiting.md` },
		result: {
			content: [{ type: "text", text: "Plan approved. Plan mode is off and write access is restored." }],
			details: {
				approved: true,
				planPath: `${CWD}/.pi/plans/add-rate-limiting.md`,
				relativePath: ".pi/plans/add-rate-limiting.md",
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
			plan_path: `${CWD}/.pi/plans/add-rate-limiting.md`,
			updates: [{ step: 1, status: "completed", expected: "Add a token-bucket limiter" }],
		},
		result: {
			content: [{ type: "text", text: "Step 1 completed (1/3 done)." }],
			details: {
				path: `${CWD}/.pi/plans/add-rate-limiting.md`,
				relativePath: ".pi/plans/add-rate-limiting.md",
				updates: [{ step: 1, status: "completed", expected: "Add a token-bucket limiter" }],
				done: 1,
				total: 3,
			},
		},
	},
];
