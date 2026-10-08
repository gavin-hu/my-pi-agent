/**
 * Configuration for the jobs extension.
 *
 * Merged from `~/.pi/agent/jobs.json` (global) and `<cwd>/.pi/jobs.json`
 * (project). Project values win. Missing or malformed files are ignored, and
 * every value is clamped to a safe range.
 */

import { clampInteger, cleanString, loadConfigFile } from "../_shared/config.ts";

export interface JobsConfig {
	/** Track jobs at all. Default: true. */
	enabled: boolean;
	/** Show a `▸N` status chip while jobs run. */
	showStatus: boolean;
	/** Show the jobs widget above the editor while jobs run. */
	showWidget: boolean;
	/** Wake the agent with one triggered turn when any job finishes. */
	wakeOnFinish: boolean;
	/** Leave jobs running when the session ends unless a job opts out. */
	detachedByDefault: boolean;
	/** Finished jobs kept in the registry before the oldest are pruned. */
	maxJobs: number;
	/** Log lines returned to the model by the `logs` action. */
	maxLogLines: number;
	/** Grace period before a SIGTERM escalates to SIGKILL. */
	killGraceMs: number;
	/** Widget repaint interval while jobs run. */
	repaintMs: number;
	/** How long a session heartbeat is trusted before its jobs are reaped. */
	sessionTtlMs: number;
	/** Override for the registry directory; defaults under the agent dir. */
	registryDir: string | undefined;
}

export const DEFAULT_CONFIG: JobsConfig = {
	enabled: true,
	showStatus: true,
	showWidget: true,
	wakeOnFinish: false,
	detachedByDefault: false,
	maxJobs: 20,
	maxLogLines: 100,
	killGraceMs: 5000,
	repaintMs: 1000,
	sessionTtlMs: 60_000,
	registryDir: undefined,
};

/** Normalize one merged config object over the running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: JobsConfig): JobsConfig {
	if (!raw) return base;
	const registryDir = cleanString(raw.registryDir, "");
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
		showStatus: typeof raw.showStatus === "boolean" ? raw.showStatus : base.showStatus,
		showWidget: typeof raw.showWidget === "boolean" ? raw.showWidget : base.showWidget,
		wakeOnFinish: typeof raw.wakeOnFinish === "boolean" ? raw.wakeOnFinish : base.wakeOnFinish,
		detachedByDefault: typeof raw.detachedByDefault === "boolean" ? raw.detachedByDefault : base.detachedByDefault,
		maxJobs: clampInteger(raw.maxJobs, base.maxJobs, 1, 500),
		maxLogLines: clampInteger(raw.maxLogLines, base.maxLogLines, 1, 5000),
		killGraceMs: clampInteger(raw.killGraceMs, base.killGraceMs, 0, 60_000),
		repaintMs: clampInteger(raw.repaintMs, base.repaintMs, 100, 10_000),
		sessionTtlMs: clampInteger(raw.sessionTtlMs, base.sessionTtlMs, 5_000, 600_000),
		registryDir: registryDir || undefined,
	};
}

/** Load the effective config for a working directory. */
export function loadConfig(cwd: string): JobsConfig {
	return loadConfigFile(cwd, "jobs.json", DEFAULT_CONFIG, normalizeConfig);
}
