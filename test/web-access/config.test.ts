import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, loadFetchConfig, loadSearchConfig } from "../../extensions/web-access/config.ts";
import { DEFAULT_FETCH_CONFIG } from "../../extensions/web-access/fetch/config.ts";
import { DEFAULT_SEARCH_CONFIG } from "../../extensions/web-access/search/config.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("web-access config", () => {
	test("defaults both sections when no file exists", () => {
		process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "web-access-global-"));
		const config = loadConfig(mkdtempSync(join(tmpdir(), "web-access-cwd-")));
		expect(config.search).toEqual(DEFAULT_SEARCH_CONFIG);
		expect(config.fetch).toEqual(DEFAULT_FETCH_CONFIG);
	});

	test("merges global then project per section, project winning", () => {
		const globalDir = mkdtempSync(join(tmpdir(), "web-access-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "web-access-cwd-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(globalDir, "web-access.json"),
			JSON.stringify({
				search: { maxResults: 3, wikipediaLang: "zh" },
				fetch: { maxOutputChars: 3000, allowPrivateHosts: true },
			}),
		);
		writeFileSync(
			join(cwd, ".pi", "web-access.json"),
			JSON.stringify({ search: { maxResults: 5 }, fetch: { maxOutputChars: 5000 } }),
		);
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const config = loadConfig(cwd);
		expect(config.search.maxResults).toBe(5);
		expect(config.search.wikipediaLang).toBe("zh");
		expect(config.fetch.maxOutputChars).toBe(5000);
		expect(config.fetch.allowPrivateHosts).toBe(true);
	});

	test("keeps the sections independent", () => {
		const cwd = mkdtempSync(join(tmpdir(), "web-access-cwd-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		// A fetch key placed in the search section must not leak into either.
		writeFileSync(join(cwd, ".pi", "web-access.json"), JSON.stringify({ search: { allowPrivateHosts: true } }));
		process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "web-access-global-"));

		expect(loadSearchConfig(cwd).maxResults).toBe(DEFAULT_SEARCH_CONFIG.maxResults);
		expect(loadFetchConfig(cwd).allowPrivateHosts).toBe(false);
	});

	test("ignores malformed files", () => {
		const globalDir = mkdtempSync(join(tmpdir(), "web-access-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "web-access-cwd-"));
		writeFileSync(join(globalDir, "web-access.json"), "{ not json");
		process.env.PI_CODING_AGENT_DIR = globalDir;

		expect(loadConfig(cwd)).toEqual({ search: DEFAULT_SEARCH_CONFIG, fetch: DEFAULT_FETCH_CONFIG });
	});
});
