import { describe, expect, test } from "bun:test";
import planMode, { PLAN_MODE_MARKER } from "../../extensions/plan-mode/index.ts";
import { ENTER_TOOL, EXIT_TOOL } from "../../extensions/plan-mode/runtime.ts";
import { emit, fakeCtx, makeFakePi, otherMessage, planModeMessage, stateEntry } from "./helpers.ts";

/** A pi instance that has been started with plan mode restored as enabled. */
async function enabledPi() {
	const fakePi = makeFakePi({ active: ["read", "bash", "write", "edit", ENTER_TOOL, "todo"] });
	planMode(fakePi.pi);
	const { ctx, statusCalls } = fakeCtx({ branch: [stateEntry(true)] });
	await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);
	return { fakePi, ctx, statusCalls };
}

describe("plan-mode wire-up", () => {
	test("registers both tools, the command, the shortcut, and the flag", () => {
		const { pi, tools, commands, shortcuts, flags } = makeFakePi();
		planMode(pi);
		expect(tools.has(ENTER_TOOL)).toBe(true);
		expect(tools.has(EXIT_TOOL)).toBe(true);
		expect(commands.has("plan")).toBe(true);
		expect(shortcuts.size).toBe(1);
		expect(flags.has("plan")).toBe(true);
	});
});

describe("plan-mode session state", () => {
	test("restores enabled state and applies gating on session start", async () => {
		const { fakePi, statusCalls } = await enabledPi();
		expect(fakePi.activeTools()).not.toContain("write");
		expect(fakePi.activeTools()).toContain(EXIT_TOOL);
		expect(statusCalls.at(-1)).toEqual({ key: "plan-mode", text: "⏸ plan" });
	});

	test("starts in plan mode with the --plan flag", async () => {
		const fakePi = makeFakePi({ planFlag: true, active: ["read", "bash", "write", "edit", ENTER_TOOL] });
		planMode(fakePi.pi);
		const { ctx } = fakeCtx();
		await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);
		expect(fakePi.activeTools()).not.toContain("edit");
		expect(fakePi.activeTools()).toContain(EXIT_TOOL);
	});

	test("clears the status on shutdown", async () => {
		const fakePi = makeFakePi();
		planMode(fakePi.pi);
		const { ctx, statusCalls } = fakeCtx();
		await emit(fakePi.pi, "session_shutdown", {}, ctx);
		expect(statusCalls.at(-1)).toEqual({ key: "plan-mode", text: undefined });
	});
});

describe("plan-mode bash and write guard", () => {
	test("blocks write and edit while enabled", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();
		const [write] = await emit(fakePi.pi, "tool_call", { toolName: "write", input: { path: "a" } }, ctx);
		const [edit] = await emit(fakePi.pi, "tool_call", { toolName: "edit", input: {} }, ctx);
		expect(write.block).toBe(true);
		expect(edit.block).toBe(true);
	});

	test("blocks non-read-only bash while enabled", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();
		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "bash", input: { command: "rm -rf x" } }, ctx);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("command blocked");
	});

	test("allows read-only bash while enabled", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();
		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "bash", input: { command: "git status" } }, ctx);
		expect(result).toBeUndefined();
	});

	test("does not block anything once plan mode is off", async () => {
		const fakePi = makeFakePi({ active: ["read", "bash", "write", "edit", ENTER_TOOL] });
		planMode(fakePi.pi);
		const { ctx } = fakeCtx();
		await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);
		const [write] = await emit(fakePi.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		const [bash] = await emit(fakePi.pi, "tool_call", { toolName: "bash", input: { command: "rm -rf x" } }, ctx);
		expect(write).toBeUndefined();
		expect(bash).toBeUndefined();
	});
});

describe("plan-mode context", () => {
	test("injects the marker before the agent starts while enabled", async () => {
		const { fakePi, ctx } = await enabledPi();
		const [result] = await emit(fakePi.pi, "before_agent_start", {}, ctx);
		expect(result.message.customType).toBe("plan-mode-context");
		expect(result.message.content).toContain(PLAN_MODE_MARKER);
		expect(result.message.display).toBe(false);
	});

	test("does not inject when disabled", async () => {
		const fakePi = makeFakePi();
		planMode(fakePi.pi);
		const { ctx } = fakeCtx();
		const [result] = await emit(fakePi.pi, "before_agent_start", {}, ctx);
		expect(result).toBeUndefined();
	});

	test("filters stale plan-mode context when disabled", async () => {
		const fakePi = makeFakePi();
		planMode(fakePi.pi);
		const { ctx } = fakeCtx();
		const [result] = await emit(fakePi.pi, "context", { messages: [planModeMessage(), otherMessage()] }, ctx);
		expect(result.messages).toEqual([otherMessage()]);
	});

	test("keeps messages while enabled", async () => {
		const { fakePi, ctx } = await enabledPi();
		const [result] = await emit(fakePi.pi, "context", { messages: [planModeMessage()] }, ctx);
		expect(result).toBeUndefined();
	});
});

describe("/plan command", () => {
	test("toggles plan mode and notifies", async () => {
		const fakePi = makeFakePi({ active: ["read", "bash", "write", "edit", ENTER_TOOL] });
		planMode(fakePi.pi);
		const { ctx, notifications } = fakeCtx();

		await fakePi.commands.get("plan").handler("", ctx);
		expect(fakePi.activeTools()).not.toContain("write");
		expect(notifications.at(-1)).toContain("Plan mode enabled");

		await fakePi.commands.get("plan").handler("", ctx);
		expect(fakePi.activeTools()).toContain("write");
		expect(notifications.at(-1)).toContain("Plan mode disabled");
	});

	test("/plan <prompt> enters plan mode and sends the prompt", async () => {
		const fakePi = makeFakePi({ active: ["read", "bash", "write", "edit", ENTER_TOOL] });
		planMode(fakePi.pi);
		const { ctx, notifications } = fakeCtx();

		await fakePi.commands.get("plan").handler("  add a login page  ", ctx);

		expect(fakePi.activeTools()).not.toContain("write");
		expect(fakePi.activeTools()).toContain(EXIT_TOOL);
		expect(notifications.at(-1)).toContain("Plan mode enabled");
		expect(fakePi.sentMessages).toEqual([{ content: "add a login page", options: undefined }]);
	});

	test("/plan <prompt> while already planning only sends the prompt", async () => {
		const fakePi = makeFakePi({ active: ["read", "bash", "write", "edit", ENTER_TOOL] });
		planMode(fakePi.pi);
		const { ctx, notifications } = fakeCtx();

		await fakePi.commands.get("plan").handler("", ctx);
		const noticesAfterToggle = notifications.length;
		await fakePi.commands.get("plan").handler("refactor auth", ctx);

		expect(fakePi.activeTools()).not.toContain("write");
		expect(notifications).toHaveLength(noticesAfterToggle);
		expect(fakePi.sentMessages).toEqual([{ content: "refactor auth", options: undefined }]);
	});
});
