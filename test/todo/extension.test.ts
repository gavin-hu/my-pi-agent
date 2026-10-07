import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import todo from "../../extensions/todo/index.ts";
import { TOOL_NAME } from "../../extensions/todo/tools.ts";
import type { Todo } from "../../extensions/todo/types.ts";
import { emit, fakeCtx, lastWidget, makeFakePi, resultEntry } from "./helpers.ts";

const pending = (content: string): Todo => ({ content, status: "pending" });
const completed = (content: string): Todo => ({ content, status: "completed" });

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("todo extension", () => {
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

		expect(notifications.at(-1)).toContain("1. [ ] two");
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
		process.env.PI_CODING_AGENT_DIR = globalDir;

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
