import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createPlanPolicy } from "./policy.ts";
import { BASELINE_TYPE, createPlanRuntime, ENTER_TOOL, EXIT_TOOL, WRITE_PLAN_TOOL, STATE_TYPE } from "./runtime.ts";
import { changedSections, sectionDigests } from "./plan-text.ts";
import { baselineEntry, fakeCtx, makeFakePi, stateEntry } from "../../test/helpers/fixtures/plan.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";

function setup(options: { active?: string[]; planFlag?: boolean; branch?: unknown[] } = {}) {
	const fake = makeFakePi({
		active: options.active ?? ["read", "bash", "write", "edit", ENTER_TOOL, "todo"],
		planFlag: options.planFlag,
	});
	if (options.planFlag) fake.flags.set("plan", { default: true });
	const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
	const { ctx, statusCalls } = fakeCtx({ branch: options.branch });
	return { ...fake, runtime, ctx, statusCalls };
}

describe("plan runtime — tool gating", () => {
	test("enable removes write, edit, and enter_plan_mode and adds both control tools", () => {
		const { runtime, ctx, activeTools } = setup();
		runtime.enable(ctx);
		const active = activeTools();
		expect(active).not.toContain("write");
		expect(active).not.toContain("edit");
		expect(active).not.toContain(ENTER_TOOL);
		expect(active).toContain("bash");
		expect(active).toContain(EXIT_TOOL);
		expect(active).toContain(WRITE_PLAN_TOOL);
		expect(active).toContain("todo");
	});

	test("disable restores write, edit, and enter_plan_mode and removes both control tools", () => {
		const { runtime, ctx, activeTools } = setup();
		runtime.enable(ctx);
		runtime.disable(ctx);
		const active = activeTools();
		expect(active).toContain("write");
		expect(active).toContain("edit");
		expect(active).toContain(ENTER_TOOL);
		expect(active).not.toContain(EXIT_TOOL);
		expect(active).not.toContain(WRITE_PLAN_TOOL);
	});

	test("keeps the git-only bash shell but blocks powershell while planning", () => {
		const { runtime, ctx, activeTools } = setup({ active: ["read", "bash", "powershell"] });
		runtime.enable(ctx);
		expect(activeTools()).toContain("bash");
		expect(activeTools()).not.toContain("powershell");
	});

	test("preserves read-only tools across a toggle", () => {
		const { runtime, ctx, activeTools } = setup({ active: ["read", "todo"] });
		runtime.toggle(ctx);
		expect(activeTools()).toContain("todo");
		expect(activeTools()).toContain("read");
		runtime.toggle(ctx);
		expect(activeTools()).toContain("todo");
	});

	test("hides every tool the policy does not consider read-only", () => {
		const { runtime, ctx, activeTools } = setup({
			active: ["read", "bash", "write", "subagent", "powershell", "mcp_tool"],
		});
		runtime.enable(ctx);
		expect(activeTools()).toContain("read");
		expect(activeTools()).toContain("bash");
		// subagent stays active so the call guard can force it read-only.
		expect(activeTools()).toContain("subagent");
		expect(activeTools()).not.toContain("powershell");
		expect(activeTools()).not.toContain("write");
		expect(activeTools()).not.toContain("mcp_tool");
		runtime.disable(ctx);
		expect(activeTools()).toContain("bash");
		expect(activeTools()).toContain("subagent");
		expect(activeTools()).toContain("powershell");
		expect(activeTools()).toContain("mcp_tool");
	});

	test("keeps a tool that carries the read-only hint", () => {
		const fake = makeFakePi({ active: ["read", "web_search"] });
		fake.pi.allTools = [{ name: "web_search", annotations: { readOnlyHint: true } }];
		const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
		runtime.enable(fakeCtx().ctx);
		expect(fake.activeTools()).toContain("web_search");
	});

	test("disable does not activate tools that were not active", () => {
		const { runtime, ctx, activeTools } = setup({ active: ["read", "todo"] });
		runtime.enable(ctx);
		runtime.disable(ctx);
		expect(activeTools()).not.toContain("write");
		expect(activeTools()).not.toContain("edit");
		expect(activeTools()).not.toContain(ENTER_TOOL);
	});

	test("a redundant enable does not forget the tools to restore", () => {
		const { runtime, ctx, activeTools } = setup();
		runtime.enable(ctx);
		runtime.enable(ctx); // e.g. a session_tree restore while already enabled
		runtime.disable(ctx);
		expect(activeTools()).toContain("write");
		expect(activeTools()).toContain("edit");
		expect(activeTools()).toContain(ENTER_TOOL);
	});
});

