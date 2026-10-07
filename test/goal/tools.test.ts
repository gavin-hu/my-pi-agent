import { describe, expect, test } from "bun:test";
import { createGoalRuntime } from "../../extensions/goal/runtime.ts";
import { TOOL_NAME, registerTools } from "../../extensions/goal/tools.ts";
import { WIDGET_KEY } from "../../extensions/goal/tui.ts";
import { fakeCtx, lastWidget, makeFakePi } from "./helpers.ts";

function setup() {
	const { pi, tools } = makeFakePi();
	const runtime = createGoalRuntime();
	registerTools(pi, runtime);
	const tool = tools.get(TOOL_NAME);
	return { pi, tool, runtime };
}

const call = (tool: any, params: unknown, ctx: any) =>
	tool.execute("call-1", params, undefined, undefined, ctx);

/** A theme double whose styled text stays assertable. */
const theme: any = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

describe("goal tool", () => {
	test("registers a sequential, non-read-only, idempotent tool", () => {
		const { tool } = setup();
		expect(tool).toBeDefined();
		expect(tool.label).toBe("Goal");
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations.readOnlyHint).toBe(false);
		expect(tool.annotations.idempotentHint).toBe(true);
		expect(tool.promptGuidelines.length).toBeGreaterThan(0);
	});

	test("sets the goal and returns it", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		const result = await call(tool, { objective: "Ship the parser" }, ctx);

		expect(result.isError).toBeUndefined();
		expect(result.details.action).toBe("set");
		expect(result.details.goal).toEqual({ objective: "Ship the parser", status: "active" });
		expect(result.content[0].text).toContain("Ship the parser");
		expect(runtime.getGoal()).toEqual({ objective: "Ship the parser", status: "active" });
	});

	test("marks the goal achieved", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		await call(tool, { objective: "Ship the parser" }, ctx);
		const result = await call(tool, { objective: "Ship the parser", status: "achieved" }, ctx);

		expect(result.details.action).toBe("achieve");
		expect(result.details.goal.status).toBe("achieved");
		expect(runtime.getGoal()).toEqual({ objective: "Ship the parser", status: "achieved" });
	});

	test("updates the widget on a TUI session", async () => {
		const { tool } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		await call(tool, { objective: "Ship the parser" }, ctx);

		expect(widgetCalls.at(-1)?.key).toBe(WIDGET_KEY);
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("clearing removes the goal and the widget", async () => {
		const { tool, runtime } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		await call(tool, { objective: "Ship the parser" }, ctx);
		const result = await call(tool, { objective: "" }, ctx);

		expect(result.details.action).toBe("clear");
		expect(result.details.goal).toBeNull();
		expect(result.content[0].text).toBe("Goal cleared.");
		expect(runtime.getGoal()).toBeNull();
		expect(lastWidget(widgetCalls)).toBeUndefined();
	});

	test("rejects an over-long objective without changing the goal", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		await call(tool, { objective: "Keep me" }, ctx);

		const result = await call(tool, { objective: "x".repeat(5000) }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("longer than");
		expect(result.details.goal).toEqual({ objective: "Keep me", status: "active" });
		expect(runtime.getGoal()).toEqual({ objective: "Keep me", status: "active" });
	});

	test("streaming call shows a pending label, not a clear", () => {
		const { tool } = setup();
		const text = tool.renderCall({}, theme, { argsComplete: false }).render(80).join("\n");
		expect(text).toContain("goal → …");
		expect(text).not.toContain("clear");
	});

	test("renderResult shows the objective block", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const result = await call(tool, { objective: "Ship the parser" }, ctx);
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true })
			.render(80)
			.join("\n");
		expect(text).toContain("| ◎ Goal");
		expect(text).toContain("Ship the parser");
	});

	test("renderResult shows an achieved goal and expands the objective", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const objective =
			"Refactor the parser to support streaming input and ship it with tests, then update the docs and changelog";
		const result = await call(tool, { objective, status: "achieved" }, ctx);

		const collapsed = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true })
			.render(200)
			.join("\n");
		expect(collapsed).toContain("| ✓ Goal achieved");
		expect(collapsed).toContain("Refactor the parser");
		expect(collapsed).toContain("…");
		expect(collapsed).not.toContain("changelog");

		const expanded = tool
			.renderResult(result, { expanded: true, isPartial: false }, theme, { argsComplete: true })
			.render(200)
			.join("\n");
		expect(expanded).toContain("changelog");
		expect(expanded).not.toContain("…");
	});

	test("dims an achieved objective in the collapsed transcript result", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const tagged: any = { fg: (color: string, text: string) => `[${color}]${text}`, bold: (text: string) => text };

		const achieved = await call(tool, { objective: "Ship the parser", status: "achieved" }, ctx);
		const collapsed = tool
			.renderResult(achieved, { expanded: false, isPartial: false }, tagged, { argsComplete: true })
			.render(200)
			.join("\n");
		expect(collapsed).toContain("[dim]Ship the parser");

		const active = await call(tool, { objective: "Ship the parser" }, ctx);
		const activeText = tool
			.renderResult(active, { expanded: false, isPartial: false }, tagged, { argsComplete: true })
			.render(200)
			.join("\n");
		expect(activeText).toContain("[text]Ship the parser");
	});

	test("keeps the quote bar on every wrapped transcript row", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const objective =
			"Refactor the parser to support streaming input and ship it with tests, then update the docs and changelog";
		const result = await call(tool, { objective, status: "achieved" }, ctx);

		const lines = tool
			.renderResult(result, { expanded: true, isPartial: false }, theme, { argsComplete: true })
			.render(40);

		expect(lines.length).toBeGreaterThan(2);
		expect(lines.every((line: string) => line.startsWith("| "))).toBe(true);
	});

	test("renders a clear with a neutral marker, not the achieved check", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		await call(tool, { objective: "Ship the parser" }, ctx);
		const result = await call(tool, { objective: "" }, ctx);

		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true })
			.render(80)
			.join("\n");
		expect(text).toContain("Cleared the goal");
		expect(text).not.toContain("✓");
	});

	test("labels an achieve call as achieve", () => {
		const { tool } = setup();
		const text = tool
			.renderCall({ objective: "Ship the parser", status: "achieved" }, theme, { argsComplete: true })
			.render(80)
			.join("\n");
		expect(text).toContain("goal → achieve:");
	});

	test("a rejected achieve reports the attempted action", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		await call(tool, { objective: "Keep me" }, ctx);

		const result = await call(tool, { objective: "x".repeat(5000), status: "achieved" }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.action).toBe("achieve");
	});

	test("works without a UI context", async () => {
		const { tool, runtime } = setup();
		const result = await call(tool, { objective: "Headless" }, undefined);
		expect(result.isError).toBeUndefined();
		expect(runtime.getGoal()).toEqual({ objective: "Headless", status: "active" });
	});
});
