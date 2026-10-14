/**
 * Configuration for bytefly's doctor surface.
 *
 * Read from the `doctor` section of `bytefly.json` — the same file the footer's
 * price calculation and the notify capability read, under `~/.pi/agent/` and
 * `<cwd>/.pi` with project values winning. Each section is parsed by its own
 * normalizer, so a wrong-typed value under `doctor` never reaches the price or
 * notify sections. A malformed file is ignored like everywhere else — `doctor`
 * is the extension that *reports* that, so it must not depend on parsing cleanly
 * itself.
 */

import { asRecord, clampInteger, loadConfigFile } from "../../../lib/config.ts";
import { BYTEFLY_CONFIG_FILE } from "../config.ts";

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

/** Validate the `doctor` object over `base`. Total: never throws, never guesses. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: DoctorConfig): DoctorConfig {
	const value = asRecord(raw?.doctor);
	if (!value) return base;
	return {
		proactive: typeof value.proactive === "boolean" ? value.proactive : base.proactive,
		timeoutMs: clampInteger(value.timeoutMs, base.timeoutMs, 100, 30_000),
		skip: Array.isArray(value.skip)
			? value.skip.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
			: base.skip,
	};
}

/** Effective doctor config for `cwd` (defaults, then the global file, then the project file). */
export function loadConfig(cwd: string): DoctorConfig {
	return loadConfigFile(cwd, BYTEFLY_CONFIG_FILE, DEFAULT_CONFIG, normalizeConfig);
}
