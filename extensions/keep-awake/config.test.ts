import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "./config.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";

describe("normalizeConfig", () => {
	test("defaults to auto and does not keep the display awake", () => {
		expect(DEFAULT_CONFIG).toEqual({ mode: "auto", keepDisplay: false });
	});

	test("returns the base for missing input", () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
	});

	test("accepts auto/always and falls back on unknown modes", () => {
		expect(normalizeConfig({ mode: "always" }, DEFAULT_CONFIG).mode).toBe("always");
		expect(normalizeConfig({ mode: "AUTO" }, DEFAULT_CONFIG).mode).toBe("auto");
		for (const bad of ["session", "off", "nope", 7]) {
			expect(normalizeConfig({ mode: bad }, DEFAULT_CONFIG).mode).toBe("auto");
		}
	});

	test("accepts a boolean keepDisplay and ignores other types", () => {
		expect(normalizeConfig({ keepDisplay: true }, DEFAULT_CONFIG).keepDisplay).toBe(true);
		expect(normalizeConfig({ keepDisplay: false }, DEFAULT_CONFIG).keepDisplay).toBe(false);
		expect(normalizeConfig({ keepDisplay: "yes" }, DEFAULT_CONFIG).keepDisplay).toBe(false);
	});
});

describe("loadConfig", () => {
	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadConfig(tempDir("keep-awake-repo-"))).toEqual(DEFAULT_CONFIG);
		}, "keep-awake-global-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = tempDir("keep-awake-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "keep-awake.json"), JSON.stringify({ mode: "always" }));

		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "keep-awake.json"), JSON.stringify({ mode: "auto", keepDisplay: true }));
			const config = loadConfig(repo);
			expect(config.mode).toBe("always");
			expect(config.keepDisplay).toBe(true);
		}, "keep-awake-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "keep-awake.json"), "{ not json");
			expect(loadConfig(tempDir("keep-awake-repo-"))).toEqual(DEFAULT_CONFIG);
		}, "keep-awake-global-");
	});
});
