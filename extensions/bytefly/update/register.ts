/**
 * The update surface's lifecycle: ask Pi's package manager which configured
 * packages are behind, cache the snapshot, and announce it once per load.
 *
 * Pi would draw its own `Package Updates Available` block from the same method
 * after `session_start`. bytefly suppresses that block, asks the captured
 * original check itself, and draws the single notice. The request is fired
 * without awaiting: Pi awaits `session_start` handlers, and a slow npm/git check
 * must not hold the first prompt.
 *
 * The 24-hour cache is keyed by the working directory and the effective package
 * sources, so a project switch or an install/removal invalidates it. A cache hit
 * costs no package-manager call; `/bytefly update` ignores the window and re-runs
 * the check on demand.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import pkg from "../../../package.json";
import { isOffline } from "../../../lib/env.ts";
import {
	isFresh,
	readUpdateCache,
	updateCacheKey,
	updateCachePath,
	writeUpdateCache,
	type UpdateCacheEntry,
} from "./cache.ts";
import { fetchAvailableUpdates, fetchLatestVersion } from "./check.ts";
import { isOwnPackage, updateNotice } from "./format.ts";
import type { UpdateOutcome, UpdateSource } from "./state.ts";
import { suppressPiPackageUpdates, type UpdateSuppression } from "./suppress.ts";
import type { PackageUpdate, PackageUpdateCheck } from "./types.ts";
import { isNewerVersion } from "./version.ts";

/** The cache, as the lifecycle sees it: read on start, written after a read. */
export interface UpdateCache {
	/** The last recorded snapshot, or `undefined` for a miss. */
	read(): UpdateCacheEntry | undefined;
	/** Record a snapshot; a throw is treated as a miss. */
	write(entry: UpdateCacheEntry): void;
}

/** What `registerUpdate` returns, so the panel can re-run the check on demand. */
export interface UpdateHandle {
	/** Read the package list now, ignoring the cache window. Never throws. */
	recheck(): Promise<UpdateOutcome>;
}

/** Test seams; production uses Pi's package manager, its cache, and the agent dir. */
export interface UpdateDeps {
	/** Replace the package-manager read. */
	readUpdates?: (ctx: ExtensionContext, check: PackageUpdateCheck) => Promise<PackageUpdate[]>;
	/** Replace the registry read that names this package's new version. */
	fetchLatest?: () => Promise<string | undefined>;
	/** Replace the `PI_OFFLINE` check. */
	isOffline?: () => boolean;
	/** Replace the disk cache. */
	cache?: UpdateCache;
	/** Replace the clock the cache timestamp is read from. */
	now?: () => number;
	/** Replace the host suppression; defaults to patching Pi's package manager. */
	suppress?: () => UpdateSuppression;
	/** Called once a snapshot is recorded, so a mounted surface repaints. */
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
				// A read-only agent directory costs the next session one check, nothing more.
			}
		},
	};
}

/**
 * Register the update lifecycle. `updates` is the store the header reads, so
 * recording a snapshot is what puts this package's marker on screen.
 */
