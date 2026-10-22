import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "./config.ts";

describe("plan config", () => {
	test("takes a boolean offer and keeps the default for anything else", () => {
		expect(normalizeConfig({ goalPrompt: false }, DEFAULT_CONFIG).goalPrompt).toBe(false);
		expect(normalizeConfig({ goalPrompt: true }, DEFAULT_CONFIG).goalPrompt).toBe(true);
		expect(normalizeConfig({ goalPrompt: "no" }, DEFAULT_CONFIG).goalPrompt).toBe(true);
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
	});

	test("returns the defaults when no config file exists", async () => {
		await withAgentDir(() => {
			expect(loadConfig(tempDir("plan-repo-"))).toEqual(DEFAULT_CONFIG);
		}, "plan-global-");
	});

	test("merges the global then the project document, project winning", async () => {
		const repo = tempDir("plan-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ plan: { goalPrompt: false } }));

		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), JSON.stringify({ plan: { goalPrompt: true } }));
			expect(loadConfig(repo).goalPrompt).toBe(false);
		}, "plan-global-");
	});

	test("ignores a malformed document", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
			expect(loadConfig(tempDir("plan-repo-"))).toEqual(DEFAULT_CONFIG);
		}, "plan-global-");
	});
});
