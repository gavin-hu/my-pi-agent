/**
 * The `suggest` section of `bytefly.json`.
 *
 * One switch: whether the model is asked for a next-steps block, and whether a
 * block it writes anyway is lifted into the transcript aside. Follows the shared
 * section pattern — defaults, a total normalizer, and a loader that reads the
 * global file then the project file over it.
 */

import { asBoolean, loadConfigSection } from "../../../lib/config.ts";

/** The `suggest` section as this extension reads it. */
export interface SuggestConfig {
	/** Ask the model for a next-steps block and draw it below the turn rule. */
	enabled: boolean;
}

export const DEFAULT_SUGGEST_CONFIG: SuggestConfig = { enabled: true };

/** Validate the `suggest` section over `base`. Total: never throws, never guesses. */
export function normalizeSuggestConfig(raw: Record<string, unknown> | undefined, base: SuggestConfig): SuggestConfig {
	if (!raw) return base;
	return { enabled: asBoolean(raw.enabled, base.enabled) };
}

/** Effective `suggest` config for `cwd` (defaults, then the shared section). */
export function loadSuggestConfig(cwd: string): SuggestConfig {
	return loadConfigSection(cwd, "suggest", DEFAULT_SUGGEST_CONFIG, normalizeSuggestConfig);
}