export function registerUpdate(pi: ExtensionAPI, updates: UpdateSource, deps: UpdateDeps = {}): UpdateHandle {
	const readUpdates =
		deps.readUpdates ??
		((ctx, check) =>
			fetchAvailableUpdates({
				cwd: ctx.cwd,
				agentDir: getAgentDir(),
				projectTrusted: ctx.isProjectTrusted(),
				checkForAvailableUpdates: check,
			}));
	const readLatest = deps.fetchLatest ?? (() => fetchLatestVersion());
	const offline = deps.isOffline ?? isOffline;
	const cache = deps.cache ?? diskCache();
	const now = deps.now ?? Date.now;
	const suppress = deps.suppress ?? suppressPiPackageUpdates;
	// A session is announced at most once per load, even if `session_start` fires
	// again after a resume or a session replacement.
	let announced = false;
	let generation = 0;
	let suppression: UpdateSuppression | undefined;
	let context: ExtensionContext | undefined;
	const fallbackCheck: PackageUpdateCheck = (manager) => manager.checkForAvailableUpdates();
	const activeCheck = (): PackageUpdateCheck => suppression?.check ?? fallbackCheck;

	/** Identity of the settings a snapshot is read under. */
	const keyFor = (ctx: ExtensionContext): string => updateCacheKey(ctx.cwd, pi.getSettings?.()?.packages);

	/** A cache write never turns a read into a failed check. */
	const writeCache = (entry: UpdateCacheEntry): void => {
		try {
			cache.write(entry);
		} catch {
			// The next session performs one more check; this one already has its answer.
		}
	};

	/** This package's new version in a snapshot, when it is actually newer. */
	const ownLatestOf = (entry: UpdateCacheEntry): string | undefined => {
		if (!entry.latest || !isNewerVersion(entry.latest, pkg.version)) return undefined;
		return entry.updates.some(isOwnPackage) ? entry.latest : undefined;
	};

	/** Paint the header marker, or clear it when this package is current. */
	const paint = (latest?: string): void => {
		if (updates.latest() === latest) return;
		updates.set(latest);
		deps.onUpdate?.();
	};

	/** The once-per-load transcript notice, posted only for a non-empty list. */
	const announce = (entry: UpdateCacheEntry): void => {
		if (announced || entry.updates.length === 0) return;
		announced = true;
		pi.sendMessage(updateNotice(entry.updates, pkg.version, ownLatestOf(entry)));
	};

	/** One snapshot: paint the marker and, when it has rows, announce it once. */
	const record = (entry: UpdateCacheEntry): void => {
		paint(ownLatestOf(entry));
		announce(entry);
	};

	/** Offline: the cached marker is advisory, but no notice is posted. */
	const recordMarkerOnly = (entry: UpdateCacheEntry): void => {
		paint(ownLatestOf(entry));
	};

	/** Resolve this package's version label, dropping an equal or older answer. */
	const resolveOwnLatest = async (own: PackageUpdate | undefined): Promise<string | undefined> => {
		if (!own) return undefined;
		let latest: string | undefined;
		try {
			latest = await readLatest();
		} catch {
			return undefined;
		}
		return latest && isNewerVersion(latest, pkg.version) ? latest : undefined;
	};

	const check = async (ctx: ExtensionContext, token: number): Promise<void> => {
		try {
			const list = await readUpdates(ctx, activeCheck());
			if (token !== generation) return;
			const latest = await resolveOwnLatest(list.find(isOwnPackage));
			if (token !== generation) return;
			const entry: UpdateCacheEntry = {
				key: keyFor(ctx),
				checkedAt: now(),
				updates: list,
				...(latest ? { latest } : {}),
			};
			writeCache(entry);
			record(entry);
		} catch {
			// A background check never surfaces an error: the session does not know it ran.
		}
	};

	pi.on("session_start", (_event, ctx) => {
		// `/bytefly update` can answer in any mode; only the TUI installs the host
		// shim and posts a notice.
		context = ctx;
		if (ctx.mode !== "tui") return;
		suppression ??= suppress();
		const cached = cache.read();
		const key = keyFor(ctx);
		if (offline()) {
			// No request, so the window does not matter: the cached marker is the best
			// answer available, and no notice is posted from a stale list.
			if (cached && cached.key === key) recordMarkerOnly(cached);
			return;
		}
		if (cached && cached.key === key && isFresh(cached, now())) {
			record(cached);
			return;
		}
		if (announced) return;
		void check(ctx, generation);
	});

	pi.on("session_shutdown", () => {
		// Invalidate any request still in flight, drop what this session found, and
		// give Pi's own check back to the host.
		generation++;
		updates.set();
		suppression?.restore();
		suppression = undefined;
		context = undefined;
	});

	return {
		async recheck() {
			if (offline()) return { kind: "offline" };
			if (!context) return { kind: "failed" };
			let list: PackageUpdate[];
			try {
				list = await readUpdates(context, activeCheck());
			} catch {
				return { kind: "failed" };
			}
			const latest = await resolveOwnLatest(list.find(isOwnPackage));
			const entry: UpdateCacheEntry = {
				key: keyFor(context),
				checkedAt: now(),
				updates: list,
				...(latest ? { latest } : {}),
			};
			writeCache(entry);
			// The caller prints the answer, so this path never posts a notice.
			paint(latest);
			return list.length > 0
				? { kind: "available", updates: list, ...(latest ? { ownLatest: latest } : {}) }
				: { kind: "current" };
		},
	};
}
