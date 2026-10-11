/**
 * Configuration for the doctor extension.
 *
 * Read from `~/.pi/agent/doctor.json` and `<cwd>/.pi/doctor.json`, project
 * values winning. A malformed file is ignored like everywhere else — `doctor`
 * is the extension that *reports* that, so it must not depend on parsing
 * cleanly itself.
 */

import { clampInteger, loadConfigFile } from "../../lib/config.ts";

/** How long a single probe may take before it counts as unusable. */
const DEFAULT_TIMEOUT_MS = 2_000;

export interface DoctorConfig {
	/** Probe enabled extensions at session start and warn when one is broken. */
	proactive: boolean;
	/** Per-probe timeout for one spawned command, in milliseconds. */
	timeoutMs: number;
	/** Extension names to leave out of every report. */
	skip: string[];
}

export const DEFAULT_CONFIG: DoctorConfig = {
	proactive: true,
	timeoutMs: DEFAULT_TIMEOUT_MS,
	skip: [],
};

/** Coerce a raw config object over `base`, ignoring anything unusable. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: DoctorConfig): DoctorConfig {
	if (!raw) return base;
	return {
		proactive: typeof raw.proactive === "boolean" ? raw.proactive : base.proactive,
		timeoutMs: clampInteger(raw.timeoutMs, base.timeoutMs, 100, 30_000),
		skip: Array.isArray(raw.skip)
			? raw.skip.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
			: base.skip,
	};
}

/** Load the effective config for `cwd`. */
export function loadConfig(cwd: string): DoctorConfig {
	return loadConfigFile(cwd, "doctor.json", DEFAULT_CONFIG, normalizeConfig);
}
