import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadFetchConfig, loadSearchConfig } from "./config.ts";
import { DEFAULT_FETCH_CONFIG } from "./fetch/config.ts";
import { DEFAULT_SEARCH_CONFIG } from "./search/config.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";

describe("web-access config", () => {
	test("defaults both sections when no file exists", async () => {
		await withAgentDir(() => {
			const config = loadConfig(tempDir("web-access-cwd-"));
			expect(config.search).toEqual(DEFAULT_SEARCH_CONFIG);
			expect(config.fetch).toEqual(DEFAULT_FETCH_CONFIG);
		}, "web-access-global-");
	});

	test("merges global then project per section, project winning", async () => {
		const cwd = tempDir("web-access-cwd-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "web-access.json"),
			JSON.stringify({ search: { maxResults: 5 }, fetch: { maxOutputChars: 5000 } }),
		);

		await withAgentDir((globalDir) => {
			writeFileSync(
				join(globalDir, "web-access.json"),
				JSON.stringify({
					search: { maxResults: 3, language: "zh-CN" },
					fetch: { maxOutputChars: 3000, allowPrivateHosts: true },
				}),
			);
			const config = loadConfig(cwd);
			expect(config.search.maxResults).toBe(5);
			expect(config.search.language).toBe("zh-CN");
			expect(config.fetch.maxOutputChars).toBe(5000);
			expect(config.fetch.allowPrivateHosts).toBe(true);
		}, "web-access-global-");
	});

	test("keeps the sections independent", async () => {
		const cwd = tempDir("web-access-cwd-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		// A fetch key placed in the search section must not leak into either.
		writeFileSync(join(cwd, ".pi", "web-access.json"), JSON.stringify({ search: { allowPrivateHosts: true } }));

		await withAgentDir(() => {
			expect(loadSearchConfig(cwd).maxResults).toBe(DEFAULT_SEARCH_CONFIG.maxResults);
			expect(loadFetchConfig(cwd).allowPrivateHosts).toBe(false);
		}, "web-access-global-");
	});

	test("ignores malformed files", async () => {
		const cwd = tempDir("web-access-cwd-");
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "web-access.json"), "{ not json");
			expect(loadConfig(cwd)).toEqual({ search: DEFAULT_SEARCH_CONFIG, fetch: DEFAULT_FETCH_CONFIG });
		}, "web-access-global-");
	});
});
