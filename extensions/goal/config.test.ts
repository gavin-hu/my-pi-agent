import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_GOAL_CONFIG, loadGoalConfig, normalizeGoalConfig } from "./config.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";

describe("normalizeGoalConfig", () => {
	test("hides an achieved goal by default", () => {
		expect(DEFAULT_GOAL_CONFIG.achieved).toBe("hide");
	});

	test("returns the base for missing input", () => {
		expect(normalizeGoalConfig(undefined, DEFAULT_GOAL_CONFIG)).toEqual(DEFAULT_GOAL_CONFIG);
	});

	test("accepts show/hide and falls back on retired or unknown values", () => {
		expect(normalizeGoalConfig({ achieved: "show" }, DEFAULT_GOAL_CONFIG).achieved).toBe("show");
		expect(normalizeGoalConfig({ achieved: "hide" }, DEFAULT_GOAL_CONFIG).achieved).toBe("hide");
		for (const bad of ["collapse", "block", "nope"]) {
			expect(normalizeGoalConfig({ achieved: bad }, DEFAULT_GOAL_CONFIG).achieved).toBe("hide");
		}
	});
});

describe("loadGoalConfig", () => {
	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadGoalConfig(tempDir("goal-repo-"))).toEqual(DEFAULT_GOAL_CONFIG);
		}, "goal-global-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = tempDir("goal-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "goal.json"), JSON.stringify({ achieved: "hide" }));

		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "goal.json"), JSON.stringify({ achieved: "show" }));
			expect(loadGoalConfig(repo).achieved).toBe("hide");
		}, "goal-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "goal.json"), "{ not json");
			expect(loadGoalConfig(tempDir("goal-repo-"))).toEqual(DEFAULT_GOAL_CONFIG);
		}, "goal-global-");
	});
});
