import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "../../extensions/web-fetch/config.ts";

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
		const config = normalizeConfig({ timeoutMs: 5, maxBytes: 1, maxOutputChars: 10 });
		expect(config.timeoutMs).toBe(1_000);
		expect(config.maxBytes).toBe(1_024);
		expect(config.maxOutputChars).toBe(500);
	});

	test("only a boolean enables allowPrivateHosts", () => {
		expect(normalizeConfig({ allowPrivateHosts: true }).allowPrivateHosts).toBe(true);
		expect(normalizeConfig({ allowPrivateHosts: "yes" as unknown as boolean }).allowPrivateHosts).toBe(false);
	});

	test("clamps cache settings and defaults cacheEnabled", () => {
		const config = normalizeConfig({
			cacheTtlMs: -5,
			cacheMaxEntries: 0,
			cacheMaxBytes: 1,
			cacheEnabled: "x" as unknown as boolean,
		});
		expect(config.cacheTtlMs).toBe(0);
		expect(config.cacheMaxEntries).toBe(1);
		expect(config.cacheMaxBytes).toBe(1_024);
		expect(config.cacheEnabled).toBe(DEFAULT_CONFIG.cacheEnabled);
	});

	test("keeps a custom user agent and treats blank as the default", () => {
		expect(normalizeConfig({ userAgent: " my-bot " }).userAgent).toBe("my-bot");
		expect(normalizeConfig({ userAgent: "   " }).userAgent).toBe(DEFAULT_CONFIG.userAgent);
	});
});

describe("loadConfig", () => {
	test("merges the global file then the project file, with project winning", () => {
		const globalDir = mkdtempSync(join(tmpdir(), "web-fetch-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "web-fetch-project-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "web-fetch.json"), JSON.stringify({ maxOutputChars: 3000, allowPrivateHosts: true }));
		writeFileSync(join(cwd, ".pi", "web-fetch.json"), JSON.stringify({ maxOutputChars: 5000 }));
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const config = loadConfig(cwd);
		expect(config.maxOutputChars).toBe(5000);
		expect(config.allowPrivateHosts).toBe(true);
	});

	test("ignores malformed files", () => {
		const globalDir = mkdtempSync(join(tmpdir(), "web-fetch-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "web-fetch-project-"));
		writeFileSync(join(globalDir, "web-fetch.json"), "{ not json");
		process.env.PI_CODING_AGENT_DIR = globalDir;

		expect(loadConfig(cwd)).toEqual(DEFAULT_CONFIG);
	});
});
