/**
 * The update check's lifecycle: read the published version once per interactive
 * session, record it when it is newer, and announce it once per load.
 *
 * The request is fired without awaiting. Pi awaits `session_start` handlers, so
 * a slow registry would otherwise hold the first prompt; Pi's own version check
 * is asynchronous for the same reason. Every result that is not a strictly newer
 * version is silent, and a generation counter keeps a request that resolves
 * after shutdown from writing into the next session's state.
 *
 * `/bytefly` and `doctor` do not report this: an available update is not a
 * prerequisite problem, and the header plus one notice are the whole surface.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pkg from "../../../package.json";
import { isOffline } from "../../../lib/env.ts";
import { fetchLatestVersion } from "./check.ts";
import { updateNotice } from "./format.ts";
import type { UpdateSource } from "./state.ts";
import { isNewerVersion } from "./version.ts";

/** Test seams; production uses the registry read and `PI_OFFLINE`. */
export interface UpdateDeps {
	/** Replace the registry read; a rejection counts as no answer. */
	fetchLatest?: () => Promise<string | undefined>;
	/** Replace the `PI_OFFLINE` check. */
	isOffline?: () => boolean;
	/** Called once a newer version is recorded, so a mounted surface repaints. */
	onUpdate?: () => void;
}

/**
 * Register the check. `updates` is the same store the header reads, so recording
 * a version and calling `onUpdate` is what puts the marker on screen.
 */
export function registerUpdate(pi: ExtensionAPI, updates: UpdateSource, deps: UpdateDeps = {}): void {
	const readLatest = deps.fetchLatest ?? (() => fetchLatestVersion());
	const offline = deps.isOffline ?? isOffline;
	// A session is announced at most once per load, even if `session_start` fires
	// again after a resume or a session replacement.
	let announced = false;
	let generation = 0;

	const check = async (token: number): Promise<void> => {
		try {
			const latest = await readLatest();
			if (latest === undefined || token !== generation) return;
			if (announced || !isNewerVersion(latest, pkg.version)) return;
			announced = true;
			updates.set(latest);
			deps.onUpdate?.();
			pi.sendMessage(updateNotice(pkg.version, latest));
		} catch {
			// A background check never surfaces an error: the session does not know it ran.
		}
	};

	pi.on("session_start", (_event, ctx) => {
		// The marker lives in bytefly's header and the notice in a transcript, so a
		// non-interactive run has nothing to draw and makes no request.
		if (ctx.mode !== "tui") return;
		if (announced || offline()) return;
		void check(generation);
	});

	pi.on("session_shutdown", () => {
		// Invalidate any request still in flight and drop what this session found.
		generation++;
		updates.set();
	});
}
