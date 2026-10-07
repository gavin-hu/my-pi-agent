import { afterEach, describe, expect, test } from "bun:test";
import { cacheClear, cacheGet, cacheSet, cacheSize, type CachedPage } from "../../extensions/web-fetch/cache.ts";

function page(url: string, text = "hello", storedAt = 1000): CachedPage {
	return {
		url,
		finalUrl: url,
		title: "T",
		status: 200,
		contentType: "text/html",
		text,
		fetchedAt: "2026-01-01T00:00:00.000Z",
		storedAt,
		bytes: new TextEncoder().encode(text).length,
	};
}

const limits = { maxEntries: 8, maxBytes: 1_000_000 };

afterEach(() => cacheClear());

describe("page cache", () => {
	test("stores and retrieves a page", () => {
		cacheSet("https://a/", page("https://a/", "body"), limits);
		expect(cacheGet("https://a/", 1000, 1000)?.text).toBe("body");
		expect(cacheGet("https://missing/", 1000, 1000)).toBeUndefined();
	});

	test("expires entries past the TTL", () => {
		cacheSet("https://a/", page("https://a/", "body", 1000), limits);
		expect(cacheGet("https://a/", 100, 1050)).toBeDefined();
		expect(cacheGet("https://a/", 100, 1200)).toBeUndefined();
	});

	test("treats ttl 0 as never expiring", () => {
		cacheSet("https://a/", page("https://a/", "body", 1000), limits);
		expect(cacheGet("https://a/", 0, 99_999_999)).toBeDefined();
	});

	test("evicts the least recently used entry by count", () => {
		const small = { maxEntries: 2, maxBytes: 1_000_000 };
		cacheSet("https://a/", page("https://a/"), small);
		cacheSet("https://b/", page("https://b/"), small);
		cacheSet("https://c/", page("https://c/"), small);
		expect(cacheGet("https://a/", 0)).toBeUndefined();
		expect(cacheGet("https://b/", 0)).toBeDefined();
		expect(cacheSize()).toBe(2);
	});

	test("keeps recently used entries when evicting", () => {
		const small = { maxEntries: 2, maxBytes: 1_000_000 };
		cacheSet("https://a/", page("https://a/"), small);
		cacheSet("https://b/", page("https://b/"), small);
		cacheGet("https://a/", 0); // a becomes most recent
		cacheSet("https://c/", page("https://c/"), small);
		expect(cacheGet("https://b/", 0)).toBeUndefined();
		expect(cacheGet("https://a/", 0)).toBeDefined();
	});

	test("evicts by total bytes", () => {
		const tiny = { maxEntries: 8, maxBytes: 10 };
		cacheSet("https://a/", page("https://a/", "12345678"), tiny);
		cacheSet("https://b/", page("https://b/", "87654321"), tiny);
		expect(cacheGet("https://a/", 0)).toBeUndefined();
		expect(cacheGet("https://b/", 0)).toBeDefined();
	});

	test("clears everything", () => {
		cacheSet("https://a/", page("https://a/"), limits);
		cacheClear();
		expect(cacheSize()).toBe(0);
		expect(cacheGet("https://a/", 0)).toBeUndefined();
	});
});
