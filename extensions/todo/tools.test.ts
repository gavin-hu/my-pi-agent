import { describe, expect, test } from "bun:test";
import { MAX_TODOS } from "./schema.ts";
import { createTodoRuntime } from "./runtime.ts";
import { TOOL_NAME, registerTools } from "./tools.ts";
import { fakeTheme as theme } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { lastWidget } from "../../test/helpers/entries.ts";
import { makeFakePi } from "../../test/helpers/fakes.ts";

function setup() {
	const { pi, tools } = makeFakePi();
	const runtime = createTodoRuntime();
	registerTools(pi, runtime);
	const tool = tools.get(TOOL_NAME);
	return { pi, tool, runtime };
}

const call = (tool: any, params: unknown, ctx: any) => tool.execute("call-1", params, undefined, undefined, ctx);

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

	test("replaces the list and returns a compact summary", async () => {
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
		expect(result.content[0].text).toContain("1/2 completed");
		expect(result.content[0].text).toContain("In progress: Writing tests");
		expect(result.content[0].text).not.toContain("Write schema");
		expect(runtime.getTodos()).toHaveLength(2);
	});

	test("declares an output schema and returns structured content", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		expect(tool.outputSchema).toBeDefined();

		const result = await call(tool, { todos: [{ content: "One", status: "pending" }] }, ctx);
		expect(result.structuredContent).toEqual({ todos: [{ content: "One", status: "pending" }], action: "write" });
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
		await call(tool, { todos: [{ content: "One", status: "in_progress", activeForm: "Doing one" }] }, ctx);
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
					{ content: "A", status: "in_progress", activeForm: "Doing A" },
					{ content: "B", status: "in_progress", activeForm: "Doing B" },
				],
			},
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("At most one todo");
		expect(result.details.todos).toEqual([{ content: "Keep me", status: "pending" }]);
		expect(result.structuredContent).toEqual({
			todos: [{ content: "Keep me", status: "pending" }],
			action: "write",
			error: result.details.error,
		});
		expect(runtime.getTodos()).toEqual([{ content: "Keep me", status: "pending" }]);
	});

	test("rejects too many items without changing the list", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		await call(tool, { todos: [{ content: "Keep me", status: "pending" }] }, ctx);

		const many = Array.from({ length: MAX_TODOS + 1 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
		const result = await call(tool, { todos: many }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.error).toContain(`At most ${MAX_TODOS}`);
		expect(runtime.getTodos()).toEqual([{ content: "Keep me", status: "pending" }]);
	});

	test("streaming call shows a pending label, not a clear", () => {
		const { tool } = setup();
		const text = tool.renderCall({}, theme, { argsComplete: false, lastComponent: undefined }).render(80).join("\n");
		expect(text).toContain("todo → …");
		expect(text).not.toContain("clear list");
	});

	test("the call line shows progress and the active item, naming the tool once", () => {
		const { tool } = setup();
		const text = tool
			.renderCall(
				{
					todos: [
						{ content: "Write schema", status: "completed" },
						{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
					],
				},
				theme,
				{ argsComplete: true, lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(text).toContain("todo → 1/2 · Writing tests");
		expect(text).not.toContain("todo todo");
	});

	test("reuses the call Text and the result view across renders", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const callComponent = tool.renderCall({ todos: [{ content: "A", status: "pending" }] }, theme, {
			argsComplete: true,
			lastComponent: undefined,
		});
		const callAgain = tool.renderCall({ todos: [{ content: "B", status: "pending" }] }, theme, {
			argsComplete: true,
			lastComponent: callComponent,
		});
		expect(callAgain).toBe(callComponent);

		const result = await call(tool, { todos: [{ content: "A", status: "pending" }] }, ctx);
		const view = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined });
		const viewAgain = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: view });
		expect(viewAgain).toBe(view);
	});

	test("collapsed result leads with active work", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const todos = [
			...Array.from({ length: 8 }, (_, i) => ({ content: `done ${i}`, status: "completed" as const })),
			{ content: "current", status: "in_progress" as const, activeForm: "current" },
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
