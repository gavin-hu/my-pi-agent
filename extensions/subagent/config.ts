/**
 * Config-file support for subagent runs.
 *
 * The `subagent` section of the shared `bytefly.json` (global then project,
 * project wins). Only the container is configurable — a run's deadline and how
 * many background children may run at once — never an agent's prompt or tools.
 */

import { clampInteger, loadConfigSection } from "../../lib/config.ts";

export interface SubagentConfig {
	/** Wall-clock limit for one child run in ms; `0` disables it. */
	timeoutMs: number;
	/** Background children allowed to run at once. */
	backgroundMax: number;
}

export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
	timeoutMs: 600_000,
	backgroundMax: 4,
};

/** Validate a raw config object over `base`. */
export function normalizeSubagentConfig(
	raw: Record<string, unknown> | undefined,
	base: SubagentConfig,
): SubagentConfig {
	if (!raw) return base;
	return {
		timeoutMs: clampInteger(raw.timeoutMs, base.timeoutMs, 0, 3_600_000),
		backgroundMax: clampInteger(raw.backgroundMax, base.backgroundMax, 1, 8),
	};
}

/** Effective subagent config from the shared `subagent` section. */
export function loadSubagentConfig(cwd: string): SubagentConfig {
	return loadConfigSection(cwd, "subagent", DEFAULT_SUBAGENT_CONFIG, normalizeSubagentConfig);
}
