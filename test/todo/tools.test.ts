import { describe, expect, test } from "bun:test";
import { createTodoRuntime } from "../../extensions/todo/runtime.ts";
import { TOOL_NAME, registerTools } from "../../extensions/todo/tools.ts";
import { fakeCtx, lastWidget, makeFakePi } from "./helpers.ts";

function setup() {
	const { pi, tools } = makeFakePi();
	const runtime = createTodoRuntime();
	registerTools(pi, runtime);
	const tool = tools.get(TOOL_NAME);
	return { pi, tool, runtime };
}

const call = (tool: any, params: unknown, ctx: any) => tool.execute("call-1", params, undefined, undefined, ctx);

/** A theme double whose styled text stays assertable. */
const theme: any = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

describe("todo tool", () => {
	test("registers a sequential, non-read-only tool", () => {
		const { tool } = setup();
		expect(tool).toBeDefined();
		expect(tool.label).toBe("Todo");
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations.readOnlyHint).toBe(false);
		expect(tool.annotations.idempotentHint).toBe(true);
		expect(tool.promptGuidelines.length).toBeGreaterThan(0);
	});

	test("replaces the list and returns a checklist", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		const result = await call(
			tool,
			{
				todos: [
					{ content: "Write schema", status: "completed" },
					{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
				],
			},
			ctx,
		);

		expect(result.isError).toBeUndefined();
		expect(result.details.action).toBe("write");
		expect(result.details.todos).toEqual([
			{ content: "Write schema", status: "completed" },
			{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
		]);
		expect(result.content[0].text).toContain("1. [x] Write schema");
		expect(result.content[0].text).toContain("2. [~] Write tests");
		expect(runtime.getTodos()).toHaveLength(2);
	});

	test("updates the widget on a TUI session", async () => {
		const { tool } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		await call(tool, { todos: [{ content: "One", status: "pending" }] }, ctx);
		expect(widgetCalls.at(-1)?.key).toBe("todo-widget");
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("clearing empties the list and removes the widget", async () => {
		const { tool, runtime } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		await call(tool, { todos: [{ content: "One", status: "pending" }] }, ctx);
		const result = await call(tool, { todos: [] }, ctx);

		expect(result.details.action).toBe("clear");
		expect(result.content[0].text).toBe("Todo list cleared.");
		expect(runtime.getTodos()).toEqual([]);
		expect(lastWidget(widgetCalls)).toBeUndefined();
	});

	test("removes the widget once every item is completed", async () => {
		const { tool } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		await call(tool, { todos: [{ content: "One", status: "in_progress" }] }, ctx);
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);

		await call(tool, { todos: [{ content: "One", status: "completed" }] }, ctx);
		expect(lastWidget(widgetCalls)).toBeUndefined();
	});

	test("rejects two in_progress items without changing the list", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		await call(tool, { todos: [{ content: "Keep me", status: "pending" }] }, ctx);

		const result = await call(
			tool,
			{
				todos: [
					{ content: "A", status: "in_progress" },
					{ content: "B", status: "in_progress" },
				],
			},
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("At most one todo");
		expect(result.details.todos).toEqual([{ content: "Keep me", status: "pending" }]);
		expect(runtime.getTodos()).toEqual([{ content: "Keep me", status: "pending" }]);
	});

	test("streaming call shows a pending label, not a clear", () => {
		const { tool } = setup();
		const text = tool.renderCall({}, theme, { argsComplete: false }).render(80).join("\n");
		expect(text).toContain("todo → …");
		expect(text).not.toContain("clear list");
	});

	test("collapsed result leads with active work", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const todos = [
			...Array.from({ length: 8 }, (_, i) => ({ content: `done ${i}`, status: "completed" as const })),
			{ content: "current", status: "in_progress" as const },
		];
		const result = await call(tool, { todos }, ctx);
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true })
			.render(80)
			.join("\n");
		expect(text).toContain("◐ current");
	});

	test("works without a UI context", async () => {
		const { tool, runtime } = setup();
		const result = await call(tool, { todos: [{ content: "Headless", status: "pending" }] }, undefined);
		expect(result.isError).toBeUndefined();
		expect(runtime.getTodos()).toEqual([{ content: "Headless", status: "pending" }]);
	});
});
