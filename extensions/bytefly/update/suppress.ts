/**
 * Pi draws two update blocks bytefly replaces, and this module expresses both
 * through the install/restore rules in `patch.ts`.
 *
 * Pi draws `Package Updates Available` from `InteractiveMode.run()` after the
 * session starts, with no setting or extension event to turn it off. The one
 * public seam is the package manager it calls: replacing
 * `checkForAvailableUpdates` with an empty result suppresses that block, while
 * the captured original still serves bytefly's own query.
 *
 * Pi draws `Update Available` from the same `run()`, through a public method on
 * `InteractiveMode`; replacing that method hands bytefly the release Pi resolved
 * (its version and notes) so it can draw the shared notice instead.
 *
 * A future host that changes either shape makes that patch a no-op rather than an
 * error; the update surface then falls back to Pi's own block.
 */

import { DefaultPackageManager, InteractiveMode } from "@earendil-works/pi-coding-agent";
import { patchPrototypeMethod } from "./patch.ts";
import type { PackageUpdate, PackageUpdateCheck, PiRelease, ReleaseNoticePrototype } from "./types.ts";

/** A patchable class prototype, kept narrow so a test needs no host object. */
export interface PackageManagerPrototype {
	checkForAvailableUpdates: PackageUpdateCheck;
}

/** The installed suppression: the real check, and how to restore Pi's method. */
export interface UpdateSuppression {
	/** The original method, bound at call time so it still sees its manager. */
	readonly check: PackageUpdateCheck;
	/** Put Pi's method back; safe to call more than once. */
	restore(): void;
}

/** The replacement the patch installs, so a test can tell it from Pi's method. */
const SUPPRESSED: PackageUpdateCheck = async () => [];

/**
 * Replace Pi's package-update check with one that reports nothing.
 *
 * `prototype` is a seam for tests; production passes Pi's
 * `DefaultPackageManager.prototype`. When the method is missing, the returned
 * suppression is inert and the original read stays `[]`.
 */
export function suppressPiPackageUpdates(
	prototype: PackageManagerPrototype = DefaultPackageManager.prototype as PackageManagerPrototype,
): UpdateSuppression {
	const patch = patchPrototypeMethod(prototype, "checkForAvailableUpdates", SUPPRESSED);
	if (!patch.original) return { check: async () => [], restore: patch.restore };

	const originalCheck = patch.original as unknown as (this: DefaultPackageManager) => Promise<PackageUpdate[]>;
	return { check: (manager) => originalCheck.call(manager), restore: patch.restore };
}

/** The installed release-notice shim, and how to give Pi its method back. */
export interface ReleaseNoticeShim {
	/** Put Pi's method back; safe to call more than once. */
	restore(): void;
}

/**
 * Hand Pi's `Update Available` release to `notify` instead of letting Pi draw it.
 *
 * `prototype` is a seam for tests; production passes `InteractiveMode.prototype`.
 * When the host has no such method the shim is inert and Pi's box is what shows,
 * which is exactly the state this replaces. A `notify` that throws is also a
 * fallback to Pi's box: a release nobody hears about is worse than Pi's own
 * rendering of it, and the error itself is not allowed to escape into `run()`.
 */
export function suppressPiReleaseNotice(
	notify: (release: PiRelease) => void,
	prototype: ReleaseNoticePrototype = InteractiveMode.prototype as ReleaseNoticePrototype,
): ReleaseNoticeShim {
	const original = prototype.showNewVersionNotification as (this: ReleaseNoticePrototype, release: PiRelease) => void;
	const patched = function (this: ReleaseNoticePrototype, release: PiRelease): void {
		try {
			notify(release);
		} catch {
			if (typeof original === "function") original.call(this, release);
		}
	};
	return patchPrototypeMethod(prototype, "showNewVersionNotification", patched);
}
