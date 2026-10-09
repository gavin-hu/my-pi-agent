import { describe, expect, test } from "bun:test";
import planMode, { PLAN_MODE_MARKER } from "./index.ts";
import { ENTER_TOOL, EXIT_TOOL, WRITE_PLAN_TOOL } from "./runtime.ts";
import { SubagentParams } from "../../extensions/subagent/schema.ts";
import { emitCollect as emit } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeCtx, makeFakePi, planModeMessage, stateEntry } from "../../test/helpers/fixtures/plan.ts";
import { otherMessage } from "../../test/helpers/entries.ts";

/** A pi instance that has been started with plan mode restored as enabled. */
async function enabledPi() {
	const fakePi = makeFakePi({ active: ["read", "bash", "write", "edit", ENTER_TOOL, "todo", "subagent"] });
	planMode(fakePi.pi);
	const { ctx, statusCalls } = fakeCtx({ branch: [stateEntry(true)] });
	await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);
	return { fakePi, ctx, statusCalls };
}

describe("plan-mode wire-up", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "plan" }, () => {
			const { pi, tools, commands, shortcuts, flags, handlers } = makeFakePi();
			planMode(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(shortcuts.size).toBe(0);
			expect(flags.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers both tools, the command, the shortcut, and the flag", () => {
		const { pi, tools, commands, shortcuts, flags } = makeFakePi();
		planMode(pi);
		expect(tools.has(ENTER_TOOL)).toBe(true);
		expect(tools.has(EXIT_TOOL)).toBe(true);
		expect(tools.has(WRITE_PLAN_TOOL)).toBe(true);
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
		expect(statusCalls.at(-1)).toEqual({ key: "plan-mode", text: "≡ plan" });
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

	test("allows only read-only git through the shell while enabled", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();
		const [allowed] = await emit(fakePi.pi, "tool_call", { toolName: "bash", input: { command: "git status" } }, ctx);
		expect(allowed).toBeUndefined();
		const [chained] = await emit(
			fakePi.pi,
			"tool_call",
			{ toolName: "bash", input: { command: "git status && git diff --stat" } },
			ctx,
		);
		expect(chained).toBeUndefined();
		for (const command of ["rm -rf x", "git commit -m x", "git status; rm -rf x"]) {
			const [result] = await emit(fakePi.pi, "tool_call", { toolName: "bash", input: { command } }, ctx);
			expect(result.block).toBe(true);
			expect(result.reason).toContain("Plan mode");
		}
		const [cd] = await emit(fakePi.pi, "tool_call", { toolName: "bash", input: { command: "cd /tmp && ls" } }, ctx);
		expect(cd.block).toBe(true);
		expect(cd.reason).toContain("working directory");
		expect(cd.reason).toContain("read, grep, find, and ls");
	});

	test("blocks powershell outright", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();

		// powershell is not in the policy allow list, so it is default-denied as a
		// mutating tool rather than passed to the bash-only git guard.
		const [powershell] = await emit(
			fakePi.pi,
			"tool_call",
			{ toolName: "powershell", input: { command: "Remove-Item -Recurse x" } },
			ctx,
		);

		expect(powershell.block).toBe(true);
		expect(powershell.reason).toContain("Plan mode");
		expect(powershell.reason).toContain("not read-only");
	});

	test("keeps subagent active and forces readOnly on the call", async () => {
		const { fakePi } = await enabledPi();
		fakePi.pi.allTools = [
			{ name: "subagent", parameters: SubagentParams, sourceInfo: { path: "/pkg/extensions/subagent/index.ts" } },
		];
		const { ctx } = fakeCtx();

		expect(fakePi.activeTools()).toContain("subagent");
		const input = { agent: "explorer", task: "map the module", readOnly: false };
		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "subagent", input }, ctx);

		expect(result).toBeUndefined();
		expect(input.readOnly).toBe(true);
	});

	test("refuses a subagent that does not declare readOnly", async () => {
		const { fakePi } = await enabledPi();
		fakePi.pi.allTools = [{ name: "subagent", parameters: { type: "object", properties: {} } }];
		const { ctx } = fakeCtx();

		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "subagent", input: {} }, ctx);

		expect(result.block).toBe(true);
		expect(result.reason).toContain("read-only delegation");
	});

	test("allows structured readers and the plan tracker", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();
		for (const toolName of ["read", "grep", "find", "ls", "todo", "goal"]) {
			const [result] = await emit(fakePi.pi, "tool_call", { toolName, input: {} }, ctx);
			expect(result).toBeUndefined();
		}
	});

	test("allows the plan control tools but not a same-named write from elsewhere", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();
		for (const toolName of [WRITE_PLAN_TOOL, EXIT_TOOL]) {
			const [result] = await emit(fakePi.pi, "tool_call", { toolName, input: {} }, ctx);
			expect(result).toBeUndefined();
		}

		fakePi.pi.allTools = [{ name: WRITE_PLAN_TOOL, sourceInfo: { path: "/other/index.ts" } }];
		const [blocked] = await emit(fakePi.pi, "tool_call", { toolName: WRITE_PLAN_TOOL, input: {} }, ctx);
		expect(blocked.block).toBe(true);
	});

	test("allows a tool that carries the read-only hint", async () => {
		const { fakePi } = await enabledPi();
		fakePi.pi.allTools = [{ name: "web_search", annotations: { readOnlyHint: true } }];
		const { ctx } = fakeCtx();
		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "web_search", input: { query: "x" } }, ctx);
		expect(result).toBeUndefined();
	});

	test("blocks a read-only-hinted tool that takes a file path", async () => {
		const { fakePi } = await enabledPi();
		fakePi.pi.allTools = [{ name: "mcp_fs", annotations: { readOnlyHint: true } }];
		const { ctx } = fakeCtx();
		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "mcp_fs", input: { path: "secrets.txt" } }, ctx);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("takes a file path");
	});

	test("allows a known reader that takes a file path", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();
		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "read", input: { path: "src/index.ts" } }, ctx);
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
		expect(result.message.content).toContain("write_plan");
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

	test("keeps only the newest injection while enabled", async () => {
		const { fakePi, ctx } = await enabledPi();
		const newest = planModeMessage();
		const [result] = await emit(fakePi.pi, "context", { messages: [planModeMessage(), otherMessage(), newest] }, ctx);
		expect(result.messages).toEqual([otherMessage(), newest]);
	});
});

describe("/plan command", () => {
	test("toggles plan mode on and off", async () => {
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

describe("Ctrl+Alt+P shortcut", () => {
	test("toggles plan mode and notifies", () => {
		const fakePi = makeFakePi({ active: ["read", "bash", "write", "edit", ENTER_TOOL] });
		planMode(fakePi.pi);
		const { ctx, notifications } = fakeCtx();
		const shortcut = [...fakePi.shortcuts.values()][0];

		shortcut.handler(ctx);
		expect(fakePi.activeTools()).not.toContain("write");
		expect(notifications.at(-1)).toContain("Plan mode enabled");

		shortcut.handler(ctx);
		expect(fakePi.activeTools()).toContain("write");
		expect(notifications.at(-1)).toContain("Plan mode disabled");
	});
});
