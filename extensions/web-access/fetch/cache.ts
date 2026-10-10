/**
 * In-process LRU cache of extracted pages.
 *
 * `web_fetch` pages and searches the same URL repeatedly (paging, find-in-page),
 * so caching the extracted text avoids refetching. One cache instance belongs to
 * one `web_fetch` registration — `registerFetchTool` creates it and clears it on
 * `session_start` and `session_shutdown`, so pages never outlive a session. The
 * cache is bounded by entry count and total bytes, and entries expire by TTL.
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

/** A page cache instance. Create one per `web_fetch` registration. */
export interface PageCache {
	/** Look up a page, dropping it when older than `ttlMs` (`ttlMs <= 0` disables expiry). */
	get(url: string, ttlMs: number): CachedPage | undefined;
	/** Store a page, evicting least-recently-used entries until within bounds. */
	set(url: string, page: CachedPage, limits: { maxEntries: number; maxBytes: number }): void;
	/** Remove everything. */
	clear(): void;
	/** Number of cached pages (tests). */
	size(): number;
}

/** Create a page cache. `now` is injectable so tests can advance a fake clock. */
export function createPageCache(now: () => number = Date.now): PageCache {
	const entries = new Map<string, CachedPage>();

	function totalBytes(): number {
		let total = 0;
		for (const entry of entries.values()) total += entry.bytes;
		return total;
	}

	return {
		get(url, ttlMs) {
			const entry = entries.get(url);
			if (!entry) return undefined;
			if (ttlMs > 0 && now() - entry.storedAt > ttlMs) {
				entries.delete(url);
				return undefined;
			}
			// Re-insert to mark as most recently used.
			entries.delete(url);
			entries.set(url, entry);
			return entry;
		},

		set(url, page, limits) {
			entries.delete(url);
			entries.set(url, page);

			while (entries.size > Math.max(1, limits.maxEntries) || totalBytes() > Math.max(1, limits.maxBytes)) {
				const oldest = entries.keys().next();
				if (oldest.done) break;
				entries.delete(oldest.value);
			}
		},

		clear() {
			entries.clear();
		},

		size() {
			return entries.size;
		},
	};
}
