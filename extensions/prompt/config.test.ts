import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_PROMPT_CONFIG, loadPromptConfig, normalizePromptConfig, PROMPT_LIMITS } from "./config.ts";

describe("normalizePromptConfig", () => {
	test("returns the base for missing input", () => {
		expect(normalizePromptConfig(undefined, DEFAULT_PROMPT_CONFIG)).toEqual(DEFAULT_PROMPT_CONFIG);
	});

	test("accepts valid overrides", () => {
		const config = normalizePromptConfig(
			{ enabled: false, maxQuestions: 2, minLength: 40, contextMessages: 5, confirmGoal: false, timeoutMs: 5000 },
			DEFAULT_PROMPT_CONFIG,
		);
		expect(config).toEqual({
			enabled: false,
			maxQuestions: 2,
			minLength: 40,
			contextMessages: 5,
			confirmGoal: false,
			timeoutMs: 5000,
		});
	});

	test("clamps numeric keys to their published bounds", () => {
		const low = normalizePromptConfig(
			{ maxQuestions: 0, minLength: -10, contextMessages: -1, timeoutMs: 1 },
			DEFAULT_PROMPT_CONFIG,
		);
		expect(low.maxQuestions).toBe(PROMPT_LIMITS.maxQuestions.min);
		expect(low.minLength).toBe(PROMPT_LIMITS.minLength.min);
		expect(low.contextMessages).toBe(PROMPT_LIMITS.contextMessages.min);
		expect(low.timeoutMs).toBe(PROMPT_LIMITS.timeoutMs.min);

		const high = normalizePromptConfig(
			{ maxQuestions: 99, minLength: 9999, contextMessages: 99, timeoutMs: 999_999 },
			DEFAULT_PROMPT_CONFIG,
		);
		expect(high.maxQuestions).toBe(PROMPT_LIMITS.maxQuestions.max);
		expect(high.minLength).toBe(PROMPT_LIMITS.minLength.max);
		expect(high.contextMessages).toBe(PROMPT_LIMITS.contextMessages.max);
		expect(high.timeoutMs).toBe(PROMPT_LIMITS.timeoutMs.max);
	});

	test("rounds numeric keys and falls back on non-numbers", () => {
		const config = normalizePromptConfig({ maxQuestions: 2.6, minLength: "nope" }, DEFAULT_PROMPT_CONFIG);
		expect(config.maxQuestions).toBe(3);
		expect(config.minLength).toBe(DEFAULT_PROMPT_CONFIG.minLength);
	});

	test("only a real boolean changes a boolean key", () => {
		const config = normalizePromptConfig({ enabled: "yes", confirmGoal: 1 }, DEFAULT_PROMPT_CONFIG);
		expect(config.enabled).toBe(true);
		expect(config.confirmGoal).toBe(true);
	});
});

describe("loadPromptConfig", () => {
	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadPromptConfig(tempDir("prompt-repo-"))).toEqual(DEFAULT_PROMPT_CONFIG);
		}, "prompt-global-");
	});

	test("merges global then project, with the project winning", async () => {
		const repo = tempDir("prompt-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "prompt.json"), JSON.stringify({ minLength: 50 }));

		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "prompt.json"), JSON.stringify({ minLength: 10, maxQuestions: 4 }));
			const config = loadPromptConfig(repo);
			expect(config.minLength).toBe(50);
			expect(config.maxQuestions).toBe(4);
		}, "prompt-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "prompt.json"), "{ not json");
			expect(loadPromptConfig(tempDir("prompt-repo-"))).toEqual(DEFAULT_PROMPT_CONFIG);
		}, "prompt-global-");
	});
});
