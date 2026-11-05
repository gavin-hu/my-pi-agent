/**
 * What a restore of the session branch gives back.
 *
 * `/resume` and a `/tree` hop both land on a branch, and the branch is the only
 * record: the mode, the tools it hid, the footer chip's plan, and the review
 * baselines the changed-section markers compare against. These cases drive
 * `restore()` over a branch fixture, so what a host hands back is what is read.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { planCtx, planRuntimeSetup, stateEntry, writeEntry } from "../../test/helpers/fixtures/plan.ts";
import { toolResultEntry } from "../../test/helpers/entries.ts";
import { PLAN_TOOL } from "./runtime.ts";

describe("plan runtime — branch restore", () => {
	test("names the plan the branch last wrote, so the chip survives a resume", () => {
		const first = "/repo/.pi/plans/2026-10-08-1530-first.md";
		const second = "/repo/.pi/plans/2026-10-09-0900-second.md";
		const { runtime, ctx, statusCalls } = planRuntimeSetup({
			branch: [stateEntry(true), writeEntry(first), writeEntry(second)],
		});

		runtime.restore(ctx);

		expect(runtime.lastPlanPath()).toBe(resolve(second));
		expect(String(statusCalls.at(-1)?.text)).toBe(`${GLYPHS.plan} plan · 2026-10-09-0900-second`);
	});

	test("leaves the chip bare on a branch that wrote no plan", () => {
		const { runtime, ctx, statusCalls } = planRuntimeSetup({ branch: [stateEntry(true)] });

		runtime.restore(ctx);

		expect(runtime.lastPlanPath()).toBeUndefined();
		expect(String(statusCalls.at(-1)?.text)).toBe(`${GLYPHS.plan} plan`);
	});

	test("names no plan from a rejected write or another action's result", () => {
		const written = "/repo/.pi/plans/2026-10-08-1530-first.md";
		const { runtime, ctx } = planRuntimeSetup({
			branch: [
				stateEntry(true),
				writeEntry(written),
				toolResultEntry(PLAN_TOOL, { action: "write", path: "/repo/.pi/plans/rejected.md", error: "no title" }),
				toolResultEntry(PLAN_TOOL, { action: "exit", approved: false, plan: "# Plan", planPath: "/repo/other.md" }),
			],
		});

		runtime.restore(ctx);

		expect(runtime.lastPlanPath()).toBe(resolve(written));
	});

	test("leaves the chip bare when the only write on the branch was rejected", () => {
		const { runtime, ctx, statusCalls } = planRuntimeSetup({
			branch: [
				stateEntry(true),
				toolResultEntry(PLAN_TOOL, { action: "write", path: "/repo/.pi/plans/rejected.md", error: "no title" }),
			],
		});

		runtime.restore(ctx);

		expect(runtime.lastPlanPath()).toBeUndefined();
		expect(String(statusCalls.at(-1)?.text)).toBe(`${GLYPHS.plan} plan`);
	});

	test("restores the hidden tools of the branch it left plan mode on", () => {
		const { runtime, ctx, activeTools, pi } = planRuntimeSetup({ active: ["read", "write", "edit"] });
		runtime.enable(ctx); // removed = [write, edit]

		// A `/tree` navigation: the host resets the active set to the target
		// branch's declared tools before emitting `session_tree`.
		pi.setActiveTools(["read", "grep", "job"]);
		const treeCtx = planCtx({ branch: [stateEntry(true, ["write", "edit", "job"])] }).ctx;
		runtime.restore(treeCtx);
		runtime.disable(treeCtx);

		const active = activeTools();
		expect(active).toContain("write");
		expect(active).toContain("edit");
		expect(active).toContain("job");
	});

	test("a plan-off branch restore does not re-add the previous branch's hidden tools", () => {
		const { runtime, ctx, activeTools, pi } = planRuntimeSetup({ active: ["read", "write", "edit"] });
		runtime.enable(ctx);

		// The host restores a base set without write/edit; plan mode was off there.
		pi.setActiveTools(["read", "grep"]);
		const offCtx = planCtx({ branch: [stateEntry(false)] }).ctx;
		runtime.restore(offCtx);

		expect(activeTools()).not.toContain("write");
		expect(activeTools()).toContain("grep");
	});
});
