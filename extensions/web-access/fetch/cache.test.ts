import { describe, expect, test } from "bun:test";
import { createPageCache, type CachedPage } from "./cache.ts";

function page(url: string, text = "hello", storedAt = 1000): CachedPage {
	return {
		url,
		finalUrl: url,
		title: "T",
		status: 200,
		contentType: "text/html",
		text,
		rendered: false,
		fetchedAt: "2026-01-01T00:00:00.000Z",
		storedAt,
		bytes: new TextEncoder().encode(text).length,
	};
}

const limits = { maxEntries: 8, maxBytes: 1_000_000 };

/** A cache with a controllable clock, so TTL tests do not touch wall time. */
function clocked(now = 1000) {
	let current = now;
	const cache = createPageCache(() => current);
	return { cache, at: (value: number) => (current = value) };
}

describe("page cache", () => {
	test("stores and retrieves a page", () => {
		const { cache } = clocked();
		cache.set("https://a/", page("https://a/", "body"), limits);
		expect(cache.get("https://a/", 1000)?.text).toBe("body");
		expect(cache.get("https://missing/", 1000)).toBeUndefined();
	});

	test("expires entries past the TTL", () => {
		const { cache, at } = clocked();
		cache.set("https://a/", page("https://a/", "body", 1000), limits);
		at(1050);
		expect(cache.get("https://a/", 100)).toBeDefined();
		at(1200);
		expect(cache.get("https://a/", 100)).toBeUndefined();
	});

	test("treats ttl 0 as never expiring", () => {
		const { cache, at } = clocked();
		cache.set("https://a/", page("https://a/", "body", 1000), limits);
		at(99_999_999);
		expect(cache.get("https://a/", 0)).toBeDefined();
	});

	test("evicts the least recently used entry by count", () => {
		const { cache } = clocked();
		const small = { maxEntries: 2, maxBytes: 1_000_000 };
		cache.set("https://a/", page("https://a/"), small);
		cache.set("https://b/", page("https://b/"), small);
		cache.set("https://c/", page("https://c/"), small);
		expect(cache.get("https://a/", 0)).toBeUndefined();
		expect(cache.get("https://b/", 0)).toBeDefined();
		expect(cache.size()).toBe(2);
	});

	test("keeps recently used entries when evicting", () => {
		const { cache } = clocked();
		const small = { maxEntries: 2, maxBytes: 1_000_000 };
		cache.set("https://a/", page("https://a/"), small);
		cache.set("https://b/", page("https://b/"), small);
		cache.get("https://a/", 0); // a becomes most recent
		cache.set("https://c/", page("https://c/"), small);
		expect(cache.get("https://b/", 0)).toBeUndefined();
		expect(cache.get("https://a/", 0)).toBeDefined();
	});

	test("evicts by total bytes", () => {
		const { cache } = clocked();
		const tiny = { maxEntries: 8, maxBytes: 10 };
		cache.set("https://a/", page("https://a/", "12345678"), tiny);
		cache.set("https://b/", page("https://b/", "87654321"), tiny);
		expect(cache.get("https://a/", 0)).toBeUndefined();
		expect(cache.get("https://b/", 0)).toBeDefined();
	});

	test("clears everything", () => {
		const { cache } = clocked();
		cache.set("https://a/", page("https://a/"), limits);
		cache.clear();
		expect(cache.size()).toBe(0);
		expect(cache.get("https://a/", 0)).toBeUndefined();
	});

	test("instances are independent", () => {
		const first = createPageCache();
		const second = createPageCache();
		first.set("https://a/", page("https://a/"), limits);
		expect(second.get("https://a/", 0)).toBeUndefined();
	});
});
