import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TODO_CONFIG, loadTodoConfig, normalizeTodoConfig } from "../../extensions/todo/config.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

const tempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

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
	test("returns the defaults when no files exist", () => {
		process.env.PI_CODING_AGENT_DIR = tempDir("todo-global-");
		expect(loadTodoConfig(tempDir("todo-repo-"))).toEqual(DEFAULT_TODO_CONFIG);
	});

	test("merges global then project, with project winning", () => {
		const globalDir = tempDir("todo-global-");
		const repo = tempDir("todo-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "todo.json"), JSON.stringify({ hideWhenComplete: false }));
		writeFileSync(join(repo, ".pi", "todo.json"), JSON.stringify({ hideWhenComplete: true }));
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const config = loadTodoConfig(repo);
		expect(config.hideWhenComplete).toBe(true);
	});

	test("ignores malformed files", () => {
		const globalDir = tempDir("todo-global-");
		writeFileSync(join(globalDir, "todo.json"), "{ not json");
		process.env.PI_CODING_AGENT_DIR = globalDir;
		expect(loadTodoConfig(tempDir("todo-repo-"))).toEqual(DEFAULT_TODO_CONFIG);
	});
});
