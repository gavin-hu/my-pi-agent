/**
 * The plan extension's Pi integration: registration and disablement, the enter and
 * toggle requests from other extensions, session restore and shutdown, the tool-call
 * guard, injected context, and the command.
 *
 * Every hook is driven through the shared fake runtime and context doubles, so
 * the suite proves the wiring rather than the runtime's own state machine.
 */

import { describe, expect, test } from "bun:test";
import planMode, { PLAN_MODE_MARKER } from "./index.ts";
import { PLAN_TOOL } from "./runtime.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { requestPlanMode, requestPlanToggle } from "../../lib/plan-entry.ts";
import { SUBAGENT_READ_ONLY_PARAM } from "../../lib/tool-names.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { otherMessage } from "../../test/helpers/entries.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { emitCollect as emit } from "../../test/helpers/fakes.ts";
import { resultEntry } from "../../test/helpers/fixtures/goal.ts";
import { planCtx, makePlanPi, planModeMessage, stateEntry } from "../../test/helpers/fixtures/plan.ts";

/** A pi instance that has been started with plan mode restored as enabled. */
async function enabledPi() {
	const fakePi = makePlanPi({ active: ["read", "bash", "write", "edit", PLAN_TOOL, "todo", "subagent"] });
	planMode(fakePi.pi);
	const { ctx, statusCalls } = planCtx({ branch: [stateEntry(true)] });
	await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);
	return { fakePi, ctx, statusCalls };
}

describe("plan-mode registration", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "plan" }, () => {
			const { pi, tools, commands, shortcuts, flags, handlers } = makePlanPi();
			planMode(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(shortcuts.size).toBe(0);
			expect(flags.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the tools, the command, and the flag", () => {
		const { pi, tools, commands, shortcuts, flags } = makePlanPi();
		planMode(pi);

		expect(tools.has(PLAN_TOOL)).toBe(true);
		expect(tools.size).toBe(1);
		expect(commands.has("plan")).toBe(true);
		expect(shortcuts.size).toBe(0);
		expect(flags.has("plan")).toBe(true);
	});
});

describe("plan-mode entry requests", () => {
	async function listening() {
		const fakePi = makePlanPi({ active: ["read", "bash", "write", "todo", PLAN_TOOL] });
		planMode(fakePi.pi);
		const start = planCtx({ branch: [] });
		await emit(fakePi.pi, "session_start", { reason: "startup" }, start.ctx);
		return fakePi;
	}

	test("enables plan mode for a caller that already has the user's consent", async () => {
		const fakePi = await listening();
		const caller = planCtx({ mode: "rpc", hasUI: true });

		expect(await requestPlanMode(fakePi.pi, caller.ctx)).toBe(true);

		const entry = fakePi.entries.at(-1)?.data as { enabled: boolean; removed: string[] };
		expect(entry.enabled).toBe(true);
		expect(entry.removed).toContain("write");
		expect(fakePi.activeTools()).not.toContain("write");
		// The caller's context paints the footer, so goal keeps the chip in sync.
		expect(caller.statusCalls.at(-1)?.key).toBe("plan-mode");
	});

	test("reports an already-enabled mode without a second entry", async () => {
		const fakePi = makePlanPi({ active: ["read", "write"] });
		planMode(fakePi.pi);
		await emit(fakePi.pi, "session_start", { reason: "startup" }, planCtx({ branch: [stateEntry(true)] }).ctx);
		const before = fakePi.entries.length;

		expect(await requestPlanMode(fakePi.pi, planCtx().ctx)).toBe(true);
		expect(fakePi.entries.length).toBe(before);
	});

	test("reports false when the plan extension is not loaded", async () => {
		const bare = makePlanPi();
		expect(await requestPlanMode(bare.pi, planCtx().ctx)).toBe(false);
	});

	test("stops answering entry requests after shutdown", async () => {
		const fakePi = await listening();
		await emit(fakePi.pi, "session_shutdown", {}, planCtx().ctx);

		expect(await requestPlanMode(fakePi.pi, planCtx().ctx)).toBe(false);
	});

	test("toggles for a caller, answering with each state", async () => {
		const fakePi = await listening();
		const caller = planCtx({ mode: "rpc", hasUI: true });

		expect(await requestPlanToggle(fakePi.pi, caller.ctx)).toBe(true);
		expect(fakePi.activeTools()).not.toContain("write");
		expect(caller.notifications.at(-1)).toContain("Plan mode enabled");

		expect(await requestPlanToggle(fakePi.pi, caller.ctx)).toBe(false);
		expect(fakePi.activeTools()).toContain("write");
		expect(caller.notifications.at(-1)).toContain("Plan mode disabled");
	});

	test("reports no answer to a toggle when the plan extension is not loaded", async () => {
		const bare = makePlanPi();
		expect(await requestPlanToggle(bare.pi, planCtx().ctx)).toBeUndefined();
	});

	test("stops answering toggle requests after shutdown", async () => {
		const fakePi = await listening();
		await emit(fakePi.pi, "session_shutdown", {}, planCtx().ctx);

		expect(await requestPlanToggle(fakePi.pi, planCtx().ctx)).toBeUndefined();
	});
});

