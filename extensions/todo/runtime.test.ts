import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TODO_CONFIG, loadTodoConfig, normalizeTodoConfig } from "./config.ts";
import todo from "./index.ts";
import { EMPTY_LIST_MUTATIONS } from "./nudge.ts";
import { createTodoRuntime } from "./runtime.ts";
import { currentTodo, hasOpenTodos } from "./state.ts";
import type { Todo } from "./types.ts";
import { emit, makeFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { lastWidget } from "../../test/helpers/entries.ts";
import { resultEntry } from "../../test/helpers/fixtures/todo.ts";
import { tempDir, useEnv, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";

const pending = (content: string): Todo => ({ content, status: "pending" });
const completed = (content: string): Todo => ({ content, status: "completed" });
const active = (content: string): Todo => ({ content, status: "in_progress" });

/** What `reconstruct` reads: the mode, and the branch it rebuilds the list from. */
function printCtx(): ExtensionContext {
	return { mode: "print", sessionManager: { getBranch: () => [] } } as unknown as ExtensionContext;
}

describe("query helpers", () => {
	const todos = [completed("a"), active("b"), pending("c")];

	test("hasOpenTodos is true while anything is unfinished", () => {
		expect(hasOpenTodos(todos)).toBe(true);
		expect(hasOpenTodos([completed("a")])).toBe(false);
		expect(hasOpenTodos([])).toBe(false);
	});

	test("currentTodo prefers in_progress, then the first pending", () => {
		expect(currentTodo(todos)).toEqual(active("b"));
		expect(currentTodo([completed("a"), pending("c"), pending("d")])).toEqual(pending("c"));
		expect(currentTodo([completed("a")])).toBeUndefined();
	});
});

describe("TodoRuntime change notifications", () => {
	test("notifies subscribers when the list is set", () => {
		const runtime = createTodoRuntime();
		const seen: Todo[][] = [];
		runtime.onChange(() => seen.push(runtime.getTodos()));

		runtime.setTodos([pending("one")]);
		expect(seen).toEqual([[pending("one")]]);
	});

	test("notifies on reconstruct", () => {
		const runtime = createTodoRuntime();
		let calls = 0;
		runtime.onChange(() => calls++);
		runtime.reconstruct(printCtx());
		expect(calls).toBe(1);
	});

	test("an unsubscribe stops delivery", () => {
		const runtime = createTodoRuntime();
		let calls = 0;
		const unsubscribe = runtime.onChange(() => calls++);
		runtime.setTodos([pending("one")]);
		unsubscribe();
		runtime.setTodos([pending("two")]);
		expect(calls).toBe(1);
	});

	test("every listener fires", () => {
		const runtime = createTodoRuntime();
		let first = 0;
		let second = 0;
		runtime.onChange(() => first++);
		const off = runtime.onChange(() => second++);
		runtime.setTodos([pending("one")]);
		expect([first, second]).toEqual([1, 1]);
		off();
	});
});

describe("TodoRuntime lag tracking", () => {
	test("a reminder is due after work on an open list, once", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([pending("one")]);
		runtime.noteWork();

		expect(runtime.nudgeDue()).toBe(true);
		runtime.markNudged();
		expect(runtime.nudgeDue()).toBe(false);
		expect(runtime.isNudgeActive()).toBe(true);
	});

	test("a todo update clears the lag but does not re-arm the reminder", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([pending("one")]);
		runtime.noteWork();
		runtime.markNudged();

		runtime.setTodos([pending("one"), pending("two")]);
		expect(runtime.nudgeDue()).toBe(false);

		runtime.noteWork();
		expect(runtime.nudgeDue()).toBe(false);

		runtime.resetNudge();
		runtime.noteWork();
		expect(runtime.nudgeDue()).toBe(true);
	});

	test("no reminder is due for a fully completed list", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([completed("done")]);
		runtime.noteWork();
		expect(runtime.nudgeDue()).toBe(false);
	});

	test("an untouched empty list needs repeated work that wrote something", () => {
		const shellOnly = createTodoRuntime();
		for (let i = 0; i < EMPTY_LIST_MUTATIONS; i++) shellOnly.noteWork();
		expect(shellOnly.nudgeDue()).toBe(false);

		const runtime = createTodoRuntime();
		for (let i = 1; i < EMPTY_LIST_MUTATIONS; i++) {
			runtime.noteWork();
			expect(runtime.nudgeDue()).toBe(false);
		}
		runtime.noteWork(true);
		expect(runtime.nudgeDue()).toBe(true);

		const cleared = createTodoRuntime();
		cleared.setTodos([]);
		for (let i = 0; i < EMPTY_LIST_MUTATIONS; i++) cleared.noteWork(true);
		expect(cleared.nudgeDue()).toBe(false);
	});

	test("resetNudge clears the window but leaves the reminder active", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([pending("one")]);
		runtime.noteWork();
		runtime.markNudged();

		runtime.resetNudge();
		expect(runtime.nudgeDue()).toBe(false);

		runtime.noteWork();
		expect(runtime.nudgeDue()).toBe(true);
		expect(runtime.isNudgeActive()).toBe(true);
	});

	test("deactivateNudge expires the reminder", () => {
		const runtime = createTodoRuntime();
		runtime.markNudged();
		runtime.deactivateNudge();
		expect(runtime.isNudgeActive()).toBe(false);
	});

	test("reconstruct clears the lag and the reminder", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([pending("one")]);
		runtime.noteWork();
		runtime.markNudged();

		runtime.reconstruct(printCtx());
		expect(runtime.nudgeDue()).toBe(false);
		expect(runtime.isNudgeActive()).toBe(false);
	});
});

