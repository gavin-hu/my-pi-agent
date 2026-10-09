import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import todo, { TODO_NUDGE_CONTEXT_TYPE } from "./index.ts";
import { TODO_NUDGE_MARKER } from "./nudge.ts";
import { TOOL_NAME } from "./tools.ts";
import type { Todo } from "./types.ts";
import { emit, emitFirst, makeFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { lastWidget, otherMessage } from "../../test/helpers/entries.ts";
import { nudgeMessage, resultEntry } from "../../test/helpers/fixtures/todo.ts";
import { useEnv, withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";

const pending = (content: string): Todo => ({ content, status: "pending" });
const completed = (content: string): Todo => ({ content, status: "completed" });

describe("todo extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "todo" }, () => {
			const { pi, tools, commands, handlers } = makeFakePi();
			todo(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the tool and the /todos command", () => {
		const { pi, tools, commands } = makeFakePi();
		todo(pi);
		expect(tools.has(TOOL_NAME)).toBe(true);
		expect(commands.has("todos")).toBe(true);
	});

	test("reconstructs the list from the branch on session start", async () => {
		const { pi, commands } = makeFakePi();
		todo(pi);
		const { ctx, notifications } = fakeCtx({
			mode: "print",
			branch: [resultEntry([pending("one")]), resultEntry([pending("two")])],
		});

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await commands.get("todos").handler("", ctx);

		expect(notifications.at(-1)).toContain("1. ○ two");
		expect(notifications.at(-1)).not.toContain("one");
	});

	test("reconstructs on session_tree", async () => {
		const { pi, commands } = makeFakePi();
		todo(pi);
		const { ctx, notifications } = fakeCtx({ mode: "print", branch: [resultEntry([pending("branched")])] });

		await emit(pi, "session_tree", {}, ctx);
		await commands.get("todos").handler("", ctx);

		expect(notifications.at(-1)).toContain("branched");
	});

	test("sets the widget on session start in interactive mode", async () => {
		const { pi } = makeFakePi();
		todo(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: [resultEntry([pending("one")])] });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(widgetCalls.at(-1)?.key).toBe("todo-widget");
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("does not touch the widget in a non-TUI session", async () => {
		const { pi } = makeFakePi();
		todo(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "print", branch: [resultEntry([pending("one")])] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		expect(widgetCalls).toHaveLength(0);
	});

	test("clears the widget on shutdown", async () => {
		const { pi } = makeFakePi();
		todo(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		await emit(pi, "session_shutdown", {}, ctx);
		expect(widgetCalls.at(-1)).toEqual({ key: "todo-widget", content: undefined });
	});

	test("/todos reports an empty list without a terminal", async () => {
		const { pi, commands } = makeFakePi();
		todo(pi);
		const { ctx, notifications } = fakeCtx({ mode: "print" });
		await commands.get("todos").handler("", ctx);
		expect(notifications.at(-1)).toBe("No todos.");
	});

	test("/todos opens the list screen in interactive mode", async () => {
		const { pi, commands } = makeFakePi();
		todo(pi);
		let opened = 0;
		const { ctx } = fakeCtx({ mode: "tui", branch: [resultEntry([pending("one")])] });
		ctx.ui.custom = async () => {
			opened++;
			return undefined;
		};
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await commands.get("todos").handler("", ctx);
		expect(opened).toBe(1);
	});

	test("keeps the widget for a finished list when hideWhenComplete is false", async () => {
		const globalDir = mkdtempSync(join(tmpdir(), "todo-ext-global-"));
		const repo = mkdtempSync(join(tmpdir(), "todo-ext-repo-"));
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "todo.json"), JSON.stringify({ hideWhenComplete: false }));
		// The preload restores PI_CODING_AGENT_DIR after the test.
		useEnv({ PI_CODING_AGENT_DIR: globalDir });

		const { pi } = makeFakePi();
		todo(pi);
		const { ctx, widgetCalls } = fakeCtx({
			mode: "tui",
			cwd: repo,
			branch: [resultEntry([completed("done")])],
		});
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});
});

describe("todo lag reminder", () => {
	async function started(branch: unknown[] = []) {
		const { pi, handlers } = makeFakePi();
		todo(pi);
		const { ctx } = fakeCtx({ mode: "print", branch });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		return { pi, handlers, ctx };
	}

	const settle = { type: "agent_before_settle", outcome: "completed" } as const;
	const work = { type: "tool_execution_end", toolName: "edit" } as const;

	test("injects one reminder when work happened without a todo update", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", work, ctx);

		const result = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(result.continue).toBe(true);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].type).toBe("custom_message");
		expect(result.entries[0].customType).toBe(TODO_NUDGE_CONTEXT_TYPE);
		expect(result.entries[0].display).toBe(false);
		expect(result.entries[0].content).toContain(TODO_NUDGE_MARKER);
	});

	test("does not remind without work", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		const result = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(result).toBeUndefined();
	});

	test("does not remind for read-only work", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", { type: "tool_execution_end", toolName: "read" }, ctx);
		const result = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(result).toBeUndefined();
	});

	test("does not remind when every item is completed", async () => {
		const { pi, ctx } = await started([resultEntry([completed("done")])]);
		await emit(pi, "tool_execution_end", work, ctx);
		const result = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(result).toBeUndefined();
	});

	test("reminds at most once per user turn", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", work, ctx);
		const first = await emitFirst(pi, "agent_before_settle", settle, ctx);
		const second = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(first.continue).toBe(true);
		expect(second).toBeUndefined();
	});

	test("does not remind for an aborted or failed run", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", work, ctx);
		const result = await emitFirst(pi, "agent_before_settle", { type: "agent_before_settle", outcome: "aborted" }, ctx);
		expect(result).toBeUndefined();
	});

	test("a new user turn clears the lag window and expires the reminder", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		await emit(pi, "tool_execution_end", work, ctx);
		await emitFirst(pi, "agent_before_settle", settle, ctx);
		await emit(pi, "before_agent_start", {}, ctx);
		const result = await emitFirst(pi, "agent_before_settle", settle, ctx);
		expect(result).toBeUndefined();
	});

	test("strips a stale reminder and keeps only the newest while active", async () => {
		const { pi, ctx } = await started([resultEntry([pending("one")])]);
		// No reminder is active yet, so an old one is dropped.
		const stripped = await emitFirst(pi, "context", { messages: [nudgeMessage(), otherMessage()] }, ctx);
		expect(stripped.messages).toEqual([otherMessage()]);

		// After a reminder, the newest is kept and older copies dropped.
		await emit(pi, "tool_execution_end", work, ctx);
		await emitFirst(pi, "agent_before_settle", settle, ctx);
		const newest = nudgeMessage("newest");
		const kept = await emitFirst(pi, "context", { messages: [nudgeMessage(), otherMessage(), newest] }, ctx);
		expect(kept.messages).toEqual([otherMessage(), newest]);
	});
});