describe("plan runtime — persistence and status", () => {
	test("persists enabled state only when it changes", () => {
		const { runtime, ctx, entries } = setup();
		runtime.enable(ctx);
		runtime.enable(ctx);
		expect(entries).toEqual([
			{ type: "custom", customType: STATE_TYPE, data: { enabled: true, removed: ["write", "edit", ENTER_TOOL] } },
		]);
		runtime.disable(ctx);
		expect(entries).toHaveLength(2);
		expect(entries[1]).toEqual({ type: "custom", customType: STATE_TYPE, data: { enabled: false } });
	});

	test("toggles the footer status", () => {
		const { runtime, ctx, statusCalls } = setup();
		runtime.enable(ctx);
		expect(statusCalls.at(-1)).toEqual({ key: "plan-mode", text: `${GLYPHS.plan} plan` });
		runtime.disable(ctx);
		expect(statusCalls.at(-1)).toEqual({ key: "plan-mode", text: undefined });
	});

	test("restores enabled state from the branch", () => {
		const { runtime, ctx, activeTools } = setup({ branch: [stateEntry(true)] });
		runtime.restore(ctx);
		expect(runtime.isEnabled()).toBe(true);
		expect(activeTools()).not.toContain("write");
	});

	test("the latest branch entry wins", () => {
		const { runtime, ctx } = setup({ branch: [stateEntry(true), stateEntry(false)] });
		runtime.restore(ctx);
		expect(runtime.isEnabled()).toBe(false);
	});

	test("the --plan flag forces plan mode on", () => {
		const { runtime, ctx, activeTools } = setup({ planFlag: true });
		runtime.restore(ctx);
		expect(runtime.isEnabled()).toBe(true);
		expect(activeTools()).not.toContain("edit");
	});

	test("a persisted disable wins over the --plan flag", () => {
		const { runtime, ctx, activeTools } = setup({ planFlag: true, branch: [stateEntry(false)] });
		runtime.restore(ctx);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");
		expect(activeTools()).not.toContain(EXIT_TOOL);
	});

	test("a persisted enable wins too", () => {
		const { runtime, ctx } = setup({ branch: [stateEntry(true)] });
		runtime.restore(ctx);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("restore does not append a state entry", () => {
		const { runtime, ctx, entries } = setup({ branch: [stateEntry(true)] });
		runtime.restore(ctx);
		expect(entries).toHaveLength(0);
	});

	test("setLastPlan updates the footer chip with the plan basename", () => {
		const { runtime, ctx, statusCalls } = setup();
		runtime.enable(ctx);
		runtime.setLastPlan(ctx, "/repo/.pi/plans/2026-10-08-1530-add-rate-limiting.md");
		expect(runtime.lastPlanPath()).toBe("/repo/.pi/plans/2026-10-08-1530-add-rate-limiting.md");
		expect(String(statusCalls.at(-1)?.text)).toContain(`${GLYPHS.plan} plan · 2026-10-08-1530-add-rate-li`);
	});

	test("recognizes only the known control tool names", () => {
		const { runtime } = setup();
		expect(runtime.isControlTool(EXIT_TOOL)).toBe(true);
		expect(runtime.isControlTool(WRITE_PLAN_TOOL)).toBe(true);
		expect(runtime.isControlTool("write")).toBe(false);
	});

	test("recognizes a control tool sourced from this extension", () => {
		const fake = makeFakePi({ active: ["read"] });
		fake.pi.allTools = [
			{ name: EXIT_TOOL, sourceInfo: { path: "/this/index.ts" } },
			{ name: WRITE_PLAN_TOOL, sourceInfo: { path: "/this/index.ts" } },
		];
		const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi), { entryPath: "/this/index.ts" });
		expect(runtime.isControlTool(EXIT_TOOL)).toBe(true);
		expect(runtime.isControlTool(WRITE_PLAN_TOOL)).toBe(true);
	});

	test("rejects a control tool sourced from another extension", () => {
		const fake = makeFakePi({ active: ["read"] });
		fake.pi.allTools = [
			{ name: EXIT_TOOL, sourceInfo: { path: "/other/index.ts" } },
			{ name: WRITE_PLAN_TOOL, sourceInfo: { path: "/other/index.ts" } },
		];
		const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi), { entryPath: "/this/index.ts" });
		expect(runtime.isControlTool(EXIT_TOOL)).toBe(false);
		expect(runtime.isControlTool(WRITE_PLAN_TOOL)).toBe(false);
	});
});

