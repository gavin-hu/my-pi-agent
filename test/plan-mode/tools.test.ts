import { describe, expect, test } from "bun:test";
import { createPlanRuntime, ENTER_TOOL, EXIT_TOOL } from "../../extensions/plan-mode/runtime.ts";
import { registerTools } from "../../extensions/plan-mode/tools.ts";
import { fakeCtx, makeFakePi } from "./helpers.ts";

function setup() {
	const fake = makeFakePi({ active: ["read", "bash", "write", "edit", ENTER_TOOL, "todo"] });
	const runtime = createPlanRuntime(fake.pi);
	registerTools(fake.pi, runtime);
	return { ...fake, runtime, enter: fake.tools.get(ENTER_TOOL), exit: fake.tools.get(EXIT_TOOL) };
}

const call = (tool: any, params: unknown, ctx: any) => tool.execute("call-1", params, undefined, undefined, ctx);

/** Enable plan mode through the real enter tool. */
async function enterPlan(enter: any, runtime: any) {
	const { ctx } = fakeCtx({ confirm: true });
	await call(enter, {}, ctx);
	expect(runtime.isEnabled()).toBe(true);
}

describe("enter_plan_mode", () => {
	test("is active by default, unlike exit_plan_mode", () => {
		const { enter, exit } = setup();
		expect(enter.defaultActive).toBeUndefined();
		expect(exit.defaultActive).toBe(false);
	});

	test("enables plan mode when the user confirms", async () => {
		const { enter, runtime, activeTools } = setup();
		const { ctx } = fakeCtx({ confirm: true });
		const result = await call(enter, {}, ctx);

		expect(result.details).toEqual({ entered: true });
		expect(runtime.isEnabled()).toBe(true);
		expect(activeTools()).not.toContain("write");
		expect(activeTools()).toContain(EXIT_TOOL);
		expect(result.content[0].text).toContain("now in plan mode");
	});

	test("stays in normal mode when the user declines", async () => {
		const { enter, runtime } = setup();
		const { ctx } = fakeCtx({ confirm: false });
		const result = await call(enter, {}, ctx);

		expect(result.details).toEqual({ entered: false });
		expect(result.isError).toBeUndefined();
		expect(runtime.isEnabled()).toBe(false);
	});

	test("reports an error without a UI", async () => {
		const { enter, runtime } = setup();
		const { ctx } = fakeCtx({ hasUI: false });
		const result = await call(enter, {}, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
	});

	test("is idempotent when already planning", async () => {
		const { enter, runtime } = setup();
		const { ctx } = fakeCtx({ confirm: true });
		await call(enter, {}, ctx);
		const again = await call(enter, {}, ctx);
		expect(again.details).toEqual({ entered: true });
		expect(runtime.isEnabled()).toBe(true);
	});
});

describe("exit_plan_mode", () => {
	test("rejects when not in plan mode", async () => {
		const { exit } = setup();
		const { ctx } = fakeCtx({ select: "Approve and execute" });
		const result = await call(exit, { plan: "1. Do it" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Not in plan mode");
	});

	test("reports an error without a UI", async () => {
		const { enter, exit, runtime } = setup();
		await enterPlan(enter, runtime);
		const { ctx } = fakeCtx({ hasUI: false });
		const result = await call(exit, { plan: "1. Do it" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("keeps planning when the user chooses that", async () => {
		const { enter, exit, runtime } = setup();
		await enterPlan(enter, runtime);
		const { ctx } = fakeCtx({ select: "Keep planning" });
		const result = await call(exit, { plan: "1. Do it" }, ctx);
		expect(result.details.approved).toBe(false);
		expect(result.isError).toBeUndefined();
		expect(runtime.isEnabled()).toBe(true);
	});

	test("keeps planning when the dialog is cancelled", async () => {
		const { enter, exit, runtime } = setup();
		await enterPlan(enter, runtime);
		const { ctx } = fakeCtx({ select: undefined });
		const result = await call(exit, { plan: "1. Do it" }, ctx);
		expect(result.details.approved).toBe(false);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("approves, restores write access, and seeds the todo list", async () => {
		const { enter, exit, runtime, activeTools } = setup();
		await enterPlan(enter, runtime);

		const plan = ["Plan:", "1. Read the parser", "2. Add a tokenizer", "3. Update tests"].join("\n");
		const { ctx, toolCalls } = fakeCtx({ select: "Approve and execute" });
		const result = await call(exit, { plan }, ctx);

		expect(result.details.approved).toBe(true);
		expect(result.details.seeded).toBe(3);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");
		expect(activeTools()).not.toContain(EXIT_TOOL);

		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].name).toBe("todo");
		expect(toolCalls[0].args).toEqual({
			todos: [
				{ content: "Read the parser", status: "pending" },
				{ content: "Add a tokenizer", status: "pending" },
				{ content: "Update tests", status: "pending" },
			],
		});
	});

	test("approves even when the todo tool is unavailable", async () => {
		const { enter, exit, runtime } = setup();
		await enterPlan(enter, runtime);
		const { ctx, setExecuteError } = fakeCtx({ select: "Approve and execute" });
		setExecuteError(true);

		const result = await call(exit, { plan: "1. Only step" }, ctx);
		expect(result.details.approved).toBe(true);
		expect(result.details.seeded).toBe(0);
		expect(runtime.isEnabled()).toBe(false);
	});

	test("seeds nothing when the plan has no steps", async () => {
		const { enter, exit, runtime } = setup();
		await enterPlan(enter, runtime);
		const { ctx, toolCalls } = fakeCtx({ select: "Approve and execute" });
		const result = await call(exit, { plan: "I could not produce steps." }, ctx);
		expect(result.details.approved).toBe(true);
		expect(result.details.seeded).toBe(0);
		expect(toolCalls).toHaveLength(0);
	});

	test("returns the user's refinement and stays in plan mode", async () => {
		const { enter, exit, runtime } = setup();
		await enterPlan(enter, runtime);
		const { ctx } = fakeCtx({ select: "Refine the plan", editor: "  Use a hand-written lexer instead.  " });

		const result = await call(exit, { plan: "1. Use a generator" }, ctx);
		expect(result.details).toEqual({
			approved: false,
			plan: "1. Use a generator",
			refined: true,
			refinement: "Use a hand-written lexer instead.",
		});
		expect(result.content[0].text).toContain("Use a hand-written lexer instead.");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("treats an empty refinement as keeping planning", async () => {
		const { enter, exit, runtime } = setup();
		await enterPlan(enter, runtime);
		const { ctx } = fakeCtx({ select: "Refine the plan", editor: "   " });

		const result = await call(exit, { plan: "1. Use a generator" }, ctx);
		expect(result.details.refined).toBeUndefined();
		expect(result.details.approved).toBe(false);
		expect(runtime.isEnabled()).toBe(true);
	});
});
