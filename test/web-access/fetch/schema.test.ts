import { describe, expect, test } from "bun:test";
import { DEFAULT_FETCH_CONFIG } from "../../../extensions/web-access/fetch/config.ts";
import { MAX_URLS, resolveRequest } from "../../../extensions/web-access/fetch/schema.ts";

const config = { ...DEFAULT_FETCH_CONFIG, maxOutputChars: 5000 };

describe("resolveRequest", () => {
	test("accepts a single url", () => {
		const request = resolveRequest({ url: "https://example.com/" }, config);
		expect(request.urls).toEqual(["https://example.com/"]);
		expect(request.startIndex).toBe(0);
		expect(request.maxChars).toBe(5000);
		expect(request.mode).toBe("insensitive");
		expect(request.contextChars).toBe(200);
		expect(request.maxMatches).toBe(8);
		expect(request.find).toEqual([]);
		expect(request.refresh).toBe(false);
	});

	test("accepts urls, trimming and de-duplicating", () => {
		const request = resolveRequest({ urls: [" https://a/ ", "https://b/", "https://a/"] }, config);
		expect(request.urls).toEqual(["https://a/", "https://b/"]);
	});

	test("rejects both url and urls", () => {
		expect(() => resolveRequest({ url: "https://a/", urls: ["https://b/"] }, config)).toThrow("either url or urls");
	});

	test("rejects no url", () => {
		expect(() => resolveRequest({}, config)).toThrow("url is required");
		expect(() => resolveRequest({ urls: ["  "] }, config)).toThrow("url is required");
	});

	test("rejects too many urls", () => {
		const urls = Array.from({ length: MAX_URLS + 1 }, (_, i) => `https://h${i}/`);
		expect(() => resolveRequest({ urls }, config)).toThrow(`At most ${MAX_URLS}`);
	});

	test("rejects an over-long url", () => {
		expect(() => resolveRequest({ url: `https://x/${"a".repeat(3000)}` }, config)).toThrow("at most");
	});

	test("clamps maxChars to the configured ceiling", () => {
		expect(resolveRequest({ url: "https://a/", maxChars: 99_999 }, config).maxChars).toBe(5000);
		expect(resolveRequest({ url: "https://a/", maxChars: 1 }, config).maxChars).toBe(200);
	});

	test("normalizes find and the mode", () => {
		const request = resolveRequest({ url: "https://a/", find: ["  one  ", "", "two"], mode: "fuzzy" as const }, config);
		expect(request.find).toEqual(["one", "two"]);
		expect(request.mode).toBe("fuzzy");
	});
});