describe("plan runtime — review baseline", () => {
	const path = "/repo/.pi/plans/a.md";
	const plan = ["# Plan", "## Goal", "Ship it."].join("\n");
	const edited = ["# Plan", "## Goal", "Ship it well."].join("\n");

	test("remembers the sections a review showed, per plan path", () => {
		const { runtime } = setup();
		expect(runtime.reviewed(path)).toBeUndefined();

		runtime.markReviewed(path, plan);

		expect(runtime.reviewed(path)).toEqual(sectionDigests(plan));
		expect(runtime.reviewed("/repo/.pi/plans/b.md")).toBeUndefined();
	});

	test("a new mark replaces the previous baseline", () => {
		const { runtime } = setup();
		runtime.markReviewed(path, plan);
		runtime.markReviewed(path, edited);
		expect(runtime.reviewed(path)).toEqual(sectionDigests(edited));
	});

	test("persists the baseline as a session entry", () => {
		const { runtime, entries } = setup();
		runtime.markReviewed(path, plan);
		expect(entries).toEqual([
			{ type: "custom", customType: BASELINE_TYPE, data: { path: resolve(path), sections: sectionDigests(plan) } },
		]);
	});

	test("does not append an entry for a review that shows the same content", () => {
		const { runtime, entries } = setup();
		runtime.markReviewed(path, plan);
		// The same screen reopened, and a review comment the browser stored in the file.
		runtime.markReviewed(path, plan);
		runtime.markReviewed(path, `${plan}\n> [!REVIEW] make it concrete`);
		expect(entries).toHaveLength(1);
	});

	test("a resumed session keeps the markers", () => {
		const { runtime, ctx } = setup({ branch: [baselineEntry(path, sectionDigests(plan))] });
		runtime.restore(ctx);

		expect(changedSections(runtime.reviewed(path), plan)).toEqual([false, false]);
		expect(changedSections(runtime.reviewed(path), edited)).toEqual([false, true]);
	});

	test("finds a baseline recorded under a non-canonical path", () => {
		// A branch can name the same plan with `..` in it, or relative to another cwd;
		// the restored key is canonical so the lookup does not depend on the spelling.
		const { runtime, ctx } = setup({
			branch: [baselineEntry("/repo/.pi/plans/nested/../a.md", sectionDigests(plan))],
		});

		runtime.restore(ctx);

		expect(runtime.reviewed(path)).toEqual(sectionDigests(plan));
	});

	test("a branch that never reviewed the plan has no baseline", () => {
		const { runtime } = setup();
		runtime.markReviewed(path, plan);

		runtime.restore(fakeCtx({ branch: [stateEntry(true)] }).ctx);

		expect(runtime.reviewed(path)).toBeUndefined();
	});

	test("keeps the last baseline of each plan on the branch", () => {
		const other = "/repo/.pi/plans/b.md";
		const { runtime, ctx } = setup({
			branch: [
				baselineEntry(path, sectionDigests(plan)),
				baselineEntry(other, sectionDigests(edited)),
				baselineEntry(path, sectionDigests(edited)),
			],
		});
		runtime.restore(ctx);

		expect(runtime.reviewed(path)).toEqual(sectionDigests(edited));
		expect(runtime.reviewed(other)).toEqual(sectionDigests(edited));
	});

	test("ignores a malformed baseline entry", () => {
		const { runtime, ctx } = setup({
			branch: [{ type: "custom", customType: BASELINE_TYPE, data: { path, sections: [{ title: 1 }] } }],
		});
		runtime.restore(ctx);

		expect(runtime.reviewed(path)).toBeUndefined();
	});
});

describe("plan runtime — branch restore", () => {
	test("restores the hidden tools of the branch it left plan mode on", () => {
		const { runtime, ctx, activeTools, pi } = setup({ active: ["read", "write", "edit"] });
		runtime.enable(ctx); // removed = [write, edit]

		// A `/tree` navigation: the host resets the active set to the target
		// branch's declared tools before emitting `session_tree`.
		pi.setActiveTools(["read", "grep", "job"]);
		const treeCtx = fakeCtx({ branch: [stateEntry(true, ["write", "edit", "job"])] }).ctx;
		runtime.restore(treeCtx);
		runtime.disable(treeCtx);

		const active = activeTools();
		expect(active).toContain("write");
		expect(active).toContain("edit");
		expect(active).toContain("job");
	});

	test("a plan-off branch restore does not re-add the previous branch's hidden tools", () => {
		const { runtime, ctx, activeTools, pi } = setup({ active: ["read", "write", "edit"] });
		runtime.enable(ctx);

		// The host restores a base set without write/edit; plan mode was off there.
		pi.setActiveTools(["read", "grep"]);
		const offCtx = fakeCtx({ branch: [stateEntry(false)] }).ctx;
		runtime.restore(offCtx);

		expect(activeTools()).not.toContain("write");
		expect(activeTools()).toContain("grep");
	});
});
