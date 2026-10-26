import { describe, expect, test } from "bun:test";
import { MAX_TODOS } from "../../lib/todo-state.ts";
import {
	EMPTY_LIST_MUTATIONS,
	formatNudge,
	isFileWrite,
	isMutatingTool,
	MUTATING_TOOL_NAMES,
	type NudgeState,
	shouldNudge,
	TODO_NUDGE_MARKER,
} from "./nudge.ts";
import { createTodoRuntime } from "./runtime.ts";
import { TOOL_NAME, registerTools } from "./tools.ts";
import { fakeTheme as theme } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { lastWidget } from "../../test/helpers/entries.ts";
import { makeFakePi } from "../../test/helpers/fakes.ts";
import type { Todo } from "./types.ts";

function setup() {
	const { pi, tools } = makeFakePi();
	const runtime = createTodoRuntime();
	registerTools(pi, runtime);
	const tool = tools.get(TOOL_NAME);
	return { pi, tool, runtime };
}

const call = (tool: any, params: unknown, ctx: any) => tool.execute("call-1", params, undefined, undefined, ctx);

const pending = (content: string): Todo => ({ content, status: "pending" });
const completed = (content: string): Todo => ({ content, status: "completed" });
const inProgress = (content: string, activeForm: string): Todo => ({ content, status: "in_progress", activeForm });

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

	test("the call line shows progress only, naming the tool once", () => {
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
		expect(text).toContain("todo → 1/2");
		expect(text).not.toContain("Writing tests");
		expect(text).not.toContain("todo todo");
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
		expect(text).toContain("◒ current");
	});

	test("works without a UI context", async () => {
		const { tool, runtime } = setup();
		const result = await call(tool, { todos: [{ content: "Headless", status: "pending" }] }, undefined);
		expect(result.isError).toBeUndefined();
		expect(runtime.getTodos()).toEqual([{ content: "Headless", status: "pending" }]);
	});
});

describe("nudge rules", () => {
	test("the mutating set is the built-in writers and shells, and the todo call is never work", () => {
		expect([...MUTATING_TOOL_NAMES].sort()).toEqual(["bash", "edit", "powershell", "write"]);
		expect(isMutatingTool("todo", { readOnlyHint: false })).toBe(false);
		for (const name of MUTATING_TOOL_NAMES) expect(isMutatingTool(name)).toBe(true);
	});

	test("a board read is not work, and any other board verb is", () => {
		// The board is one tool over ten actions, so its hint says "may write" and the
		// action the result reports is what tells a read from a change.
		expect(isMutatingTool("board", { readOnlyHint: false }, { action: "list" })).toBe(false);
		expect(isMutatingTool("board", { readOnlyHint: false }, { action: "claim" })).toBe(true);
		// A result with no detail to read is a mutation, because the hint says so.
		expect(isMutatingTool("board", { readOnlyHint: false })).toBe(true);
		expect(isMutatingTool("board", undefined, { action: "list" })).toBe(false);
	});

	test("a known reader is not work, and an unknown tool needs an explicit mutation hint", () => {
		expect(isMutatingTool("read")).toBe(false);
		expect(isMutatingTool("grep", {})).toBe(false);
		expect(isMutatingTool("some_mcp_tool")).toBe(false);
		expect(isMutatingTool("some_mcp_tool", { readOnlyHint: true })).toBe(false);
		expect(isMutatingTool("some_mcp_tool", { readOnlyHint: false })).toBe(true);
	});

	test("only a non-shell mutator can be a file write", () => {
		expect(isFileWrite("write")).toBe(true);
		expect(isFileWrite("edit")).toBe(true);
		expect(isFileWrite("bash")).toBe(false);
		expect(isFileWrite("powershell")).toBe(false);
		expect(isFileWrite("todo", { readOnlyHint: false })).toBe(false);
		expect(isFileWrite("read")).toBe(false);
		expect(isFileWrite("some_mcp_tool")).toBe(false);
		expect(isFileWrite("some_mcp_tool", { readOnlyHint: false })).toBe(true);
	});

	const state = (overrides: Partial<NudgeState> = {}): NudgeState => ({
		mutations: 1,
		writes: 1,
		touched: false,
		nudged: false,
		todos: [pending("one")],
		...overrides,
	});

	test("an open item is due after one mutation until a reminder is sent", () => {
		expect(shouldNudge(state())).toBe(true);
		expect(shouldNudge(state({ mutations: 0 }))).toBe(false);
		expect(shouldNudge(state({ nudged: true }))).toBe(false);
	});

	test("no list is due only after repeated work that wrote something", () => {
		expect(shouldNudge(state({ todos: [], mutations: EMPTY_LIST_MUTATIONS - 1 }))).toBe(false);
		expect(shouldNudge(state({ todos: [], mutations: EMPTY_LIST_MUTATIONS }))).toBe(true);
		expect(shouldNudge(state({ todos: [], writes: 0, mutations: EMPTY_LIST_MUTATIONS }))).toBe(false);
	});

	test("a list the model wrote or cleared this turn is left alone", () => {
		expect(shouldNudge(state({ todos: [], touched: true }))).toBe(false);
		expect(shouldNudge(state({ todos: [], touched: true, mutations: EMPTY_LIST_MUTATIONS }))).toBe(false);
	});

	test("never due when every item is completed", () => {
		expect(shouldNudge(state({ todos: [completed("done")], mutations: EMPTY_LIST_MUTATIONS }))).toBe(false);
	});

	test("the reminder carries the marker and points at the active item", () => {
		expect(formatNudge([inProgress("Write tests", "Writing tests"), pending("Ship")])).toContain(TODO_NUDGE_MARKER);
		expect(formatNudge([inProgress("Write tests", "Writing tests"), pending("Ship")])).toContain("Writing tests");
		expect(formatNudge([completed("done"), completed("also done")])).not.toContain("still points at");
	});

	test("the no-list reminder asks for a list and nothing else", () => {
		const text = formatNudge([]);
		expect(text).toContain(TODO_NUDGE_MARKER);
		expect(text).toContain("no todo list was recorded");
		expect(text).not.toContain("still points at");
		expect(text).not.toContain("unfinished items");
	});
});
