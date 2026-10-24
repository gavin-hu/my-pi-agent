/**
 * The switch that turns the split on, and the words the user flips it with.
 *
 * It lives in `lib/` because three places must agree: the settings row that
 * writes it, plan approval that reads it, and the bus that refuses a join while
 * it is off. A second copy of the key would mean a panel row that changes
 * nothing — the failure this module exists to prevent.
 *
 * Off by default: the split changes what approval means and adds work nobody
 * asked for, so it ships closed and an existing user upgrades into the single
 * flow they already know.
 */

import { asBoolean, configValueAt, loadConfigSection } from "../config.ts";

/** The shared document's section and key that hold the switch. */
export const SPLIT_SECTION = "plan";
export const SPLIT_KEY = "split";
export const SPLIT_DEFAULT = false;

/** The settings-panel row, so a refusal can name what the user flips. */
export const SPLIT_SETTING_ID = "plan.split";
export const SPLIT_SETTING_LABEL = "Split plans into slices";

/** The section's shape and its default, so a loader and its documentation agree. */
export interface SplitConfig {
	split: boolean;
}

export const DEFAULT_SPLIT_CONFIG: SplitConfig = { split: SPLIT_DEFAULT };

/** Read the section over `base`, ignoring a value that is not a boolean. */
export function normalizeSplitConfig(raw: Record<string, unknown> | undefined, base: SplitConfig): SplitConfig {
	return { split: asBoolean(configValueAt(raw, [SPLIT_KEY]), base.split) };
}

/** Whether this project (or the user's global config) has the split on. */
export function splitEnabled(cwd: string): boolean {
	return loadConfigSection(cwd, SPLIT_SECTION, DEFAULT_SPLIT_CONFIG, normalizeSplitConfig).split;
}

/** The one line a refusal or a note uses to say the switch is off and where it lives. */
export const SPLIT_OFF_NOTE =
	`Parallel slices are off (${SPLIT_SETTING_ID}). ` +
	`Enable "${SPLIT_SETTING_LABEL}" in /bytefly settings to split a plan.`;