describe("plan-mode session lifecycle", () => {
	test("restores enabled state and applies gating on session start", async () => {
		const { fakePi, statusCalls } = await enabledPi();

		expect(fakePi.activeTools()).not.toContain("write");
		expect(fakePi.activeTools()).toContain(PLAN_TOOL);
		expect(statusCalls.at(-1)).toEqual({ key: "plan-mode", text: `${GLYPHS.plan} plan` });
	});

	test("starts in plan mode with the --plan flag", async () => {
		const fakePi = makePlanPi({ planFlag: true, active: ["read", "bash", "write", "edit", PLAN_TOOL] });
		planMode(fakePi.pi);
		await emit(fakePi.pi, "session_start", { reason: "startup" }, planCtx().ctx);

		expect(fakePi.activeTools()).not.toContain("edit");
		expect(fakePi.activeTools()).toContain(PLAN_TOOL);
	});

	test("clears the status on shutdown", async () => {
		const fakePi = makePlanPi();
		planMode(fakePi.pi);
		const { ctx, statusCalls } = planCtx();

		await emit(fakePi.pi, "session_shutdown", {}, ctx);

		expect(statusCalls.at(-1)).toEqual({ key: "plan-mode", text: undefined });
	});
});

describe("plan-mode tool guard", () => {
	test("blocks write and edit while enabled", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = planCtx();

		const [write] = await emit(fakePi.pi, "tool_call", { toolName: "write", input: { path: "a" } }, ctx);
		const [edit] = await emit(fakePi.pi, "tool_call", { toolName: "edit", input: {} }, ctx);

		expect(write.block).toBe(true);
		expect(edit.block).toBe(true);
	});

	test("allows only read-only git through the shell while enabled", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = planCtx();

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

	test("accepts a Windows path separator in a read-only git command", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = planCtx();

		const [allowed] = await emit(
			fakePi.pi,
			"tool_call",
			{ toolName: "bash", input: { command: "git diff -- extensions\\plan" } },
			ctx,
		);

		expect(allowed).toBeUndefined();
	});

	test("blocks powershell outright", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = planCtx();

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
			{
				name: "subagent",
				parameters: { type: "object", properties: { [SUBAGENT_READ_ONLY_PARAM]: { type: "boolean" } } },
				sourceInfo: { path: "/pkg/extensions/subagent/index.ts" },
			},
		];
		const { ctx } = planCtx();

		expect(fakePi.activeTools()).toContain("subagent");
		const input = { agent: "explorer", task: "map the module", readOnly: false };
		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "subagent", input }, ctx);

		expect(result).toBeUndefined();
		expect(input.readOnly).toBe(true);
	});

	test("keeps board active so planning can read it, and refuses every other verb", async () => {
		// A session that had the board before it started planning: the filter keeps the
		// tools it may expose, so this is the set the model actually sees.
		const fakePi = makePlanPi({ active: ["read", "board", "write"] });
		planMode(fakePi.pi);
		const { ctx } = planCtx({ branch: [stateEntry(true)] });
		await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);

		// The board is not "another mutating tool": the same tool reads, and the action
		// in the call is what says which. Without this the model is told the tool does
		// not exist, because plan mode removed it from the active set.
		expect(fakePi.activeTools()).toContain("board");

		const [read] = await emit(fakePi.pi, "tool_call", { toolName: "board", input: { action: "list" } }, ctx);
		expect(read).toBeUndefined();

		const [write] = await emit(
			fakePi.pi,
			"tool_call",
			{ toolName: "board", input: { action: "add", title: "x" } },
			ctx,
		);
		expect(write.block).toBe(true);
		expect(write.reason).toContain("`add` changes the board");
		expect(write.reason).toContain("only `list` reads it");
		expect(write.reason).toContain("action `exit`");
	});

	test("refuses a subagent that does not declare readOnly", async () => {
		const { fakePi } = await enabledPi();
		fakePi.pi.allTools = [{ name: "subagent", parameters: { type: "object", properties: {} } }];
		const { ctx } = planCtx();

		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "subagent", input: {} }, ctx);

		expect(result.block).toBe(true);
		expect(result.reason).toContain("read-only delegation");
	});

	test("allows structured readers and the plan tracker", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = planCtx();

		for (const toolName of ["read", "grep", "find", "ls", "read_doc", "todo", "goal"]) {
			const [result] = await emit(fakePi.pi, "tool_call", { toolName, input: {} }, ctx);
			expect(result).toBeUndefined();
		}
	});

	test("allows the plan tool but not a same-named one from elsewhere", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = planCtx();

		const [allowed] = await emit(fakePi.pi, "tool_call", { toolName: PLAN_TOOL, input: {} }, ctx);
		expect(allowed).toBeUndefined();

		// The exemption is identity-checked, so an impostor staying blocked is what keeps
		// plan mode's one sanctioned writer this extension's own.
		fakePi.pi.allTools = [{ name: PLAN_TOOL, sourceInfo: { path: "/other/index.ts" } }];
		const [blocked] = await emit(fakePi.pi, "tool_call", { toolName: PLAN_TOOL, input: {} }, ctx);
		expect(blocked.block).toBe(true);
	});

	test("allows a tool that carries the read-only hint", async () => {
		const { fakePi } = await enabledPi();
		fakePi.pi.allTools = [{ name: "web_search", annotations: { readOnlyHint: true } }];
		const { ctx } = planCtx();

		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "web_search", input: { query: "x" } }, ctx);

		expect(result).toBeUndefined();
	});

	test("blocks a read-only-hinted tool that takes a file path", async () => {
		const { fakePi } = await enabledPi();
		fakePi.pi.allTools = [{ name: "mcp_fs", annotations: { readOnlyHint: true } }];
		const { ctx } = planCtx();

		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "mcp_fs", input: { path: "secrets.txt" } }, ctx);

		expect(result.block).toBe(true);
		expect(result.reason).toContain("takes a file path");
	});

	test("allows a known reader that takes a file path", async () => {
		const { fakePi } = await enabledPi();
		const { ctx } = planCtx();

		for (const toolName of ["read", "read_doc"]) {
			const [result] = await emit(fakePi.pi, "tool_call", { toolName, input: { path: "src/index.ts" } }, ctx);
			expect(result).toBeUndefined();
		}
	});

	test("does not block anything once plan mode is off", async () => {
		const fakePi = makePlanPi({ active: ["read", "bash", "write", "edit", PLAN_TOOL] });
		planMode(fakePi.pi);
		const { ctx } = planCtx();
		await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);

		const [write] = await emit(fakePi.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		const [bash] = await emit(fakePi.pi, "tool_call", { toolName: "bash", input: { command: "rm -rf x" } }, ctx);

		expect(write).toBeUndefined();
		expect(bash).toBeUndefined();
	});
});

