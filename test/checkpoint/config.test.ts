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
	test("keeps the base for an unknown mode and out-of-range max", () => {
		expect(normalizeConfig({ mode: "sometimes", max: 99999 }, DEFAULT_CONFIG)).toEqual({
			...DEFAULT_CONFIG,
			max: 1000,
		});
	});

	test("accepts each known mode and clamps max", () => {
		expect(normalizeConfig({ mode: "call" }, DEFAULT_CONFIG).mode).toBe("call");
		expect(normalizeConfig({ mode: "off" }, DEFAULT_CONFIG).mode).toBe("off");
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
		writeFileSync(join(globalDir, "checkpoint.json"), JSON.stringify({ mode: "call", max: 5 }));
		writeFileSync(join(repo, ".pi", "checkpoint.json"), JSON.stringify({ mode: "off" }));
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const config = loadConfig(repo);
		expect(config.mode).toBe("off");
		expect(config.max).toBe(5);
	});

	test("ignores malformed files", () => {
		const globalDir = tempDir("checkpoint-global-");
		const repo = tempDir("checkpoint-repo-");
		writeFileSync(join(globalDir, "checkpoint.json"), "{ not json");
		process.env.PI_CODING_AGENT_DIR = globalDir;
		expect(loadConfig(repo)).toEqual(DEFAULT_CONFIG);
	});
});
