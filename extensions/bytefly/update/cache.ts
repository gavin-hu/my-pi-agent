/**
 * The published-version answer, cached on disk with the time it was read.
 *
 * The check already fires once per session, which leaves two gaps: a session open
 * for days never re-reads npm, and every new session pays for a request it made
 * minutes earlier. A timestamp is what fixes the second, so the cache lives in the
 * agent directory rather than in memory — one entry, one window, shared by every
 * session that starts inside it.
 *
 * A cache can only ever be a miss. An absent, unreadable, or wrong-typed file
 * reads as `undefined` and the caller fetches; nothing here throws, because a
 * stale file must never become a session error.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeConfigFile } from "../../../lib/config.ts";
import { parseVersion } from "./version.ts";

/** The file name under `<agentDir>/bytefly/`. */
export const UPDATE_CACHE_FILE = "update.json";

/** How long a cached answer is reused before the next session re-reads npm. */
export const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** One cached answer: the newest published version and when it was read. */
export interface UpdateCacheEntry {
	/** The version npm's `latest` tag pointed at. */
	latest: string;
	/** Epoch milliseconds of the read that produced `latest`. */
	checkedAt: number;
}

/** Where the cache lives for an agent directory. */
export function updateCachePath(agentDir: string): string {
	return join(agentDir, "bytefly", UPDATE_CACHE_FILE);
}

/** Read the cache; a missing, corrupt, or mistyped entry is `undefined`. */
export function readUpdateCache(path: string): UpdateCacheEntry | undefined {
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown> | undefined;
		if (!raw || typeof raw !== "object") return undefined;
		const latest = typeof raw.latest === "string" ? raw.latest.trim() : "";
		const checkedAt = typeof raw.checkedAt === "number" && Number.isFinite(raw.checkedAt) ? raw.checkedAt : 0;
		if (!parseVersion(latest) || checkedAt <= 0) return undefined;
		return { latest, checkedAt };
	} catch {
		return undefined;
	}
}

/**
 * Write the cache atomically (a sibling temp file, then a rename). The caller
 * treats a throw as a miss: a read-only agent directory must not break a session.
 */
export function writeUpdateCache(path: string, entry: UpdateCacheEntry): void {
	writeConfigFile(path, { latest: entry.latest, checkedAt: entry.checkedAt });
}

/**
 * Whether an entry is still inside the window. The boundary is inclusive: an
 * entry read exactly `ttlMs` ago is reused, so the window never flickers.
 */
export function isFresh(
	entry: UpdateCacheEntry | undefined,
	now: number,
	ttlMs: number = UPDATE_CACHE_TTL_MS,
): boolean {
	if (!entry) return false;
	const age = now - entry.checkedAt;
	return age >= 0 && age <= ttlMs;
}
