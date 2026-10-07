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
		const config = normalizeConfig({ maxResults: 999, timeoutMs: 5, maxBytes: 1, minIntervalMs: -10, maxOutputChars: 10 });
		expect(config.maxResults).toBe(MAX_RESULTS);
		expect(config.timeoutMs).toBe(1_000);
		expect(config.maxBytes).toBe(1_024);
		expect(config.minIntervalMs).toBe(0);
		expect(config.maxOutputChars).toBe(1_000);
	});

	test("accepts a wikipedia language code and rejects nonsense", () => {
		expect(normalizeConfig({ wikipediaLang: "zh" }).wikipediaLang).toBe("zh");
		expect(normalizeConfig({ wikipediaLang: "zh-classical" }).wikipediaLang).toBe("zh-classical");
		expect(normalizeConfig({ wikipediaLang: "not a lang!" }).wikipediaLang).toBe(DEFAULT_CONFIG.wikipediaLang);
	});

	test("rejects non-http endpoints", () => {
		const config = normalizeConfig({ instantAnswerEndpoint: "file:///etc/passwd", wikipediaEndpoint: "nope" });
		expect(config.instantAnswerEndpoint).toBe(DEFAULT_CONFIG.instantAnswerEndpoint);
		expect(config.wikipediaEndpoint).toBe(DEFAULT_CONFIG.wikipediaEndpoint);
	});

	test("keeps a custom user agent and treats blank as the default", () => {
		expect(normalizeConfig({ userAgent: " my-bot " }).userAgent).toBe("my-bot");
		expect(normalizeConfig({ userAgent: "   " }).userAgent).toBe(DEFAULT_CONFIG.userAgent);
	});
});

describe("loadConfig", () => {
	test("merges the global file then the project file, with project winning", () => {
		const globalDir = mkdtempSync(join(tmpdir(), "web-search-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "web-search-project-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "web-search.json"), JSON.stringify({ maxResults: 3, wikipediaLang: "zh" }));
		writeFileSync(join(cwd, ".pi", "web-search.json"), JSON.stringify({ maxResults: 5 }));
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const config = loadConfig(cwd);
		expect(config.maxResults).toBe(5);
		expect(config.wikipediaLang).toBe("zh");
	});

	test("ignores malformed files", () => {
		const globalDir = mkdtempSync(join(tmpdir(), "web-search-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "web-search-project-"));
		writeFileSync(join(globalDir, "web-search.json"), "{ not json");
		process.env.PI_CODING_AGENT_DIR = globalDir;

		expect(loadConfig(cwd)).toEqual(DEFAULT_CONFIG);
	});
});
