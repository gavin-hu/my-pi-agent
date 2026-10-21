import { describe, expect, test } from "bun:test";
import { PLAN_CONSENT, PLAN_ENTER_REQUEST, type PlanEnterRequest } from "../../lib/plan-entry.ts";
import { createGoalRuntime } from "./runtime.ts";
import { TOOL_NAME, registerTools } from "./tools.ts";
import { WIDGET_KEY } from "./tui.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { lastWidget } from "../../test/helpers/entries.ts";
import { fakeTheme, makeFakePi } from "../../test/helpers/fakes.ts";

function setup(options: { plan?: boolean } = {}) {
	// `allTools` stands in for the plan extension's registration, which is what the
	// phase decision probes before asking the user anything.
	const { pi, tools } = makeFakePi(options.plan ? { allTools: [{ name: "enter_plan_mode" }] } : {});
	const runtime = createGoalRuntime();
	registerTools(pi, runtime);
	const tool = tools.get(TOOL_NAME);
	return { pi, tool, runtime };
}

const call = (tool: any, params: unknown, ctx: any) => tool.execute("call-1", params, undefined, undefined, ctx);

/** A session entry carrying one todo tool result. */
function todoResult(todos: unknown): unknown {
	return { type: "message", message: { role: "toolResult", toolName: "todo", details: { todos, action: "write" } } };
}

