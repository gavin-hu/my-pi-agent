import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeTheme } from "../helpers/fakes.ts";
import { createPlanPolicy } from "../../extensions/plan-mode/policy.ts";
import { createPlanRuntime, ENTER_TOOL, EXIT_TOOL, WRITE_PLAN_TOOL } from "../../extensions/plan-mode/runtime.ts";
import { registerTools } from "../../extensions/plan-mode/tools.ts";
import { fakeCtx, makeFakePi } from "./helpers.ts";

function repoExec(root: string) {
	return async (command: string, args: string[]) =>
		command === "git" && args[0] === "rev-parse"
			? { stdout: `${root}\n`, stderr: "", code: 0 }
			: { stdout: "", stderr: "", code: 1 };
}

function setup() {
	const root = mkdtempSync(join(tmpdir(), "pi-plan-tools-"));
	const fake = makeFakePi({
		active: ["read", "bash", "write", "edit", ENTER_TOOL, "todo"],
		exec: repoExec(root),
	});
	const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
	registerTools(fake.pi, runtime);
	return {
		...fake,
		runtime,
		root,
		enter: fake.tools.get(ENTER_TOOL),
		exit: fake.tools.get(EXIT_TOOL),
		write: fake.tools.get(WRITE_PLAN_TOOL),
	};
}

const call = (tool: any, params: unknown, ctx: any) => tool.execute("call-1", params, undefined, undefined, ctx);

/** Enter plan mode through the real tool, in a repository rooted at `cwd`. */
async function enterPlan(enter: any, runtime: any, cwd: string) {
	const { ctx } = fakeCtx({ confirm: true, cwd });
	await call(enter, {}, ctx);
	expect(runtime.isEnabled()).toBe(true);
}

/** Save a plan file through the real tool and return its path. */
async function savePlan(write: any, ctx: any, content: string): Promise<string> {
	const result = await call(write, { title: "Test plan", content }, ctx);
	expect(result.isError).toBeUndefined();
	return (result.details as { path: string }).path;
}

