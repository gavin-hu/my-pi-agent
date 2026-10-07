import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, MAX_RESULTS, normalizeConfig } from "../../extensions/web-search/config.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("normalizeConfig", () => {
	test("returns the base config for missing input", () => {
		expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
	});

	test("clamps numeric values into range", () => {
		const config = normalizeConfig({ maxResults: 999, timeoutMs: 5, minIntervalMs: -10, maxOutputChars: 10 });
		expect(config.maxResults).toBe(MAX_RESULTS);
		expect(config.timeoutMs).toBe(1_000);
		expect(config.minIntervalMs).toBe(0);
		expect(config.maxOutputChars).toBe(1_000);
	});

	test("rejects an unknown safe-search value and region, keeping the base", () => {
		const config = normalizeConfig({ safeSearch: "yolo", region: "not a region" });
		expect(config.safeSearch).toBe(DEFAULT_CONFIG.safeSearch);
		expect(config.region).toBe(DEFAULT_CONFIG.region);
	});

	test("accepts a valid region case-insensitively and lowercases it", () => {
		expect(normalizeConfig({ region: "CN-ZH" }).region).toBe("cn-zh");
	});

	test("rejects a non-http endpoint", () => {
		expect(normalizeConfig({ endpoint: "file:///etc/passwd" }).endpoint).toBe(DEFAULT_CONFIG.endpoint);
	});

	test("keeps a custom user agent and treats blank as null", () => {
		expect(normalizeConfig({ userAgent: " my-bot " }).userAgent).toBe("my-bot");
		expect(normalizeConfig({ userAgent: "   " }).userAgent).toBeNull();
	});

	test("uses a custom curl path and falls back to the default when blank", () => {
		expect(normalizeConfig({ curlPath: "/opt/homebrew/bin/curl" }).curlPath).toBe("/opt/homebrew/bin/curl");
		expect(normalizeConfig({ curlPath: "  " }).curlPath).toBe(DEFAULT_CONFIG.curlPath);
	});
});

describe("loadConfig", () => {
	test("merges the global file then the project file, with project winning", () => {
		const globalDir = mkdtempSync(join(tmpdir(), "web-search-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "web-search-project-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "web-search.json"), JSON.stringify({ maxResults: 3, region: "us-en" }));
		writeFileSync(join(cwd, ".pi", "web-search.json"), JSON.stringify({ maxResults: 5 }));
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const config = loadConfig(cwd);
		expect(config.maxResults).toBe(5);
		expect(config.region).toBe("us-en");
	});

	test("ignores malformed files", () => {
		const globalDir = mkdtempSync(join(tmpdir(), "web-search-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "web-search-project-"));
		writeFileSync(join(globalDir, "web-search.json"), "{ not json");
		process.env.PI_CODING_AGENT_DIR = globalDir;

		expect(loadConfig(cwd)).toEqual(DEFAULT_CONFIG);
	});
});
