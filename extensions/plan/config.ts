/**
 * Config-file support for plan mode.
 *
 * The `plan` section of the shared `bytefly.json` (global then project, project
 * wins). Only the approval offer is configurable; plan mode itself never depends
 * on it.
 */

import { loadConfigSection } from "../../lib/config.ts";

export interface PlanConfig {
	/** Ask before recording an approved plan's objective as the session goal. */
	goalPrompt: boolean;
}

export const DEFAULT_CONFIG: PlanConfig = { goalPrompt: true };

/** Normalize one merged config object over the running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: PlanConfig): PlanConfig {
	if (!raw) return base;
	return { goalPrompt: typeof raw.goalPrompt === "boolean" ? raw.goalPrompt : base.goalPrompt };
}

/** Effective plan config from the shared `plan` section (defaults, global, project). */
export function loadConfig(cwd: string): PlanConfig {
	return loadConfigSection(cwd, "plan", DEFAULT_CONFIG, normalizeConfig);
}
