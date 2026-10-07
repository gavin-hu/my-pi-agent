import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "../../extensions/checkpoint/config.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

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
	test("returns the defaults when no files exist", () => {
		process.env.PI_CODING_AGENT_DIR = tempDir("checkpoint-global-");
		expect(loadConfig(tempDir("checkpoint-repo-"))).toEqual(DEFAULT_CONFIG);
	});

	test("merges global then project, with project winning", () => {
		const globalDir = tempDir("checkpoint-global-");
		const repo = tempDir("checkpoint-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "checkpoint.json"), JSON.stringify({ autoSnapshots: false, max: 5 }));
		writeFileSync(join(repo, ".pi", "checkpoint.json"), JSON.stringify({ max: 9 }));
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const config = loadConfig(repo);
		expect(config.autoSnapshots).toBe(false);
		expect(config.max).toBe(9);
	});

	test("ignores malformed files", () => {
		const globalDir = tempDir("checkpoint-global-");
		const repo = tempDir("checkpoint-repo-");
		writeFileSync(join(globalDir, "checkpoint.json"), "{ not json");
		process.env.PI_CODING_AGENT_DIR = globalDir;
		expect(loadConfig(repo)).toEqual(DEFAULT_CONFIG);
	});
});
