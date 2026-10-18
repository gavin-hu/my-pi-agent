/**
 * The update check's lifecycle: reuse the cached answer or read the registry once
 * per interactive session, record a newer version, and announce it once per load.
 *
 * The request is fired without awaiting. Pi awaits `session_start` handlers, so
 * a slow registry would otherwise hold the first prompt; Pi's own version check
 * is asynchronous for the same reason. Every result that is not a strictly newer
 * version is silent, and a generation counter keeps a request that resolves
 * after shutdown from writing into the next session's state.
 *
 * A cached answer with a timestamp is what makes a long-lived session different
 * from a fresh one: a session that starts inside the window reuses the last read
 * instead of repeating it, and `recheck()` ignores the window so `/bytefly update`
 * can look again without a restart. `/bytefly` and `doctor` do not report the
 * version: an available update is not a prerequisite problem.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import pkg from "../../../package.json";
import { isOffline } from "../../../lib/env.ts";
import { isFresh, readUpdateCache, updateCachePath, writeUpdateCache, type UpdateCacheEntry } from "./cache.ts";
import { fetchLatestVersion } from "./check.ts";
import { updateNotice } from "./format.ts";
import type { UpdateOutcome, UpdateSource } from "./state.ts";
import { isNewerVersion } from "./version.ts";

/** The cache, as the lifecycle sees it: read on start, written after a read. */
export interface UpdateCache {
	/** The last recorded answer, or `undefined` for a miss. */
	read(): UpdateCacheEntry | undefined;
	/** Record an answer; a throw is treated as a miss. */
	write(entry: UpdateCacheEntry): void;
}

/** What `registerUpdate` returns, so the panel can re-run the check on demand. */
export interface UpdateHandle {
	/** Read the registry now, ignoring the cache window. Never throws. */
	recheck(): Promise<UpdateOutcome>;
}

/** Test seams; production uses the registry read, `PI_OFFLINE`, and the agent dir. */
export interface UpdateDeps {
	/** Replace the registry read; a rejection counts as no answer. */
	fetchLatest?: () => Promise<string | undefined>;
	/** Replace the `PI_OFFLINE` check. */
	isOffline?: () => boolean;
	/** Replace the disk cache. */
	cache?: UpdateCache;
	/** Replace the clock the cache timestamp is read from. */
	now?: () => number;
	/** Called once a newer version is recorded, so a mounted surface repaints. */
	onUpdate?: () => void;
}

/** The on-disk cache under the agent directory, built lazily so it is per call. */
function diskCache(): UpdateCache {
	return {
		read: () => readUpdateCache(updateCachePath(getAgentDir())),
		write: (entry) => {
			try {
				writeUpdateCache(updateCachePath(getAgentDir()), entry);
			} catch {
				// A read-only agent directory costs the next session one request, nothing more.
			}
		},
	};
}

/**
 * Register the check. `updates` is the same store the header reads, so recording
 * a version and calling `onUpdate` is what puts the marker on screen.
 */
export function registerUpdate(pi: ExtensionAPI, updates: UpdateSource, deps: UpdateDeps = {}): UpdateHandle {
	const readLatest = deps.fetchLatest ?? (() => fetchLatestVersion());
	const offline = deps.isOffline ?? isOffline;
	const cache = deps.cache ?? diskCache();
	const now = deps.now ?? Date.now;
	// A session is announced at most once per load, even if `session_start` fires
	// again after a resume or a session replacement.
	let announced = false;
	let generation = 0;

	/** Record a newer version and repaint the marker. */
	const paint = (latest: string): void => {
		if (!isNewerVersion(latest, pkg.version)) return;
		updates.set(latest);
		deps.onUpdate?.();
	};

	/** The once-per-load transcript notice, posted only for a strictly newer version. */
	const announce = (latest: string): void => {
		if (announced || !isNewerVersion(latest, pkg.version)) return;
		announced = true;
		pi.sendMessage(updateNotice(pkg.version, latest));
	};

	/** One answer, from the cache or the registry: paint the marker, announce it once. */
	const record = (entry: UpdateCacheEntry): void => {
		paint(entry.latest);
		announce(entry.latest);
	};

	const check = async (token: number): Promise<void> => {
		try {
			const latest = await readLatest();
			if (latest === undefined || token !== generation) return;
			const entry = { latest, checkedAt: now() };
			cache.write(entry);
			record(entry);
		} catch {
			// A background check never surfaces an error: the session does not know it ran.
		}
	};

	pi.on("session_start", (_event, ctx) => {
		// The marker lives in bytefly's header and the notice in a transcript, so a
		// non-interactive run has nothing to draw and makes no request.
		if (ctx.mode !== "tui") return;
		if (offline()) {
			// No request, so the window does not matter: the cached answer is the best
			// one available, and the marker is advisory.
			const cached = cache.read();
			if (cached) record(cached);
			return;
		}
		const cached = cache.read();
		if (cached && isFresh(cached, now())) {
			record(cached);
			return;
		}
		if (announced) return;
		void check(generation);
	});

	pi.on("session_shutdown", () => {
		// Invalidate any request still in flight and drop what this session found.
		generation++;
		updates.set();
	});

	return {
		async recheck() {
			if (offline()) return { kind: "offline" };
			let latest: string | undefined;
			try {
				latest = await readLatest();
			} catch {
				return { kind: "failed" };
			}
			if (latest === undefined) return { kind: "failed" };
			cache.write({ latest, checkedAt: now() });
			// The caller prints the answer, so this path never posts a notice.
			paint(latest);
			return isNewerVersion(latest, pkg.version) ? { kind: "available", latest } : { kind: "current", latest };
		},
	};
}
