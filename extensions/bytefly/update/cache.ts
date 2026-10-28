/**
 * The package-update snapshot, cached on disk with the time it was read.
 *
 * The 24-hour window is what makes a long-lived session different from a fresh
 * one: a session that starts inside the window reuses the last read instead of
 * repeating Pi's npm/git checks, and `/bytefly update` re-runs them on demand.
 * The entry is keyed by the working directory and the effective package sources,
 * so a project switch or an install/removal invalidates it instead of showing
 * another project's list.
 *
 * A cache can only ever be a miss. An absent, unreadable, old-schema, or
 * mistyped file reads as `undefined` and the caller fetches; nothing here
 * throws, because a stale file must never become a session error.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { writeConfigFile } from "../../../lib/config.ts";
import type { PackageUpdate } from "./types.ts";
import { parseVersion } from "./version.ts";

/** The file name under `<agent-dir>/bytefly/`. */
export const UPDATE_CACHE_FILE = "update.json";

/** How long a cached snapshot is reused before the next session re-reads. */
export const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** One cached snapshot: Pi's list, this package's version, and when it was read. */
export interface UpdateCacheEntry {
	/** Identity of the cwd plus the effective package sources. */
	key: string;
	/** Epoch milliseconds of the read that produced this snapshot. */
	checkedAt: number;
	/** Every package Pi reported as updateable. */
	updates: PackageUpdate[];
	/** This package's new version, when it is one of the updates. */
	latest?: string;
}

/** Where the cache lives for an agent directory. */
export function updateCachePath(agentDir: string): string {
	return join(agentDir, "bytefly", UPDATE_CACHE_FILE);
}

/** Stable identity for the settings a snapshot was read under. */
export function updateCacheKey(cwd: string, packages: readonly PackageSource[] | undefined): string {
	return createHash("sha256")
		.update(JSON.stringify({ cwd, packages: packages ?? [] }))
		.digest("hex");
}

/** Whether a value has the fields Pi's package update carries. */
function isPackageUpdate(value: unknown): value is PackageUpdate {
	if (!value || typeof value !== "object") return false;
	const update = value as Partial<PackageUpdate>;
	return (
		typeof update.source === "string" &&
		typeof update.displayName === "string" &&
		(update.type === "npm" || update.type === "git") &&
		(update.scope === "user" || update.scope === "project")
	);
}

/** Read the cache; a missing, corrupt, old-schema, or mistyped entry is `undefined`. */
export function readUpdateCache(path: string): UpdateCacheEntry | undefined {
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown> | undefined;
		if (!raw || typeof raw !== "object") return undefined;
		const key = typeof raw.key === "string" ? raw.key.trim() : "";
		const checkedAt = typeof raw.checkedAt === "number" && Number.isFinite(raw.checkedAt) ? raw.checkedAt : 0;
		const updates = Array.isArray(raw.updates) ? raw.updates : undefined;
		if (!key || checkedAt <= 0 || !updates || !updates.every(isPackageUpdate)) return undefined;
		const latest = typeof raw.latest === "string" ? raw.latest.trim() : "";
		return {
			key,
			checkedAt,
			updates,
			...(parseVersion(latest) ? { latest } : {}),
		};
	} catch {
		return undefined;
	}
}

/**
 * Write the cache atomically (a sibling temp file, then a rename). The caller
 * treats a throw as a miss: a read-only agent directory must not break a session.
 */
export function writeUpdateCache(path: string, entry: UpdateCacheEntry): void {
	writeConfigFile(path, {
		key: entry.key,
		checkedAt: entry.checkedAt,
		updates: entry.updates,
		...(entry.latest ? { latest: entry.latest } : {}),
	});
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
