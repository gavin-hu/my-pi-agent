/**
 * Pi suppresses its own package-update block while bytefly owns the surface.
 *
 * Pi draws `Package Updates Available` from `InteractiveMode.run()` after the
 * session starts, with no setting or extension event to turn it off. The one
 * public seam is the package manager it calls: replacing
 * `checkForAvailableUpdates` with an empty result suppresses that block, while
 * the captured original still serves bytefly's own query. The patch is
 * process-wide, so it is installed at `session_start` and restored at
 * `session_shutdown`.
 *
 * A future host that changes the method shape makes the patch a no-op rather
 * than an error; the update surface then falls back to Pi's block.
 */

import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import type { PackageUpdate, PackageUpdateCheck } from "./types.ts";

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

/** Marker for the installed patch, so a second registration reuses it. */
const SUPPRESSION = Symbol.for("@gavin-hu/my-pi-agent/pi-update-suppression");

interface MarkedPrototype extends PackageManagerPrototype {
	[SUPPRESSION]?: UpdateSuppression;
}

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
	const marked = prototype as MarkedPrototype;
	const existing = marked[SUPPRESSION];
	if (existing) return existing;

	const original = prototype.checkForAvailableUpdates;
	if (typeof original !== "function") return { check: async () => [], restore: () => {} };
	const originalCheck = original as unknown as (this: DefaultPackageManager) => Promise<PackageUpdate[]>;
	const check: PackageUpdateCheck = (manager) => originalCheck.call(manager);
	const patched: PackageUpdateCheck = async () => [];
	const restore = (): void => {
		if (prototype.checkForAvailableUpdates === patched) prototype.checkForAvailableUpdates = original;
		delete marked[SUPPRESSION];
	};
	const suppression: UpdateSuppression = { check, restore };
	prototype.checkForAvailableUpdates = patched;
	marked[SUPPRESSION] = suppression;
	return suppression;
}