describe("config", () => {
	test("only a boolean toggles hideWhenComplete", () => {
		expect(normalizeTodoConfig({ hideWhenComplete: false }, DEFAULT_TODO_CONFIG).hideWhenComplete).toBe(false);
		expect(
			normalizeTodoConfig({ hideWhenComplete: "no" as unknown as boolean }, DEFAULT_TODO_CONFIG).hideWhenComplete,
		).toBe(DEFAULT_TODO_CONFIG.hideWhenComplete);
	});

	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadTodoConfig(tempDir("todo-repo-"))).toEqual(DEFAULT_TODO_CONFIG);
		}, "todo-global-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = tempDir("todo-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ todo: { hideWhenComplete: true } }));

		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), JSON.stringify({ todo: { hideWhenComplete: false } }));
			expect(loadTodoConfig(repo).hideWhenComplete).toBe(true);
		}, "todo-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
			expect(loadTodoConfig(tempDir("todo-repo-"))).toEqual(DEFAULT_TODO_CONFIG);
		}, "todo-global-");
	});
});

describe("extension lifecycle", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "todo" }, () => {
			const { pi, tools, commands, handlers } = makeFakePi();
			todo(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
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

		expect(notifications.at(-1)).toContain("1. ◌ two");
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
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ todo: { hideWhenComplete: false } }));
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

describe("todo rail ordering", () => {
	async function started() {
		const { pi } = makeFakePi();
		todo(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: [resultEntry([pending("one")])] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		return { pi, widgetCalls };
	}

	test("re-asserts the widget when a rail above it changes", async () => {
		const { pi, widgetCalls } = await started();
		const before = widgetCalls.length;

		pi.events.emit("my-pi-agent/rails-changed/goal", undefined);

		expect(widgetCalls.length).toBeGreaterThan(before);
		expect(widgetCalls.at(-1)?.key).toBe("todo-widget");
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("hides while a dock screen is open and restores on close", async () => {
		const { pi, widgetCalls } = await started();

		pi.events.emit("my-pi-agent/rails-screen", true);
		expect(widgetCalls.at(-1)).toEqual({ key: "todo-widget", content: undefined });

		pi.events.emit("my-pi-agent/rails-screen", false);
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});
});
