/**
 * Configuration for the check extension.
 *
 * The `check` section of the shared `bytefly.json` (global then project, project
 * wins). Missing or malformed documents are ignored, and every value is clamped
 * to a safe range.
 */

import { clampInteger, cleanString, loadConfigSection } from "../../lib/config.ts";

export interface CheckConfig {
	/** Shell command used instead of detection for every target. Empty = detect. */
	command: string;
	/** Wall-clock limit for one command; 0 disables it. */
	timeoutMs: number;
	/** Bytes of output retained per command. */
	maxLogBytes: number;
}

export const DEFAULT_CONFIG: CheckConfig = {
	command: "",
	timeoutMs: 600_000,
	maxLogBytes: 1_048_576,
};

/** Normalize one merged config object over the running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: CheckConfig): CheckConfig {
	if (!raw) return base;
	return {
		command: cleanString(raw.command, base.command),
		timeoutMs: clampInteger(raw.timeoutMs, base.timeoutMs, 0, 3_600_000),
		maxLogBytes: clampInteger(raw.maxLogBytes, base.maxLogBytes, 65_536, 16_777_216),
	};
}

/** Load the effective config for a working directory. */
export function loadConfig(cwd: string): CheckConfig {
	return loadConfigSection(cwd, "check", DEFAULT_CONFIG, normalizeConfig);
}