describe("plan-mode context injection", () => {
	test("injects the marker before the agent starts while enabled", async () => {
		const { fakePi, ctx } = await enabledPi();
		const [result] = await emit(fakePi.pi, "before_agent_start", {}, ctx);

		expect(result.message.customType).toBe("plan-mode-context");
		expect(result.message.content).toContain(PLAN_MODE_MARKER);
		expect(result.message.content).toContain("action `write`");
		expect(result.message.display).toBe(false);
	});

	test("restates an active session goal while planning", async () => {
		const fakePi = makePlanPi({ active: ["read", "bash", PLAN_TOOL] });
		planMode(fakePi.pi);
		const { ctx } = planCtx({
			branch: [stateEntry(true), resultEntry({ objective: "Add rate limiting", status: "active" })],
		});
		await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(fakePi.pi, "before_agent_start", {}, ctx);

		expect(result.message.content).toContain("- Current session goal: Add rate limiting");
	});

	test("restates a draft goal the plan is being designed against", async () => {
		const fakePi = makePlanPi({ active: ["read", "bash", PLAN_TOOL] });
		planMode(fakePi.pi);
		const { ctx } = planCtx({
			branch: [stateEntry(true), resultEntry({ objective: "Add rate limiting", status: "planning" })],
		});
		await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(fakePi.pi, "before_agent_start", {}, ctx);

		expect(result.message.content).toContain("- Current session goal: Add rate limiting");
	});

	test("does not restate an achieved goal", async () => {
		const fakePi = makePlanPi({ active: ["read", "bash", PLAN_TOOL] });
		planMode(fakePi.pi);
		const { ctx } = planCtx({
			branch: [stateEntry(true), resultEntry({ objective: "done already", status: "achieved" })],
		});
		await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(fakePi.pi, "before_agent_start", {}, ctx);

		expect(result.message.content).not.toContain("Current session goal");
	});

	test("does not inject when disabled", async () => {
		const fakePi = makePlanPi();
		planMode(fakePi.pi);
		const { ctx } = planCtx();

		const [result] = await emit(fakePi.pi, "before_agent_start", {}, ctx);

		expect(result).toBeUndefined();
	});

	test("filters stale plan-mode context when disabled", async () => {
		const fakePi = makePlanPi();
		planMode(fakePi.pi);
		const { ctx } = planCtx();

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

	test("keeps a real user message that quotes the marker", async () => {
		const fakePi = makePlanPi();
		planMode(fakePi.pi);
		const { ctx } = planCtx();
		const quoted = { role: "user", content: "why does [PLAN MODE ACTIVE] show up?" };

		const [result] = await emit(fakePi.pi, "context", { messages: [planModeMessage(), quoted] }, ctx);

		expect(result.messages).toEqual([quoted]);
	});
});

describe("/plan command", () => {
	test("toggles plan mode on and off", async () => {
		const fakePi = makePlanPi({ active: ["read", "bash", "write", "edit", PLAN_TOOL] });
		planMode(fakePi.pi);
		const { ctx, notifications } = planCtx();

		await fakePi.commands.get("plan").handler("", ctx);
		expect(fakePi.activeTools()).not.toContain("write");
		expect(notifications.at(-1)).toContain("Plan mode enabled");

		await fakePi.commands.get("plan").handler("", ctx);
		expect(fakePi.activeTools()).toContain("write");
		expect(notifications.at(-1)).toContain("Plan mode disabled");
	});

	test("/plan <prompt> enters plan mode and sends the prompt", async () => {
		const fakePi = makePlanPi({ active: ["read", "bash", "write", "edit", PLAN_TOOL] });
		planMode(fakePi.pi);
		const { ctx, notifications } = planCtx();

		await fakePi.commands.get("plan").handler("  add a login page  ", ctx);

		expect(fakePi.activeTools()).not.toContain("write");
		expect(fakePi.activeTools()).toContain(PLAN_TOOL);
		expect(notifications.at(-1)).toContain("Plan mode enabled");
		expect(fakePi.sentMessages).toEqual([{ content: "add a login page", options: undefined }]);
	});

	test("/plan <prompt> while already planning only sends the prompt", async () => {
		const fakePi = makePlanPi({ active: ["read", "bash", "write", "edit", PLAN_TOOL] });
		planMode(fakePi.pi);
		const { ctx, notifications } = planCtx();

		await fakePi.commands.get("plan").handler("", ctx);
		const noticesAfterToggle = notifications.length;
		await fakePi.commands.get("plan").handler("refactor auth", ctx);

		expect(fakePi.activeTools()).not.toContain("write");
		expect(notifications).toHaveLength(noticesAfterToggle);
		expect(fakePi.sentMessages).toEqual([{ content: "refactor auth", options: undefined }]);
	});
});