/** A theme double whose styled text stays assertable. */
const theme = fakeTheme;

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

	test("declares an output schema and returns structured content", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		expect(tool.outputSchema).toBeDefined();

		const result = await call(tool, { objective: "Ship the parser" }, ctx);
		expect(result.structuredContent).toEqual({
			goal: { objective: "Ship the parser", status: "active" },
			action: "set",
		});
	});

	test("structured content reports a clear as a null goal", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		await call(tool, { objective: "Ship the parser" }, ctx);

		const result = await call(tool, { objective: "" }, ctx);
		expect(result.structuredContent).toEqual({ goal: null, action: "clear" });
	});

	test("structured content mirrors a rejected call's unchanged goal and error", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		await call(tool, { objective: "Keep me" }, ctx);

		const result = await call(tool, { objective: "x".repeat(5000) }, ctx);

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toEqual({
			goal: { objective: "Keep me", status: "active" },
			action: "set",
			error: result.details.error,
		});
		// No `undefined` values leak into the JSON payload.
		expect(JSON.parse(JSON.stringify(result.structuredContent))).toEqual(result.structuredContent);
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

	test("records a draft when the user accepts the plan offer", async () => {
		const { tool, pi } = setup({ plan: true });
		const { ctx, confirms } = fakeCtx({ confirm: true });
		pi.events.on(PLAN_ENTER_REQUEST, (data: unknown) => (data as PlanEnterRequest).respond(true));

		const result = await call(tool, { objective: "Ship the parser" }, ctx);

		expect(confirms).toEqual([{ title: "Plan first?", message: PLAN_CONSENT }]);
		expect(result.details.goal).toEqual({ objective: "Ship the parser", status: "planning" });
		expect(result.content[0].text).toContain("Goal (planning): Ship the parser");
		expect(result.structuredContent).toEqual({
			goal: { objective: "Ship the parser", status: "planning" },
			action: "set",
		});
	});

	test("records an active goal when the plan offer is declined", async () => {
		const { tool } = setup({ plan: true });
		const { ctx } = fakeCtx({ confirm: false });

		const result = await call(tool, { objective: "Ship the parser" }, ctx);
		expect(result.details.goal).toEqual({ objective: "Ship the parser", status: "active" });
	});

	test("an explicit active status finalizes a draft without asking", async () => {
		const { tool, pi } = setup({ plan: true });
		const { ctx, confirms } = fakeCtx({ confirm: true });
		pi.events.on(PLAN_ENTER_REQUEST, (data: unknown) => (data as PlanEnterRequest).respond(true));

		const draft = await call(tool, { objective: "Ship the parser" }, ctx);
		expect(draft.details.goal.status).toBe("planning");

		const result = await call(tool, { objective: "Ship it well", status: "active" }, ctx);
		expect(confirms).toHaveLength(1);
		expect(result.details.goal).toEqual({ objective: "Ship it well", status: "active" });
	});

	test("does not ask again when an active goal is refined", async () => {
		const { tool } = setup({ plan: true });
		const { ctx, confirms } = fakeCtx({ confirm: true });
		await call(tool, { objective: "Ship the parser" }, ctx);
		confirms.length = 0;

		const result = await call(tool, { objective: "Ship it well" }, ctx);
		expect(confirms).toEqual([]);
		expect(result.details.goal).toEqual({ objective: "Ship it well", status: "active" });
	});

	test("does not ask before marking an achieved goal", async () => {
		const { tool } = setup({ plan: true });
		const { ctx, confirms } = fakeCtx();
		await call(tool, { objective: "Ship the parser" }, ctx);
		confirms.length = 0;

		await call(tool, { objective: "Ship the parser", status: "achieved" }, ctx);
		expect(confirms).toEqual([]);
	});

	test("names the todo items still open when the goal is achieved", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx({
			branch: [
				todoResult([
					{ content: "Close the docs", status: "completed" },
					{ content: "Ship the parser", status: "in_progress" },
				]),
			],
		});
		await call(tool, { objective: "Ship the parser" }, ctx);
		const result = await call(tool, { objective: "Ship the parser", status: "achieved" }, ctx);

		expect(result.content[0].text).toContain("1 todo item is still open");
		// The structured payload stays the goal alone.
		expect(result.structuredContent).toEqual({
			goal: { objective: "Ship the parser", status: "achieved" },
			action: "achieve",
		});
	});

	test("says nothing about the list when it is empty or the goal is only set", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx({ branch: [todoResult([{ content: "Done", status: "completed" }])] });
		await call(tool, { objective: "Ship the parser" }, ctx);
		const result = await call(tool, { objective: "Ship the parser", status: "achieved" }, ctx);

		expect(result.content[0].text).toBe("Goal achieved: Ship the parser");
	});

	test("updates the widget on a TUI session", async () => {
		const { tool } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		await call(tool, { objective: "Ship the parser" }, ctx);

		expect(widgetCalls.at(-1)?.key).toBe(WIDGET_KEY);
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("announces a rail change only when a visible goal is set", () => {
		const { pi } = makeFakePi();
		const runtime = createGoalRuntime(pi);
		runtime.setConfig({ achieved: "hide" });
		let announces = 0;
		pi.events.on("my-pi-agent/rails-changed/goal", () => announces++);
		const { ctx } = fakeCtx({ mode: "tui" });

		// Achieved + `hide` removes the rail, so the rails below it need no re-assert.
		runtime.setGoal({ objective: "ship it", status: "achieved" }, ctx);
		expect(announces).toBe(0);

		// A visible (active) goal re-asserts the stack under it.
		runtime.setGoal({ objective: "ship again", status: "active" }, ctx);
		expect(announces).toBe(1);
	});

	test("getGoal returns a copy that cannot mutate the live goal", () => {
		const { runtime } = setup();
		runtime.setGoal({ objective: "ship it", status: "active" });

		const snapshot = runtime.getGoal();
		snapshot!.objective = "mutated";

		expect(runtime.getGoal()).toEqual({ objective: "ship it", status: "active" });
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

	test("rejects an empty achieved objective without clearing the goal", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		await call(tool, { objective: "Keep me" }, ctx);

		const result = await call(tool, { objective: "", status: "achieved" }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("resend the full objective");
		expect(result.details.action).toBe("achieve");
		expect(result.details.goal).toEqual({ objective: "Keep me", status: "active" });
		expect(runtime.getGoal()).toEqual({ objective: "Keep me", status: "active" });
	});

	test("streaming call shows a pending label, not a clear", () => {
		const { tool } = setup();
		const text = tool.renderCall({}, theme, { argsComplete: false }).render(80).join("\n");
		expect(text).toContain("goal → …");
		expect(text).not.toContain("clear");
	});

	test("renderResult sanitizes a rejected call's error text", () => {
		const { tool } = setup();
		const result = { content: [{ type: "text", text: "" }], details: { action: "set", error: "bad\u001b[31mtext" } };
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true })
			.render(80)
			.join("\n");
		expect(text).toContain("bad");
		expect(text).not.toContain("\u001b");
	});

	test("renderResult falls back to the message for a host-rejected call", () => {
		const { tool } = setup();
		const result = {
			content: [{ type: "text", text: 'Validation failed for tool "goal": objective is required' }],
			details: {},
			isError: true,
		};
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true })
			.render(80)
			.join("\n");
		expect(text).toContain("Validation failed for tool");
		expect(text).not.toContain("Cleared the goal");
	});

	test("renderResult states the status without repeating the objective", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const result = await call(tool, { objective: "Ship the parser" }, ctx);
		const lines = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true })
			.render(80);
		expect(lines).toEqual(["", "Goal · active"]);
		expect(lines.join("\n")).not.toContain("Ship the parser");
	});

	test("renderResult reads as done for an achieved goal, at any expansion", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const result = await call(tool, { objective: "Ship the parser", status: "achieved" }, ctx);
		const withOptions = (expanded: boolean) =>
			tool.renderResult(result, { expanded, isPartial: false }, theme, { argsComplete: true }).render(200).join("\n");
		expect(withOptions(false)).toContain("Goal · achieved");
		expect(withOptions(true)).toContain("Goal · achieved");
		expect(withOptions(true)).not.toContain("Ship the parser");
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

	test("the call line names the tool exactly once", () => {
		const { tool } = setup();
		const text = tool.renderCall({ objective: "Ship the parser" }, theme, { argsComplete: true }).render(80).join("\n");
		expect(text).toContain("goal → set: Ship the parser");
		expect(text).not.toContain("goal goal");
	});

	test("reuses the call Text and the result view across renders", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const callComponent = tool.renderCall({ objective: "Ship it" }, theme, {
			argsComplete: true,
			lastComponent: undefined,
		});
		const callAgain = tool.renderCall({ objective: "Ship it more" }, theme, {
			argsComplete: true,
			lastComponent: callComponent,
		});
		expect(callAgain).toBe(callComponent);

		const result = await call(tool, { objective: "Ship it" }, ctx);
		const view = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: undefined });
		const viewAgain = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { lastComponent: view });
		expect(viewAgain).toBe(view);
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
