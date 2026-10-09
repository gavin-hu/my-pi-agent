import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "./config.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";

describe("normalizeConfig", () => {
	test("keeps the base for a non-boolean autoSnapshots and out-of-range max", () => {
		expect(normalizeConfig({ autoSnapshots: "sometimes", max: 99999 }, DEFAULT_CONFIG)).toEqual({
			...DEFAULT_CONFIG,
			max: 1000,
		});
	});

	test("accepts a boolean autoSnapshots and clamps max", () => {
		expect(normalizeConfig({ autoSnapshots: false }, DEFAULT_CONFIG).autoSnapshots).toBe(false);
		expect(normalizeConfig({ autoSnapshots: true }, DEFAULT_CONFIG).autoSnapshots).toBe(true);
		expect(normalizeConfig({ max: -5 }, DEFAULT_CONFIG).max).toBe(0);
	});

	test("filters non-string list entries and trims the namespace", () => {
		const config = normalizeConfig({ watch: ["bash", 3, "  "], refNamespace: "refs/x//" }, DEFAULT_CONFIG);
		expect(config.watch).toEqual(["bash"]);
		expect(config.refNamespace).toBe("refs/x");
	});
});

describe("loadConfig", () => {
	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadConfig(tempDir("rewind-repo-"))).toEqual(DEFAULT_CONFIG);
		}, "rewind-global-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = tempDir("rewind-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "rewind.json"), JSON.stringify({ max: 9 }));

		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "rewind.json"), JSON.stringify({ autoSnapshots: false, max: 5 }));
			const config = loadConfig(repo);
			expect(config.autoSnapshots).toBe(false);
			expect(config.max).toBe(9);
		}, "rewind-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "rewind.json"), "{ not json");
			expect(loadConfig(tempDir("rewind-repo-"))).toEqual(DEFAULT_CONFIG);
		}, "rewind-global-");
	});
});
