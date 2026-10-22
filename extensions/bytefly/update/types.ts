/**
 * The update shapes Pi publishes, derived from the public methods that carry
 * them.
 *
 * Pi exports the package manager and the interactive mode but not the interfaces
 * they pass around, so each type here is read off a public signature. That keeps
 * the extension on the same contract without reaching into a dist path or
 * restating the fields a host version may change.
 */

import type { DefaultPackageManager, InteractiveMode } from "@earendil-works/pi-coding-agent";

/** One package Pi reports as updateable. */
export type PackageUpdate = Awaited<ReturnType<DefaultPackageManager["checkForAvailableUpdates"]>>[number];

/** Pi's check, captured before suppression and called with a manager. */
export type PackageUpdateCheck = (manager: DefaultPackageManager) => Promise<PackageUpdate[]>;

/** A newer Pi release as Pi itself resolved it: the version, and its notes when any. */
export type PiRelease = Parameters<InteractiveMode["showNewVersionNotification"]>[0];

/** The notification method bytefly replaces, narrow enough for a test to fake. */
export interface ReleaseNoticePrototype {
	showNewVersionNotification(release: PiRelease): void;
}
