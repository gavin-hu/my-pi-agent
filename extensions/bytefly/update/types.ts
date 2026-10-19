/**
 * The package-update shape Pi's manager returns.
 *
 * Pi exports the manager but not its `PackageUpdate` interface, so the type is
 * derived from the public method. That keeps the extension on the same contract
 * without reaching into a dist path or restating the fields.
 */

import type { DefaultPackageManager } from "@earendil-works/pi-coding-agent";

/** One package Pi reports as updateable. */
export type PackageUpdate = Awaited<ReturnType<DefaultPackageManager["checkForAvailableUpdates"]>>[number];

/** Pi's check, captured before suppression and called with a manager. */
export type PackageUpdateCheck = (manager: DefaultPackageManager) => Promise<PackageUpdate[]>;
