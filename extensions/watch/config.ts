/**
 * Configuration for the watch extension.
 *
 * The `watch` section of the shared `bytefly.json` (global then project,
 * project wins). Missing or malformed documents are ignored, and every value is
 * clamped to a safe range.
 */

import { clampInteger, loadConfigSection } from "../../lib/config.ts";

export interface WatchConfig {
	/** Allow starting watchers; false refuses `add`. Default: true. */
	enabled: boolean;
	/** Show the status chips while watchers run or a match is unreported. */
	showStatus: boolean;
	/** Wake the agent with one triggered turn when any watcher matches. */
	wakeOnMatch: boolean;
	/** Live watchers kept before `add` is refused. */
	maxWatchers: number;
	/** Matches kept per watcher before the oldest are dropped. */
	maxMatches: number;
	/** Raw lines kept per watcher for the `logs` action. */
	maxLogLines: number;
	/** Lines returned to the model by `matches`/`logs` when unspecified. */
	matchLines: number;
	/**
	 * Longest prefix of a line a pattern or exclude is run against.
	 *
	 * A pattern is model-authored and matched synchronously on the poll clock, so the input it
	 * is handed is a budget: `LineSplitter` emits up to 1 MiB per line, while every surface
	 * clips a line to 200 characters before printing it.
	 */
	matchChars: number;
	/** File poll interval. */
	pollMs: number;
}

export const DEFAULT_CONFIG: WatchConfig = {
	enabled: true,
	showStatus: true,
	wakeOnMatch: false,
	maxWatchers: 20,
	maxMatches: 200,
	maxLogLines: 500,
	matchLines: 50,
	matchChars: 16_384,
	pollMs: 500,
};

/** Normalize one merged config object over the running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: WatchConfig): WatchConfig {
	if (!raw) return base;
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
		showStatus: typeof raw.showStatus === "boolean" ? raw.showStatus : base.showStatus,
		wakeOnMatch: typeof raw.wakeOnMatch === "boolean" ? raw.wakeOnMatch : base.wakeOnMatch,
		maxWatchers: clampInteger(raw.maxWatchers, base.maxWatchers, 1, 200),
		maxMatches: clampInteger(raw.maxMatches, base.maxMatches, 1, 5000),
		maxLogLines: clampInteger(raw.maxLogLines, base.maxLogLines, 1, 5000),
		matchLines: clampInteger(raw.matchLines, base.matchLines, 1, 2000),
		// Never above 1 MiB, the largest line the splitter emits, so the cap is a bound and
		// not a wish; never below a screenful, so a reader's line still matches whole.
		matchChars: clampInteger(raw.matchChars, base.matchChars, 1_024, 262_144),
		pollMs: clampInteger(raw.pollMs, base.pollMs, 100, 60_000),
	};
}

/** Load the effective config for a working directory. */
export function loadConfig(cwd: string): WatchConfig {
	return loadConfigSection(cwd, "watch", DEFAULT_CONFIG, normalizeConfig);
}
