import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import goal, { GOAL_CONTEXT_MARKER } from "./index.ts";
import { GOAL_HELP } from "./format.ts";
import { TOOL_NAME } from "./tools.ts";
import { WIDGET_KEY } from "./tui.ts";
import type { Goal } from "./types.ts";
import { emitCollect as emit, makeFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx, type FakeCtxOptions } from "../../test/helpers/context.ts";
import { clarifyRegistry, clarifyReply, goalContextMessage, resultEntry } from "../../test/helpers/fixtures/goal.ts";
import { lastWidget, otherMessage } from "../../test/helpers/entries.ts";
import { useEnv, withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";

const active = (objective: string): Goal => ({ objective, status: "active" });
const achieved = (objective: string): Goal => ({ objective, status: "achieved" });

describe("goal extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "goal" }, () => {
			const { pi, tools, commands, handlers } = makeFakePi();
			goal(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the tool and the /goal command", () => {
		const { pi, tools, commands } = makeFakePi();
		goal(pi);
		expect(tools.has(TOOL_NAME)).toBe(true);
		expect(commands.has("goal")).toBe(true);
	});

	test("completes the goal keywords but leaves a free-form prompt alone", () => {
		const { pi, commands } = makeFakePi();
		goal(pi);
		const complete = (prefix: string): string[] =>
			(commands.get("goal").getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);
		expect(complete("")).toEqual(["set", "edit", "raw", "clear", "done", "help"]);
		expect(complete("e")).toEqual(["edit"]);
		expect(complete("fix the bug")).toEqual([]);
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
		// The preload restores PI_CODING_AGENT_DIR after the test.
		useEnv({ PI_CODING_AGENT_DIR: globalDir });

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
	async function started(branch: unknown[] = [], ctxOptions: Partial<FakeCtxOptions> = {}) {
		const fakePi = makeFakePi();
		goal(fakePi.pi);
		const fake = fakeCtx({ mode: "print", branch, ...ctxOptions });
		await emit(fakePi.pi, "session_start", { reason: "startup" }, fake.ctx);
		return {
			command: fakePi.commands.get("goal"),
			entries: fakePi.entries,
			sentMessages: fakePi.sentMessages,
			...fake,
		};
	}

	test("shows usage when no goal is set", async () => {
		const { command, ctx, notifications } = await started();
		await command.handler("", ctx);
		expect(notifications.at(-1)).toBe(GOAL_HELP);
	});

	test("shows the goal, not usage, when one is set", async () => {
		const { command, ctx, notifications } = await started([resultEntry(active("ship it"))]);
		await command.handler("", ctx);
		expect(notifications.at(-1)).toBe("Goal (active): ship it");
	});

	test("shows usage for /goal help with or without a goal", async () => {
		const none = await started();
		await none.command.handler("help", none.ctx);
		expect(none.notifications.at(-1)).toBe(GOAL_HELP);

		const some = await started([resultEntry(active("ship it"))]);
		await some.command.handler("--help", some.ctx);
		expect(some.notifications.at(-1)).toBe(GOAL_HELP);
	});

	test("clearing an unset goal is a no-op with a report", async () => {
		const { command, ctx, notifications, entries } = await started();
		await command.handler("clear", ctx);
		expect(notifications.at(-1)).toBe("No goal set.");
		expect(entries).toHaveLength(0);
	});

	test("sets a goal, persists it, and starts the run", async () => {
		const { command, ctx, notifications, entries, sentMessages } = await started();
		await command.handler("  ship the parser  ", ctx);
		expect(notifications.at(-1)).toBe("Goal set (active): ship the parser");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "ship the parser", status: "active" } },
		});
		expect(sentMessages.at(-1)).toEqual({ content: "ship the parser", options: undefined });
	});

	test("confirms before replacing an active goal", async () => {
		const { command, ctx, entries, sentMessages, notifications } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			confirm: false,
		});

		await command.handler("ship the parser", ctx);

		expect(notifications.at(-1)).toBe("Goal unchanged.");
		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
	});

	test("replaces the active goal when the confirmation is accepted", async () => {
		const { command, ctx, entries, sentMessages } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			confirm: true,
		});

		await command.handler("ship the parser", ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "active" } });
		expect(sentMessages).toHaveLength(1);
	});

	test("does not guard the bare record-only edit", async () => {
		const { command, ctx, editorCalls } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			editor: "new goal",
		});

		await command.handler("edit", ctx);

		expect(editorCalls[0].prefill).toBe("old goal");
	});

	test("does not guard an explicit record-only set with text", async () => {
		const { command, ctx, entries, notifications } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			confirm: undefined,
		});

		await command.handler("set ship the parser", ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "active" } });
		expect(notifications.at(-1)).toBe("Goal set (active): ship the parser");
	});

	test("records a goal without starting a run with /goal set", async () => {
		const { command, ctx, notifications, entries, sentMessages } = await started();
		await command.handler("set ship the parser", ctx);
		expect(notifications.at(-1)).toBe("Goal set (active): ship the parser");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "ship the parser", status: "active" } },
		});
		expect(sentMessages).toHaveLength(0);
	});

	test("/goal edit <text> records the text without starting a run", async () => {
		const { command, ctx, entries, sentMessages } = await started();
		await command.handler("edit ship the parser", ctx);
		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "active" } });
		expect(sentMessages).toHaveLength(0);
	});

	test("/goal raw <text> records and runs without comprehension", async () => {
		const { calls, registry } = clarifyRegistry(["ignored"]);
		const { command, ctx, entries, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: "ignored",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("raw ship the parser", ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "ship the parser", status: "active" } });
		expect(sentMessages.at(-1)).toEqual({ content: "ship the parser", options: undefined });
		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
	});

	test("/goal raw without text shows the usage", async () => {
		const { command, ctx, notifications, entries, sentMessages } = await started();
		await command.handler("raw", ctx);
		expect(notifications.at(-1)).toBe(GOAL_HELP);
		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
	});

	test("records without running when /goal set clarifies through the editor", async () => {
		const { registry } = clarifyRegistry(["Refactor the parser"]);
		const { command, ctx, entries, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: "Refactor the parser to stream input",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("set refactor the parser", ctx);

		expect(editorCalls[0].prefill).toBe("Refactor the parser");
		expect(entries.at(-1)?.data).toEqual({
			goal: { objective: "Refactor the parser to stream input", status: "active" },
		});
		expect(sentMessages).toHaveLength(0);
	});

	test("a bare /goal set prefills the current goal and saves without running", async () => {
		const { command, ctx, entries, sentMessages, editorCalls } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			editor: "new goal",
		});

		await command.handler("set", ctx);

		expect(editorCalls[0].prefill).toBe("old goal");
		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "new goal", status: "active" } });
		expect(sentMessages).toHaveLength(0);
	});

	test("/goal edit opens the current goal and saves without running", async () => {
		const { command, ctx, entries, sentMessages, editorCalls } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			editor: "old goal, with tests",
		});

		await command.handler("edit", ctx);

		expect(editorCalls[0].prefill).toBe("old goal");
		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "old goal, with tests", status: "active" } });
		expect(sentMessages).toHaveLength(0);
	});

	test("cancels a bare /goal set when the editor is dismissed", async () => {
		const { command, ctx, entries, sentMessages, notifications } = await started([resultEntry(active("old goal"))], {
			mode: "rpc",
			hasUI: true,
			editor: undefined,
		});

		await command.handler("set", ctx);

		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
		expect(notifications).toHaveLength(0);
	});

	test("shows usage for a bare /goal set without a UI", async () => {
		const { command, ctx, notifications } = await started();
		await command.handler("set", ctx);
		expect(notifications.at(-1)).toContain("/goal set");
	});

	test("asks the model's questions in-command and records the refined goal", async () => {
		const { calls, registry } = clarifyRegistry([clarifyReply(), "Add parser tests for the new parser"]);
		const { command, ctx, entries, sentMessages, editorCalls, selects } = await started([], {
			mode: "rpc",
			hasUI: true,
			select: "The new one",
			editor: "Add parser tests for the new parser, in CI",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("add tests to the parser", ctx);

		expect(calls).toHaveLength(2);
		expect(selects).toEqual([["The new one", "The old one"]]);
		expect(editorCalls[0].prefill).toBe("Add parser tests for the new parser");
		expect(entries.at(-1)?.data).toEqual({
			goal: { objective: "Add parser tests for the new parser, in CI", status: "active" },
		});
		expect(sentMessages.at(-1)).toEqual({ content: "Add parser tests for the new parser, in CI", options: undefined });
	});

	test("cancels an unclear goal when a question dialog is dismissed", async () => {
		const { registry } = clarifyRegistry([clarifyReply()]);
		const { command, ctx, entries, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			select: undefined,
			editor: "ignored",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("add tests to the parser", ctx);

		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
	});

	test("submits the prompt as a follow-up while the agent is busy", async () => {
		const { command, ctx, sentMessages } = await started([], { isIdle: () => false });
		await command.handler("ship the parser", ctx);
		expect(sentMessages.at(-1)).toEqual({ content: "ship the parser", options: { deliverAs: "followUp" } });
	});

	test("does not send a prompt when clearing or completing", async () => {
		const done = await started([resultEntry(active("ship it"))]);
		await done.command.handler("done", done.ctx);
		expect(done.sentMessages).toHaveLength(0);

		const cleared = await started([resultEntry(active("ship it"))]);
		await cleared.command.handler("clear", cleared.ctx);
		expect(cleared.sentMessages).toHaveLength(0);
	});

	test("does not send a prompt when validation fails", async () => {
		const { command, ctx, notifications, entries, sentMessages } = await started();
		await command.handler("x".repeat(5000), ctx);
		expect(notifications.at(-1)).toContain("Goal not set:");
		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
	});

	test("clarifies, prefills the editor, and sends the edited text", async () => {
		const { registry } = clarifyRegistry(["Refactor the parser to stream input"]);
		const { command, ctx, entries, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: "Refactor the parser to stream input, with tests",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("refactor the parser", ctx);

		expect(editorCalls[0].prefill).toBe("Refactor the parser to stream input");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "Refactor the parser to stream input, with tests", status: "active" } },
		});
		expect(sentMessages.at(-1)).toEqual({
			content: "Refactor the parser to stream input, with tests",
			options: undefined,
		});
	});

	test("prefills the editor with the first restatement when the goal is understood", async () => {
		const { registry } = clarifyRegistry(["Add parser tests"]);
		const { command, ctx, entries, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: "Add parser tests, new parser",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("add tests to the parser", ctx);

		expect(editorCalls[0].prefill).toBe("Add parser tests");
		expect(entries.at(-1)).toEqual({
			type: "custom",
			customType: "goal",
			data: { goal: { objective: "Add parser tests, new parser", status: "active" } },
		});
		expect(sentMessages.at(-1)).toEqual({ content: "Add parser tests, new parser", options: undefined });
	});

	test("falls back to the typed text when the clarifier fails", async () => {
		const registry = {
			complete: async () => {
				throw new Error("provider exploded");
			},
		};
		const { command, ctx, sentMessages, editorCalls } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: "refactor the parser",
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("refactor the parser", ctx);

		expect(editorCalls[0].prefill).toBe("refactor the parser");
		expect(sentMessages.at(-1)).toEqual({ content: "refactor the parser", options: undefined });
	});

	test("aborts when the editor is dismissed", async () => {
		const { registry } = clarifyRegistry(["Clarified goal"]);
		const { command, ctx, entries, sentMessages, notifications } = await started([], {
			mode: "rpc",
			hasUI: true,
			editor: undefined,
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("refactor the parser", ctx);

		expect(entries).toHaveLength(0);
		expect(sentMessages).toHaveLength(0);
		expect(notifications).toHaveLength(0);
	});

	test("skips clarify and dialogs without a UI", async () => {
		const { calls, registry } = clarifyRegistry(["Clarified goal"]);
		const { command, ctx, editorCalls, sentMessages } = await started([], {
			extra: { model: { id: "m" }, modelRegistry: registry },
		});

		await command.handler("ship the parser", ctx);

		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
		expect(sentMessages.at(-1)?.content).toBe("ship the parser");
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

	test("marking an already achieved goal done again is a no-op", async () => {
		const { command, ctx, notifications, entries } = await started([resultEntry(achieved("ship it"))]);
		await command.handler("done", ctx);
		expect(notifications.at(-1)).toBe("Goal already achieved: ship it");
		expect(entries).toHaveLength(0);
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
