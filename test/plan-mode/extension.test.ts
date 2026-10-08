import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import planMode, { PLAN_MODE_MARKER } from "../../extensions/plan-mode/index.ts";
import { PlanListComponent } from "../../extensions/plan-mode/list-tui.ts";
import { createPlanStore } from "../../extensions/plan-mode/plans.ts";
import { PlanViewComponent } from "../../extensions/plan-mode/tui.ts";
import { ENTER_TOOL, EXIT_TOOL, WRITE_PLAN_TOOL } from "../../extensions/plan-mode/runtime.ts";
import { fakeTheme } from "../helpers/fakes.ts";
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
		expect(tools.has(WRITE_PLAN_TOOL)).toBe(true);
		expect(commands.has("plan")).toBe(true);
		expect(commands.has("plans")).toBe(true);
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

	test("blocks raw shell while enabled, read-only or not", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();
		for (const command of ["git status", "rm -rf x"]) {
			const [result] = await emit(fakePi.pi, "tool_call", { toolName: "bash", input: { command } }, ctx);
			expect(result.block).toBe(true);
			expect(result.reason).toContain("not read-only");
		}
	});

	test("blocks every tool the policy does not consider read-only", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = fakeCtx();

		// powershell is the cross-platform hole: it had no guard because the old
		// handler only inspected `bash` and the write/edit names.
		const [powershell] = await emit(
			fakePi.pi,
			"tool_call",
			{ toolName: "powershell", input: { command: "Remove-Item -Recurse x" } },
			ctx,
		);
		const [subagent] = await emit(fakePi.pi, "tool_call", { toolName: "subagent", input: {} }, ctx);

		expect(powershell.block).toBe(true);
		expect(powershell.reason).toContain("not read-only");
		expect(subagent.block).toBe(true);
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

	test("/plan list points at /plans instead of planning a task", async () => {
		const fakePi = makeFakePi({ active: ["read", "bash", "write", "edit", ENTER_TOOL] });
		planMode(fakePi.pi);
		const { ctx, notifications } = fakeCtx();

		await fakePi.commands.get("plan").handler("list", ctx);

		expect(notifications.at(-1)).toContain("/plans");
		expect(fakePi.sentMessages).toEqual([]);
		expect(fakePi.activeTools()).toContain("write");
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

const FIXED = new Date(2026, 9, 8, 15, 30);

/** A temp repo root plus a pi whose `git rev-parse` reports it and a plan store on top. */
function planRepo() {
	const root = mkdtempSync(join(tmpdir(), "pi-plan-cmd-"));
	const fakePi = makeFakePi({
		active: ["read", "bash", "write", "edit", ENTER_TOOL],
		exec: async (command: string, args: string[]) =>
			command === "git" && args[0] === "rev-parse"
				? { stdout: `${root}\n`, stderr: "", code: 0 }
				: { stdout: "", stderr: "", code: 1 },
	});
	planMode(fakePi.pi);
	return { root, fakePi, store: createPlanStore(fakePi.pi, { now: () => FIXED }) };
}

describe("/plans command", () => {
	test("prints the plans in non-TUI mode and sends no task", async () => {
		const { root, fakePi, store } = planRepo();
		await store.write(root, { title: "Alpha", content: "1. one\n2. two" });
		const { ctx, notifications } = fakeCtx({ cwd: root });

		await fakePi.commands.get("plans").handler("", ctx);

		expect(notifications.at(-1)).toContain("1 plan");
		expect(notifications.at(-1)).toContain("alpha");
		expect(fakePi.sentMessages).toEqual([]);
	});

	test("prints the empty state in non-TUI mode", async () => {
		const { root, fakePi } = planRepo();
		const { ctx, notifications } = fakeCtx({ cwd: root });

		await fakePi.commands.get("plans").handler("", ctx);

		expect(notifications.at(-1)).toContain("No plans yet");
	});

	// The browser shares the dock with the other list screens.
	test("opens the browser in the dock, not as an overlay", async () => {
		const { root, fakePi, store } = planRepo();
		await store.write(root, { title: "Alpha", content: "1. one" });
		const { ctx } = fakeCtx({ cwd: root, mode: "tui" });
		const seen: unknown[] = [];
		ctx.ui.custom = async (_factory: unknown, options: unknown) => {
			seen.push(options);
			return undefined;
		};

		await fakePi.commands.get("plans").handler("", ctx);

		expect(seen).toEqual([undefined]);
	});

	test("the browser's `view` opens the read screen, separate from the browser", async () => {
		const { root, fakePi, store } = planRepo();
		await store.write(root, { title: "Alpha", content: "# Plan\n1. read the parser" });
		const plans = await store.list(root);
		const { ctx } = fakeCtx({ cwd: root, mode: "tui" });
		const components: unknown[] = [];
		const tui = { requestRender: () => {}, terminal: { rows: 24 } };
		ctx.ui.custom = async (factory: any) => {
			components.push(factory(tui, fakeTheme, {}, () => {}));
			return components.length === 1 ? { action: "view", plan: plans[0] } : undefined;
		};

		await fakePi.commands.get("plans").handler("", ctx);

		expect(components[0]).toBeInstanceOf(PlanListComponent);
		expect(components[1]).toBeInstanceOf(PlanViewComponent);
	});

	test("the browser's `d` confirms and removes the file", async () => {
		const { root, fakePi, store } = planRepo();
		const file = await store.write(root, { title: "Bye", content: "1. x" });
		const plans = await store.list(root);
		const { ctx, notifications } = fakeCtx({ cwd: root, mode: "tui", confirm: true });
		let calls = 0;
		ctx.ui.custom = async () => {
			calls += 1;
			return calls === 1 ? { action: "delete", plan: plans[0] } : undefined;
		};

		await fakePi.commands.get("plans").handler("", ctx);

		expect(existsSync(file.path)).toBe(false);
		expect(notifications.at(-1)).toContain("Deleted");
	});

	test("the browser's `d` keeps the file when the confirm is declined", async () => {
		const { root, fakePi, store } = planRepo();
		const file = await store.write(root, { title: "Keep", content: "1. x" });
		const plans = await store.list(root);
		const { ctx } = fakeCtx({ cwd: root, mode: "tui", confirm: false });
		let calls = 0;
		ctx.ui.custom = async () => {
			calls += 1;
			return calls === 1 ? { action: "delete", plan: plans[0] } : undefined;
		};

		await fakePi.commands.get("plans").handler("", ctx);

		expect(existsSync(file.path)).toBe(true);
	});

	test("the browser's `u` hands the plan to the model", async () => {
		const { root, fakePi, store } = planRepo();
		const file = await store.write(root, { title: "Alpha", content: "1. x" });
		const plans = await store.list(root);
		const { ctx } = fakeCtx({ cwd: root, mode: "tui", confirm: true });
		ctx.ui.custom = async () => ({ action: "use", plan: plans[0] });

		await fakePi.commands.get("plans").handler("", ctx);

		expect(fakePi.sentMessages).toHaveLength(1);
		expect(String(fakePi.sentMessages[0].content)).toContain(file.path);
	});
});
