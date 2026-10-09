import { describe, expect, test } from "bun:test";
import { withEnv } from "../../../test/helpers/env.ts";
import { DEFAULT_SEARCH_CONFIG, MAX_RESULTS, normalizeSearchConfig, resolveSearchApiKey } from "./config.ts";

describe("normalizeSearchConfig", () => {
	test("returns the base config for missing input", () => {
		expect(normalizeSearchConfig(undefined)).toEqual(DEFAULT_SEARCH_CONFIG);
	});

	test("clamps numeric values into range", () => {
		const config = normalizeSearchConfig({
			maxResults: 999,
			timeoutMs: 5,
			maxBytes: 1,
			minIntervalMs: -10,
			maxOutputChars: 10,
			safeSearch: 9,
		});
		expect(config.maxResults).toBe(MAX_RESULTS);
		expect(config.timeoutMs).toBe(1_000);
		expect(config.maxBytes).toBe(1_024);
		expect(config.minIntervalMs).toBe(0);
		expect(config.maxOutputChars).toBe(1_000);
		expect(config.safeSearch).toBe(2);
	});

	test("accepts a language code and rejects nonsense", () => {
		expect(normalizeSearchConfig({ language: "zh-CN" }).language).toBe("zh-CN");
		expect(normalizeSearchConfig({ language: "auto" }).language).toBe("auto");
		expect(normalizeSearchConfig({ language: "not a lang!" }).language).toBe(DEFAULT_SEARCH_CONFIG.language);
	});

	test("keeps a valid endpoint and rejects non-http", () => {
		expect(normalizeSearchConfig({ endpoint: "https://searx.example/" }).endpoint).toBe("https://searx.example/");
		expect(normalizeSearchConfig({ endpoint: "file:///etc/passwd" }).endpoint).toBe("");
	});

	test("allows an explicit empty endpoint to clear an inherited one", () => {
		const base = { ...DEFAULT_SEARCH_CONFIG, endpoint: "https://searx.example" };
		expect(normalizeSearchConfig({ endpoint: "" }, base).endpoint).toBe("");
		expect(normalizeSearchConfig({}, base).endpoint).toBe("https://searx.example");
	});

	test("keeps a custom user agent and treats blank as the default", () => {
		expect(normalizeSearchConfig({ userAgent: " my-bot " }).userAgent).toBe("my-bot");
		expect(normalizeSearchConfig({ userAgent: "   " }).userAgent).toBe(DEFAULT_SEARCH_CONFIG.userAgent);
	});

	test("accepts a known provider id and rejects unknown ones to the base", () => {
		expect(normalizeSearchConfig({ provider: "searxng" }).provider).toBe("searxng");
		expect(normalizeSearchConfig({ provider: "brave" }).provider).toBe("brave");
		expect(normalizeSearchConfig({ provider: "auto" }).provider).toBe("auto");
		expect(normalizeSearchConfig({ provider: "nope" }).provider).toBe(DEFAULT_SEARCH_CONFIG.provider);
		const base = { ...DEFAULT_SEARCH_CONFIG, provider: "brave" as const };
		expect(normalizeSearchConfig({ provider: "nope" }, base).provider).toBe("brave");
	});
});

describe("resolveSearchApiKey", () => {
	test("prefers an environment variable over a literal key", () => {
		withEnv({ WEB_ACCESS_CONFIG_TEST_KEY: "from-env" }, () => {
			const config = { ...DEFAULT_SEARCH_CONFIG, apiKeyEnv: "WEB_ACCESS_CONFIG_TEST_KEY", apiKey: "literal" };
			expect(resolveSearchApiKey(config)).toBe("from-env");
		});
	});

	test("falls back to a literal key when the variable is unset", () => {
		withEnv({ WEB_ACCESS_CONFIG_TEST_KEY: undefined }, () => {
			expect(
				resolveSearchApiKey({
					...DEFAULT_SEARCH_CONFIG,
					apiKeyEnv: "WEB_ACCESS_CONFIG_TEST_KEY",
					apiKey: "literal",
				}),
			).toBe("literal");
		});
	});

	test("falls back to a literal key when the variable is blank", () => {
		withEnv({ WEB_ACCESS_CONFIG_TEST_KEY: "   " }, () => {
			expect(
				resolveSearchApiKey({
					...DEFAULT_SEARCH_CONFIG,
					apiKeyEnv: "WEB_ACCESS_CONFIG_TEST_KEY",
					apiKey: "literal",
				}),
			).toBe("literal");
		});
	});

	test("returns undefined when no key is configured", () => {
		withEnv({ WEB_ACCESS_CONFIG_TEST_KEY: undefined }, () => {
			expect(resolveSearchApiKey(DEFAULT_SEARCH_CONFIG)).toBeUndefined();
		});
	});
});
