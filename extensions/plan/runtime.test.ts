import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { baselineEntry, planCtx, makePlanPi, stateEntry } from "../../test/helpers/fixtures/plan.ts";
import { hasPathInput } from "./path-guard.ts";
import { changedSections, sectionDigests } from "./plan-text.ts";
import { createPlanPolicy } from "./policy.ts";
import { BASELINE_TYPE, createPlanRuntime, PLAN_TOOL, STATE_TYPE } from "./runtime.ts";

function setup(options: { active?: string[]; planFlag?: boolean; branch?: unknown[] } = {}) {
	const fake = makePlanPi({
		active: options.active ?? ["read", "bash", "write", "edit", PLAN_TOOL, "todo"],
		planFlag: options.planFlag,
	});
	if (options.planFlag) fake.flags.set("plan", { default: true });
	const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
	const { ctx, statusCalls } = planCtx({ branch: options.branch });
	return { ...fake, runtime, ctx, statusCalls };
}

describe("plan runtime — tool gating", () => {
	test("enable removes write and edit and keeps the plan tool, whose actions are the mode's verbs", () => {
		const { runtime, ctx, activeTools } = setup();
		runtime.enable(ctx);
		const active = activeTools();
		expect(active).not.toContain("write");
		expect(active).not.toContain("edit");
		expect(active).toContain("bash");
		expect(active).toContain(PLAN_TOOL);
		expect(active).toContain("todo");
	});

	test("disable restores write and edit and leaves the plan tool where the user had it", () => {
		const { runtime, ctx, activeTools } = setup();
		runtime.enable(ctx);
		runtime.disable(ctx);
		const active = activeTools();
		expect(active).toContain("write");
		expect(active).toContain("edit");
		expect(active).toContain(PLAN_TOOL);
	});

	test("a plan tool the user had disabled is removed again on disable", () => {
		const { runtime, ctx, activeTools } = setup({ active: ["read", "bash", "write"] });
		runtime.enable(ctx);
		expect(activeTools()).toContain(PLAN_TOOL);
		runtime.disable(ctx);
		expect(activeTools()).not.toContain(PLAN_TOOL);
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
		const fake = makePlanPi({ active: ["read", "web_search"] });
		fake.pi.allTools = [{ name: "web_search", annotations: { readOnlyHint: true } }];
		const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
		runtime.enable(planCtx().ctx);
		expect(fake.activeTools()).toContain("web_search");
	});

	test("disable does not activate tools that were not active", () => {
		const { runtime, ctx, activeTools } = setup({ active: ["read", "todo"] });
		runtime.enable(ctx);
		runtime.disable(ctx);
		expect(activeTools()).not.toContain("write");
		expect(activeTools()).not.toContain("edit");
		expect(activeTools()).not.toContain(PLAN_TOOL);
	});

	test("a redundant enable does not forget the tools to restore", () => {
		const { runtime, ctx, activeTools } = setup();
		runtime.enable(ctx);
		runtime.enable(ctx); // e.g. a session_tree restore while already enabled
		runtime.disable(ctx);
		expect(activeTools()).toContain("write");
		expect(activeTools()).toContain("edit");
		expect(activeTools()).toContain(PLAN_TOOL);
	});
});

