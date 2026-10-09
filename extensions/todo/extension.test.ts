import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import todo from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import type { Todo } from "./types.ts";
import { emit, makeFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { lastWidget } from "../../test/helpers/entries.ts";
import { resultEntry } from "../../test/helpers/fixtures/todo.ts";
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
