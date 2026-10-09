import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TODO_CONFIG, loadTodoConfig, normalizeTodoConfig } from "./config.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";

describe("normalizeTodoConfig", () => {
	test("returns the base for missing input", () => {
		expect(normalizeTodoConfig(undefined, DEFAULT_TODO_CONFIG)).toEqual(DEFAULT_TODO_CONFIG);
	});

	test("only a boolean toggles hideWhenComplete", () => {
		expect(normalizeTodoConfig({ hideWhenComplete: false }, DEFAULT_TODO_CONFIG).hideWhenComplete).toBe(false);
		expect(
			normalizeTodoConfig({ hideWhenComplete: "no" as unknown as boolean }, DEFAULT_TODO_CONFIG).hideWhenComplete,
		).toBe(DEFAULT_TODO_CONFIG.hideWhenComplete);
	});
});

describe("loadTodoConfig", () => {
	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadTodoConfig(tempDir("todo-repo-"))).toEqual(DEFAULT_TODO_CONFIG);
		}, "todo-global-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = tempDir("todo-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "todo.json"), JSON.stringify({ hideWhenComplete: true }));

		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "todo.json"), JSON.stringify({ hideWhenComplete: false }));
			expect(loadTodoConfig(repo).hideWhenComplete).toBe(true);
		}, "todo-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "todo.json"), "{ not json");
			expect(loadTodoConfig(tempDir("todo-repo-"))).toEqual(DEFAULT_TODO_CONFIG);
		}, "todo-global-");
	});
});
