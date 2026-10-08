import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_GOAL_CONFIG,
	loadGoalConfig,
	normalizeGoalConfig,
} from "../../extensions/goal/config.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

const tempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

describe("normalizeGoalConfig", () => {
	test("hides an achieved goal by default", () => {
		expect(DEFAULT_GOAL_CONFIG.achieved).toBe("hide");
	});

	test("returns the base for missing input", () => {
		expect(normalizeGoalConfig(undefined, DEFAULT_GOAL_CONFIG)).toEqual(DEFAULT_GOAL_CONFIG);
	});

	test("accepts each achieved style and rejects unknown ones", () => {
		expect(normalizeGoalConfig({ achieved: "block" }, DEFAULT_GOAL_CONFIG).achieved).toBe("block");
		expect(normalizeGoalConfig({ achieved: "hide" }, DEFAULT_GOAL_CONFIG).achieved).toBe("hide");
		expect(normalizeGoalConfig({ achieved: "nope" }, DEFAULT_GOAL_CONFIG).achieved).toBe(
			DEFAULT_GOAL_CONFIG.achieved,
		);
	});
});

describe("loadGoalConfig", () => {
	test("returns the defaults when no files exist", () => {
		process.env.PI_CODING_AGENT_DIR = tempDir("goal-global-");
		expect(loadGoalConfig(tempDir("goal-repo-"))).toEqual(DEFAULT_GOAL_CONFIG);
	});

	test("merges global then project, with project winning", () => {
		const globalDir = tempDir("goal-global-");
		const repo = tempDir("goal-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "goal.json"), JSON.stringify({ achieved: "block" }));
		writeFileSync(join(repo, ".pi", "goal.json"), JSON.stringify({ achieved: "hide" }));
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const config = loadGoalConfig(repo);
		expect(config.achieved).toBe("hide");
	});

	test("ignores malformed files", () => {
		const globalDir = tempDir("goal-global-");
		writeFileSync(join(globalDir, "goal.json"), "{ not json");
		process.env.PI_CODING_AGENT_DIR = globalDir;
		expect(loadGoalConfig(tempDir("goal-repo-"))).toEqual(DEFAULT_GOAL_CONFIG);
	});
});