describe("plan runtime — persistence and status", () => {
	test("persists enabled state only when it changes", () => {
		const { runtime, ctx, entries } = setup();
		runtime.enable(ctx);
		runtime.enable(ctx);
		expect(entries).toEqual([
			{ type: "custom", customType: STATE_TYPE, data: { enabled: true, removed: ["write", "edit"] } },
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

	test("restores enabled state from the branch and follows the latest entry", () => {
		const enabled = setup({ branch: [stateEntry(true)] });
		enabled.runtime.restore(enabled.ctx);
		expect(enabled.runtime.isEnabled()).toBe(true);
		expect(enabled.activeTools()).not.toContain("write");

		const disabled = setup({ branch: [stateEntry(true), stateEntry(false)] });
		disabled.runtime.restore(disabled.ctx);
		expect(disabled.runtime.isEnabled()).toBe(false);
	});

	test("the --plan flag forces plan mode on", () => {
		const { runtime, ctx, activeTools } = setup({ planFlag: true });
		runtime.restore(ctx);
		expect(runtime.isEnabled()).toBe(true);
		expect(activeTools()).not.toContain("edit");
	});

	test("a persisted choice wins over the --plan flag in both directions", () => {
		const off = setup({ planFlag: true, branch: [stateEntry(false)] });
		off.runtime.restore(off.ctx);
		expect(off.runtime.isEnabled()).toBe(false);
		expect(off.activeTools()).toContain("write");
		expect(off.activeTools()).toContain(PLAN_TOOL);

		const on = setup({ planFlag: true, branch: [stateEntry(true)] });
		on.runtime.restore(on.ctx);
		expect(on.runtime.isEnabled()).toBe(true);
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

	test("a bare chip names plan mode with no plan file", () => {
		const { runtime, ctx, statusCalls } = setup();
		runtime.enable(ctx);
		expect(runtime.lastPlanPath()).toBeUndefined();
		expect(String(statusCalls.at(-1)?.text)).toBe(`${GLYPHS.plan} plan`);
	});
});

describe("plan runtime — plan-tool identity", () => {
	test("recognizes the one plan-owned tool name", () => {
		const { runtime } = setup();
		expect(runtime.isOwnTool(PLAN_TOOL)).toBe(true);
		expect(runtime.isOwnTool("write")).toBe(false);
	});

	test("recognizes a plan tool sourced from this extension", () => {
		const fake = makePlanPi({ active: ["read"] });
		fake.pi.allTools = [{ name: PLAN_TOOL, sourceInfo: { path: "/this/index.ts" } }];
		const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi), { entryPath: "/this/index.ts" });
		expect(runtime.isOwnTool(PLAN_TOOL)).toBe(true);
	});

	test("rejects a plan tool sourced from another extension", () => {
		const fake = makePlanPi({ active: ["read"] });
		fake.pi.allTools = [{ name: PLAN_TOOL, sourceInfo: { path: "/other/index.ts" } }];
		const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi), { entryPath: "/this/index.ts" });
		expect(runtime.isOwnTool(PLAN_TOOL)).toBe(false);
	});

	test("accepts a plan tool whose source the host did not record", () => {
		const fake = makePlanPi({ active: ["read"] });
		fake.pi.allTools = [{ name: PLAN_TOOL }];
		const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi), { entryPath: "/this/index.ts" });
		expect(runtime.isOwnTool(PLAN_TOOL)).toBe(true);
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

		expect(changedSections(runtime.reviewed(path), plan).map((mark) => mark.changed)).toEqual([false, false]);
		expect(changedSections(runtime.reviewed(path), edited).map((mark) => mark.changed)).toEqual([false, true]);
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

	test("keeps the block digests a review wrote", () => {
		const { runtime, ctx } = setup({ branch: [baselineEntry(path, sectionDigests(plan))] });
		runtime.restore(ctx);

		// The reader on the branch is a parser over untrusted data: without carrying the
		// block digests through it, a persisted baseline could never mark a changed block.
		expect(runtime.reviewed(path)?.[0]?.blocks).toEqual(sectionDigests(plan)[0]?.blocks);
	});

	test("drops block digests that are not strings, and keeps the section", () => {
		// A branch entry is untrusted data: a block list is kept only where it is strings.
		const tampered = { title: "Goal", digest: "d", blocks: ["ok", 7] as unknown as string[] };
		const { runtime, ctx } = setup({ branch: [baselineEntry(path, [tampered])] });
		runtime.restore(ctx);

		expect(runtime.reviewed(path)).toEqual([{ title: "Goal", digest: "d", blocks: ["ok"] }]);
	});

	test("a branch that never reviewed the plan has no baseline", () => {
		const { runtime } = setup();
		runtime.markReviewed(path, plan);

		runtime.restore(planCtx({ branch: [stateEntry(true)] }).ctx);

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
		const treeCtx = planCtx({ branch: [stateEntry(true, ["write", "edit", "job"])] }).ctx;
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
		const offCtx = planCtx({ branch: [stateEntry(false)] }).ctx;
		runtime.restore(offCtx);

		expect(activeTools()).not.toContain("write");
		expect(activeTools()).toContain("grep");
	});
});

describe("path-argument scan", () => {
	test("detects common path argument names", () => {
		for (const input of [
			{ path: "a.ts" },
			{ file_path: "a.ts" },
			{ filePath: "a.ts" },
			{ files: ["a.ts", "b.ts"] },
			{ directory: "/tmp" },
		]) {
			expect(hasPathInput(input)).toBe(true);
		}
	});

	test("ignores path keys without string values", () => {
		expect(hasPathInput({ path: 123 })).toBe(false);
		expect(hasPathInput({ paths: [1, 2] })).toBe(false);
		expect(hasPathInput({ path: null })).toBe(false);
	});

	test("ignores inputs without path keys", () => {
		expect(hasPathInput({ query: "x" })).toBe(false);
		expect(hasPathInput({ command: "ls" })).toBe(false);
		expect(hasPathInput({})).toBe(false);
	});

	test("handles non-object input", () => {
		expect(hasPathInput(undefined)).toBe(false);
		expect(hasPathInput(null)).toBe(false);
		expect(hasPathInput("a.ts")).toBe(false);
		expect(hasPathInput(42)).toBe(false);
	});

	test("finds path keys nested in objects and arrays", () => {
		expect(hasPathInput({ options: { cwd: "/repo" } })).toBe(true);
		expect(hasPathInput({ tasks: [{ task: "x", cwd: "/repo" }] })).toBe(true);
		expect(hasPathInput({ args: { nested: { file_path: "a.ts" } } })).toBe(true);
	});

	test("recognizes path-key words in compound names", () => {
		for (const input of [
			{ cwd: "/repo" },
			{ root: "/repo" },
			{ outputDir: "/repo/out" },
			{ source_files: ["a.ts"] },
			{ include: ["**/*.ts"] },
			{ glob: "**/*.ts" },
		]) {
			expect(hasPathInput(input)).toBe(true);
		}
	});

	test("flags strongly path-shaped values under neutral keys", () => {
		for (const value of ["/etc/passwd", "../secrets", "src/index.ts", "C:\\Users\\me", "~/notes.md"]) {
			expect(hasPathInput({ whatever: value })).toBe(true);
		}
	});

	test("does not flag URLs, lone slash tokens, or plain words", () => {
		expect(hasPathInput({ url: "https://example.com/a/b" })).toBe(false);
		expect(hasPathInput({ label: "/plan" })).toBe(false);
		expect(hasPathInput({ query: "rate limiting" })).toBe(false);
		expect(hasPathInput({ command: "ls" })).toBe(false);
	});
});
