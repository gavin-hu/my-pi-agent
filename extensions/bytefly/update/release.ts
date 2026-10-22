/**
 * Pi's own release notice, re-drawn as bytefly's.
 *
 * Pi resolves its new version from `pi.dev`, then draws a bordered `Update
 * Available` block. This lifecycle replaces the method that draws it, so the
 * release Pi already fetched becomes one shared transcript notice and a `↑`
 * marker on the header's Pi line. No request of bytefly's own is made, and the
 * release's changelog note, when Pi's API sends one, travels with it.
 *
 * The patch is installed at `session_start` in `tui` mode — `run()` starts the
 * version check only after the session is up — and restored at
 * `session_shutdown`, the same shape as the package-update surface. A release
 * that lands after the session is gone is dropped rather than posted into it.
 */

import { type ExtensionAPI, VERSION } from "@earendil-works/pi-coding-agent";
import { piReleaseNotice } from "./format.ts";
import { paintLatest, type UpdateSource } from "./state.ts";
import { suppressPiReleaseNotice, type ReleaseNoticeShim } from "./suppress.ts";
import type { PiRelease, ReleaseNoticePrototype } from "./types.ts";

/** Test seams; production patches Pi's interactive mode and reads its version. */
export interface ReleaseDeps {
	/** Replace the host method bytefly patches; defaults to `InteractiveMode.prototype`. */
	prototype?: ReleaseNoticePrototype;
	/** Replace the running Pi version; defaults to the host's `VERSION`. */
	currentVersion?: string;
	/** Called once a version is recorded, so a mounted header repaints. */
	onUpdate?: () => void;
}

/**
 * Register the release-notice lifecycle. `latest` is the store the header reads,
 * so recording Pi's new version is what puts the marker on the agent line.
 */
export function registerPiRelease(pi: ExtensionAPI, latest: UpdateSource, deps: ReleaseDeps = {}): void {
	const current = deps.currentVersion ?? VERSION;
	let shim: ReleaseNoticeShim | undefined;
	let live = false;
	// Pi checks once per process, but a reload re-registers this surface: a second
	// notice in the same load would be a duplicate, not news.
	let announced = false;

	const record = (release: PiRelease): void => {
		if (!live) return;
		paintLatest(latest, release.version, deps.onUpdate);
		if (announced) return;
		announced = true;
		pi.sendMessage(piReleaseNotice(release, current));
	};

	pi.on("session_start", (_event, ctx) => {
		// Only the interactive mode draws Pi's box, so only there is there one to replace.
		if (ctx.mode !== "tui") return;
		live = true;
		shim ??= suppressPiReleaseNotice(record, deps.prototype);
	});

	pi.on("session_shutdown", () => {
		live = false;
		shim?.restore();
		shim = undefined;
		latest.set();
	});
}
