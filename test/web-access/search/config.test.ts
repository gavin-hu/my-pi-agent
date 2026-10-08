import { describe, expect, test } from "bun:test";
import {
	DEFAULT_SEARCH_CONFIG,
	MAX_RESULTS,
	normalizeSearchConfig,
} from "../../../extensions/web-access/search/config.ts";

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
		});
		expect(config.maxResults).toBe(MAX_RESULTS);
		expect(config.timeoutMs).toBe(1_000);
		expect(config.maxBytes).toBe(1_024);
		expect(config.minIntervalMs).toBe(0);
		expect(config.maxOutputChars).toBe(1_000);
	});

	test("accepts a wikipedia language code and rejects nonsense", () => {
		expect(normalizeSearchConfig({ wikipediaLang: "zh" }).wikipediaLang).toBe("zh");
		expect(normalizeSearchConfig({ wikipediaLang: "zh-classical" }).wikipediaLang).toBe("zh-classical");
		expect(normalizeSearchConfig({ wikipediaLang: "not a lang!" }).wikipediaLang).toBe(
			DEFAULT_SEARCH_CONFIG.wikipediaLang,
		);
	});

	test("rejects non-http endpoints", () => {
		const config = normalizeSearchConfig({ instantAnswerEndpoint: "file:///etc/passwd", wikipediaEndpoint: "nope" });
		expect(config.instantAnswerEndpoint).toBe(DEFAULT_SEARCH_CONFIG.instantAnswerEndpoint);
		expect(config.wikipediaEndpoint).toBe(DEFAULT_SEARCH_CONFIG.wikipediaEndpoint);
	});

	test("keeps a custom user agent and treats blank as the default", () => {
		expect(normalizeSearchConfig({ userAgent: " my-bot " }).userAgent).toBe("my-bot");
		expect(normalizeSearchConfig({ userAgent: "   " }).userAgent).toBe(DEFAULT_SEARCH_CONFIG.userAgent);
	});
});
