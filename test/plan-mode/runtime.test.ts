import { describe, expect, test } from "bun:test";
import { createPlanPolicy } from "../../extensions/plan-mode/policy.ts";
import {
	createPlanRuntime,
	ENTER_TOOL,
	EXIT_TOOL,
	WRITE_PLAN_TOOL,
	STATE_TYPE,
} from "../../extensions/plan-mode/runtime.ts";
import { fakeCtx, makeFakePi, stateEntry } from "./helpers.ts";

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
		expect(active).not.toContain("bash");
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

	test("keeps the read-only git tool while planning", () => {
		const { runtime, ctx, activeTools } = setup({ active: ["read", "git", "bash"] });
		runtime.enable(ctx);
		expect(activeTools()).toContain("git");
		expect(activeTools()).not.toContain("bash");
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
		expect(activeTools()).not.toContain("bash");
		expect(activeTools()).not.toContain("write");
		expect(activeTools()).not.toContain("subagent");
		expect(activeTools()).not.toContain("powershell");
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
		expect(entries).toEqual([{ type: "custom", customType: STATE_TYPE, data: { enabled: true } }]);
		runtime.disable(ctx);
		expect(entries).toHaveLength(2);
		expect(entries[1]).toEqual({ type: "custom", customType: STATE_TYPE, data: { enabled: false } });
	});

	test("toggles the footer status", () => {
		const { runtime, ctx, statusCalls } = setup();
		runtime.enable(ctx);
		expect(statusCalls.at(-1)).toEqual({ key: "plan-mode", text: "≡ plan" });
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
		expect(String(statusCalls.at(-1)?.text)).toContain("≡ plan · 2026-10-08-1530-add-rate-li");
	});

	test("recognizes only the known control tool names", () => {
		const { runtime } = setup();
		expect(runtime.isControlTool(EXIT_TOOL)).toBe(true);
		expect(runtime.isControlTool(WRITE_PLAN_TOOL)).toBe(true);
		expect(runtime.isControlTool("write")).toBe(false);
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
