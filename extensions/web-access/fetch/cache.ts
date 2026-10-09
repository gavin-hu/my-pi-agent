/**
 * In-process LRU cache of extracted pages.
 *
 * `web_fetch` pages and searches the same URL repeatedly (paging, find-in-page),
 * so caching the extracted text avoids refetching. The cache is bounded by entry
 * count and total bytes, entries expire by TTL, and `cacheClear()` runs on
 * `session_shutdown` so nothing survives a session.
 */

import type { PageResult } from "./page.ts";

/** A cached page: the extracted result plus cache bookkeeping. */
export type CachedPage = PageResult & {
	/** ISO-8601 timestamp of the original fetch. */
	fetchedAt: string;
	/** Epoch ms the entry was stored, for TTL checks. */
	storedAt: number;
	/** Size of `text` in bytes. */
	bytes: number;
};

const entries = new Map<string, CachedPage>();

function totalBytes(): number {
	let total = 0;
	for (const entry of entries.values()) total += entry.bytes;
	return total;
}

/**
 * Look up a page. Returns `undefined` when missing or older than `ttlMs`
 * (`ttlMs <= 0` disables expiry). `now` is injectable for tests.
 */
export function cacheGet(url: string, ttlMs: number, now: number = Date.now()): CachedPage | undefined {
	const entry = entries.get(url);
	if (!entry) return undefined;
	if (ttlMs > 0 && now - entry.storedAt > ttlMs) {
		entries.delete(url);
		return undefined;
	}
	// Re-insert to mark as most recently used.
	entries.delete(url);
	entries.set(url, entry);
	return entry;
}

/** Store a page, evicting least-recently-used entries until within bounds. */
export function cacheSet(url: string, page: CachedPage, limits: { maxEntries: number; maxBytes: number }): void {
	entries.delete(url);
	entries.set(url, page);

	while (entries.size > Math.max(1, limits.maxEntries) || totalBytes() > Math.max(1, limits.maxBytes)) {
		const oldest = entries.keys().next();
		if (oldest.done) break;
		entries.delete(oldest.value);
	}
}

/** Remove everything. */
export function cacheClear(): void {
	entries.clear();
}

/** Number of cached pages (tests). */
export function cacheSize(): number {
	return entries.size;
}
