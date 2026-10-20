import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SUBAGENT_CONFIG, loadSubagentConfig, normalizeSubagentConfig } from "./config.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";

describe("normalizeSubagentConfig", () => {
	test("returns the base for missing input", () => {
		expect(normalizeSubagentConfig(undefined, DEFAULT_SUBAGENT_CONFIG)).toEqual(DEFAULT_SUBAGENT_CONFIG);
	});

	test("clamps the deadline to its bounds", () => {
		expect(normalizeSubagentConfig({ timeoutMs: 5_000 }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(5_000);
		expect(normalizeSubagentConfig({ timeoutMs: 0 }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(0);
		expect(normalizeSubagentConfig({ timeoutMs: -1 }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(0);
		expect(normalizeSubagentConfig({ timeoutMs: 9_999_999 }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(3_600_000);
		expect(normalizeSubagentConfig({ timeoutMs: "soon" }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(
			DEFAULT_SUBAGENT_CONFIG.timeoutMs,
		);
	});

	test("only a known transcript mode is accepted", () => {
		expect(normalizeSubagentConfig({ transcripts: "failed" }, DEFAULT_SUBAGENT_CONFIG).transcripts).toBe("failed");
		expect(normalizeSubagentConfig({ transcripts: "all" }, DEFAULT_SUBAGENT_CONFIG).transcripts).toBe("all");
		expect(
			normalizeSubagentConfig({ transcripts: "everything" as unknown as "all" }, DEFAULT_SUBAGENT_CONFIG).transcripts,
		).toBe(DEFAULT_SUBAGENT_CONFIG.transcripts);
		expect(normalizeSubagentConfig({ transcripts: 1 as unknown as "all" }, DEFAULT_SUBAGENT_CONFIG).transcripts).toBe(
			DEFAULT_SUBAGENT_CONFIG.transcripts,
		);
	});

	test("clamps the background capacity", () => {
		expect(normalizeSubagentConfig({ backgroundMax: 2 }, DEFAULT_SUBAGENT_CONFIG).backgroundMax).toBe(2);
		expect(normalizeSubagentConfig({ backgroundMax: 0 }, DEFAULT_SUBAGENT_CONFIG).backgroundMax).toBe(1);
		expect(normalizeSubagentConfig({ backgroundMax: 99 }, DEFAULT_SUBAGENT_CONFIG).backgroundMax).toBe(8);
	});

	test("keeps retention usable", () => {
		expect(normalizeSubagentConfig({ retentionDays: 3 }, DEFAULT_SUBAGENT_CONFIG).retentionDays).toBe(3);
		expect(normalizeSubagentConfig({ retentionDays: 0 }, DEFAULT_SUBAGENT_CONFIG).retentionDays).toBe(1);
		expect(normalizeSubagentConfig({ maxRuns: 0 }, DEFAULT_SUBAGENT_CONFIG).maxRuns).toBe(1);
		expect(normalizeSubagentConfig({ maxRuns: 5_000 }, DEFAULT_SUBAGENT_CONFIG).maxRuns).toBe(1_000);
	});
});

describe("loadSubagentConfig", () => {
	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadSubagentConfig(tempDir("subagent-repo-"))).toEqual(DEFAULT_SUBAGENT_CONFIG);
		}, "subagent-global-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = tempDir("subagent-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ subagent: { timeoutMs: 1_000 } }));

		await withAgentDir((globalDir) => {
			writeFileSync(
				join(globalDir, "bytefly.json"),
				JSON.stringify({ subagent: { timeoutMs: 2_000, transcripts: "all" } }),
			);
			const config = loadSubagentConfig(repo);
			expect(config.timeoutMs).toBe(1_000);
			expect(config.transcripts).toBe("all");
		}, "subagent-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
			expect(loadSubagentConfig(tempDir("subagent-repo-"))).toEqual(DEFAULT_SUBAGENT_CONFIG);
		}, "subagent-global-");
	});
});
