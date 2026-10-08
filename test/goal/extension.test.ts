import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import goal, { GOAL_CONTEXT_MARKER } from "../../extensions/goal/index.ts";
import { TOOL_NAME } from "../../extensions/goal/tools.ts";
import { WIDGET_KEY } from "../../extensions/goal/tui.ts";
import type { Goal } from "../../extensions/goal/types.ts";
import { emit, fakeCtx, goalContextMessage, lastWidget, makeFakePi, otherMessage, resultEntry } from "./helpers.ts";

const active = (objective: string): Goal => ({ objective, status: "active" });
const achieved = (objective: string): Goal => ({ objective, status: "achieved" });

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("goal extension", () => {
	test("registers the tool and the /goal command", () => {
		const { pi, tools, commands } = makeFakePi();
		goal(pi);
		expect(tools.has(TOOL_NAME)).toBe(true);
		expect(commands.has("goal")).toBe(true);
	});

	test("reconstructs the goal from the branch on session start", async () => {
		const { pi, commands } = makeFakePi();
		goal(pi);
		const { ctx, notifications } = fakeCtx({
			mode: "print",
			branch: [resultEntry(active("first")), resultEntry(achieved("second"))],
		});

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await commands.get("goal").handler("", ctx);

		expect(notifications.at(-1)).toBe("Goal achieved: second");
	});

	test("reconstructs on session_tree", async () => {
		const { pi, commands } = makeFakePi();
		goal(pi);
		const { ctx, notifications } = fakeCtx({ mode: "print", branch: [resultEntry(active("branched"))] });

		await emit(pi, "session_tree", {}, ctx);
		await commands.get("goal").handler("", ctx);

		expect(notifications.at(-1)).toBe("Goal (active): branched");
	});

	test("reconstructs a goal set by the /goal command from a custom entry", async () => {
		const { pi, commands } = makeFakePi();
		goal(pi);
		const { ctx, notifications } = fakeCtx({
			mode: "print",
			branch: [{ type: "custom", customType: "goal", data: { goal: active("from command") } }],
		});

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await commands.get("goal").handler("", ctx);

		expect(notifications.at(-1)).toBe("Goal (active): from command");
	});

	test("sets the widget on session start in interactive mode", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: [resultEntry(active("one"))] });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(widgetCalls.at(-1)?.key).toBe(WIDGET_KEY);
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("does not touch the widget in a non-TUI session", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "print", branch: [resultEntry(active("one"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		expect(widgetCalls).toHaveLength(0);
	});

	test("clears the widget on shutdown", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: [resultEntry(active("one"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await emit(pi, "session_shutdown", {}, ctx);
		expect(widgetCalls.at(-1)).toEqual({ key: WIDGET_KEY, content: undefined });
	});

	test("honors a project config that hides achieved goals", async () => {
		const globalDir = mkdtempSync(join(tmpdir(), "goal-ext-global-"));
		const repo = mkdtempSync(join(tmpdir(), "goal-ext-repo-"));
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "goal.json"), JSON.stringify({ achieved: "hide" }));
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const { pi } = makeFakePi();
		goal(pi);
		const { ctx, widgetCalls } = fakeCtx({
			mode: "tui",
			cwd: repo,
			branch: [resultEntry(achieved("done"))],
		});
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(widgetCalls.at(-1)).toEqual({ key: WIDGET_KEY, content: undefined });
	});
});

describe("goal reminder", () => {
	test("injects the marker before the agent starts while active", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(active("ship it"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(pi, "before_agent_start", {}, ctx);
		expect(result.message.customType).toBe("goal-context");
		expect(result.message.content).toContain(GOAL_CONTEXT_MARKER);
		expect(result.message.content).toContain("ship it");
		expect(result.message.display).toBe(false);
	});

	test("does not inject when the goal is absent or achieved", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(achieved("done"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(pi, "before_agent_start", {}, ctx);
		expect(result).toBeUndefined();
	});

	test("filters stale goal context when the goal is cleared", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx();
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(pi, "context", { messages: [goalContextMessage(), otherMessage()] }, ctx);
		expect(result.messages).toEqual([otherMessage()]);
	});

	test("filters stale goal context once the goal is achieved", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(achieved("done"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(pi, "context", { messages: [goalContextMessage(), otherMessage()] }, ctx);
		expect(result.messages).toEqual([otherMessage()]);
	});

	test("keeps messages while active", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(active("ship it"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const [result] = await emit(pi, "context", { messages: [goalContextMessage()] }, ctx);
		expect(result).toBeUndefined();
	});

	test("keeps only the newest injection while active", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(active("ship it"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const newest = goalContextMessage("newest");
		const [result] = await emit(pi, "context", { messages: [goalContextMessage(), otherMessage(), newest] }, ctx);
		expect(result.messages).toEqual([otherMessage(), newest]);
	});

	test("does not strip a user message that contains the marker", async () => {
		const { pi } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(null)] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const user = { role: "user", content: "Why does my prompt show [SESSION GOAL] at the top?" };
		const [result] = await emit(pi, "context", { messages: [goalContextMessage(), user] }, ctx);
		expect(result.messages).toEqual([user]);
	});
});

describe("/goal command", () => {
	async function started(branch: unknown[] = []) {
		const { pi, commands, entries } = makeFakePi();
		goal(pi);
		const fake = fakeCtx({ mode: "print", branch });
		await emit(pi, "session_start", { reason: "startup" }, fake.ctx);
		return { command: commands.get("goal"), entries, ...fake };
	}

	test("reports when no goal is set", async () => {
		const { command, ctx, notifications } = await started();
		await command.handler("", ctx);
		expect(notifications.at(-1)).toBe("No goal set.");
	});

	test("clearing an unset goal is a no-op with a report", async () => {
		const { command, ctx, notifications, entries } = await started();
		await command.handler("clear", ctx);
		expect(notifications.at(-1)).toBe("No goal set.");
		expect(entries).toHaveLength(0);
	});

	test("sets a goal and persists it as a branch entry", async () => {
		const { command, ctx, notifications, entries } = await started();
		await command.handler("  ship the parser  ", ctx);
		expect(notifications.at(-1)).toBe("Goal set (active): ship the parser");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "ship the parser", status: "active" } },
		});
	});

	test("clears a goal and persists the clear", async () => {
		const { command, ctx, notifications, entries } = await started([resultEntry(active("ship it"))]);
		await command.handler("clear", ctx);
		expect(notifications.at(-1)).toBe("Goal cleared.");
		expect(entries.at(-1)).toEqual({ type: "custom", customType: "goal", data: { goal: null } });
	});

	test("marks a goal done and persists it", async () => {
		const { command, ctx, notifications, entries } = await started([resultEntry(active("ship it"))]);
		await command.handler("done", ctx);
		expect(notifications.at(-1)).toBe("Goal achieved: ship it");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "ship it", status: "achieved" } },
		});
	});

	test("accepts the achieved keyword as a synonym for done", async () => {
		const { command, ctx, notifications, entries } = await started([resultEntry(active("ship it"))]);
		await command.handler("achieved", ctx);
		expect(notifications.at(-1)).toBe("Goal achieved: ship it");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "ship it", status: "achieved" } },
		});
	});

	test("refuses to complete a missing goal", async () => {
		const { command, ctx, notifications } = await started();
		await command.handler("done", ctx);
		expect(notifications.at(-1)).toBe("No goal set.");
	});

	test("rejects an over-long goal", async () => {
		const { command, ctx, notifications } = await started();
		await command.handler("x".repeat(5000), ctx);
		expect(notifications.at(-1)).toContain("Goal not set:");
	});
});
