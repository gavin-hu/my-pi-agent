/**
 * Configuration for bytefly's doctor surface.
 *
 * Read from the top-level `doctor` section of the shared `bytefly.json` — the
 * same document the footer's price calculation and the notify capability read,
 * under `~/.pi/agent/` and `<cwd>/.pi` with project values winning. A malformed
 * document is
 * ignored like everywhere else — `doctor` is the extension that *reports* that,
 * so it must not depend on parsing cleanly itself.
 */

import { clampInteger, loadConfigSection } from "../../../lib/config.ts";

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

/** Validate the `doctor` section over `base`. Total: never throws, never guesses. */
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

/** Effective doctor config for `cwd` (defaults, then the shared `doctor` section, then env). */
export function loadConfig(cwd: string): DoctorConfig {
	return loadConfigSection(cwd, "doctor", DEFAULT_CONFIG, normalizeConfig);
}