describe("enter_plan_mode", () => {
	test("is active by default, unlike exit_plan_mode and write_plan", () => {
		const { enter, exit, write } = setup();
		expect(enter.defaultActive).toBeUndefined();
		expect(exit.defaultActive).toBe(false);
		expect(write.defaultActive).toBe(false);
	});

	test("enables plan mode and activates both control tools when the user confirms", async () => {
		const { enter, runtime, activeTools, root } = setup();
		const { ctx } = fakeCtx({ confirm: true, cwd: root });
		const result = await call(enter, {}, ctx);

		expect(result.details).toEqual({ entered: true });
		expect(runtime.isEnabled()).toBe(true);
		expect(activeTools()).not.toContain("write");
		expect(activeTools()).toContain(EXIT_TOOL);
		expect(activeTools()).toContain(WRITE_PLAN_TOOL);
		expect(result.content[0].text).toContain("write_plan");
	});

	test("stays in normal mode when the user declines", async () => {
		const { enter, runtime, root } = setup();
		const { ctx } = fakeCtx({ confirm: false, cwd: root });
		const result = await call(enter, {}, ctx);

		expect(result.details).toEqual({ entered: false });
		expect(result.isError).toBeUndefined();
		expect(runtime.isEnabled()).toBe(false);
	});

	test("reports an error without a UI", async () => {
		const { enter, runtime, root } = setup();
		const { ctx } = fakeCtx({ hasUI: false, cwd: root });
		const result = await call(enter, {}, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
	});
});

describe("write_plan", () => {
	test("refuses outside plan mode", async () => {
		const { write, root } = setup();
		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(write, { title: "x", content: "y" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Not in plan mode");
	});

	test("writes the plan file, remembers it, and repaints the footer", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx, statusCalls } = fakeCtx({ cwd: root });

		const result = await call(write, { title: "Add rate limiting", content: "# Plan\n1. Do it" }, ctx);
		const details = result.details as { path: string; relativePath: string; bytes: number };

		expect(existsSync(details.path)).toBe(true);
		expect(readFileSync(details.path, "utf-8")).toBe("# Plan\n1. Do it");
		expect(details.path).toContain(join(".pi", "plans"));
		expect(details.bytes).toBeGreaterThan(0);
		expect(result.content[0].text).toContain(details.path);
		expect(runtime.lastPlanPath()).toBe(details.path);
		expect(String(statusCalls.at(-1)?.text)).toContain("⏸ plan");
	});

	test("reports a write failure as an error result", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(write, { title: "   ", content: "y" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Could not write the plan");
	});

	test("renders the saved path", () => {
		const { write } = setup();
		const component = write.renderResult(
			{ details: { path: "/x/.pi/plans/p.md", relativePath: ".pi/plans/p.md", bytes: 1 } },
			{ expanded: false },
			fakeTheme,
		);
		expect(component.render(80).join("\n")).toContain(".pi/plans/p.md");
	});

	test("renders the relative plan path, not the absolute one", () => {
		const { exit } = setup();
		const component = exit.renderResult(
			{ details: { approved: true, plan: "# P", planPath: "/x/.pi/plans/p.md", relativePath: ".pi/plans/p.md" } },
			{ expanded: false },
			fakeTheme,
		);
		const text = component.render(80).join("\n");
		expect(text).toContain(".pi/plans/p.md");
		expect(text).not.toContain("/x/.pi/plans/p.md");
	});
});

describe("exit_plan_mode", () => {
	test("rejects when not in plan mode", async () => {
		const { exit, root } = setup();
		const { ctx } = fakeCtx({ select: "Approve and execute", cwd: root });
		const result = await call(exit, { plan_path: join(root, ".pi", "plans", "x.md") }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Not in plan mode");
	});

	test("rejects a missing plan file and a path outside the plans directory", async () => {
		const { enter, exit, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = fakeCtx({ cwd: root });

		const missing = await call(exit, { plan_path: join(root, ".pi", "plans", "nope.md") }, ctx);
		expect(missing.isError).toBe(true);
		expect(missing.content[0].text).toContain("No plan file");

		writeFileSync(join(root, "secret.md"), "s");
		const outside = await call(exit, { plan_path: join(root, "secret.md") }, ctx);
		expect(outside.isError).toBe(true);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("reports an error without a UI", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = fakeCtx({ hasUI: false, cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("keeps planning when the user chooses that or cancels", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		for (const selection of ["Keep planning", undefined]) {
			const { ctx } = fakeCtx({ select: selection, cwd: root });
			const result = await call(exit, { plan_path: planPath }, ctx);
			expect(result.details.approved).toBe(false);
			expect(result.isError).toBeUndefined();
			expect(runtime.isEnabled()).toBe(true);
		}
	});

	test("approves, restores write access, and seeds the todo list from the file", async () => {
		const { enter, exit, write, runtime, activeTools, root } = setup();
		await enterPlan(enter, runtime, root);
		const plan = ["Plan:", "1. Read the parser", "2. Add a tokenizer", "3. Update tests"].join("\n");
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = fakeCtx({ select: "Approve and execute", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(result.details.approved).toBe(true);
		expect(result.details.planPath).toBe(planPath);
		expect(result.details.seeded).toBe(3);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");
		expect(activeTools()).not.toContain(EXIT_TOOL);
		expect(activeTools()).not.toContain(WRITE_PLAN_TOOL);

		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].name).toBe("todo");
		expect(toolCalls[0].args).toEqual({
			todos: [
				{ content: "Read the parser", status: "pending" },
				{ content: "Add a tokenizer", status: "pending" },
				{ content: "Update tests", status: "pending" },
			],
		});
		expect(result.content[0].text).toContain("test-plan.md");
		expect(result.content[0].text).toContain("source of truth");
	});

	test("accepts a plan_path relative to the working directory", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");
		const relative = planPath.slice(root.length + 1);

		const { ctx } = fakeCtx({ select: "Approve and execute", cwd: root });
		const result = await call(exit, { plan_path: relative }, ctx);
		expect(result.details.approved).toBe(true);
	});

	test("approves even when the todo tool is unavailable", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Only step");

		const { ctx, setExecuteError } = fakeCtx({ select: "Approve and execute", cwd: root });
		setExecuteError(true);
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
		expect(result.details.seeded).toBe(0);
	});

	test("returns the user's refinement and stays in plan mode", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Use a generator");

		const { ctx } = fakeCtx({ select: "Refine the plan", editor: "  Use a hand-written lexer instead.  ", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.refined).toBe(true);
		expect(result.details.refinement).toBe("Use a hand-written lexer instead.");
		expect(result.content[0].text).toContain("Use a hand-written lexer instead.");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("treats an empty refinement as keeping planning", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Use a generator");

		const { ctx } = fakeCtx({ select: "Refine the plan", editor: "   ", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.refined).toBeUndefined();
		expect(result.details.approved).toBe(false);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("uses the review screen in TUI mode", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = fakeCtx({ mode: "tui", custom: "approve", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
	});
});
