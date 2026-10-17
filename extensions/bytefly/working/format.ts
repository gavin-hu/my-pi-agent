/**
 * Pure text for the live working timer.
 *
 * Whole seconds, because the counter advances on a one-second tick: `0s` at the
 * start, `42s`, `1m05s`, `1h02m`. Negative and non-finite input reads as `0s`,
 * so a clock that steps backwards cannot print a negative count.
 */

import { WORKING_CONFIG } from "./config.ts";

/** Compact elapsed time in whole seconds: `0s`, `42s`, `1m05s`, `1h02m`. */
export function formatElapsed(ms: number): string {
	const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
	const seconds = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
	if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
	return `${seconds}s`;
}

/** The working-row message for an elapsed time, e.g. `Working… 4s`. */
export function workingCounter(ms: number): string {
	return `${WORKING_CONFIG.working}${WORKING_CONFIG.ellipsis} ${formatElapsed(ms)}`;
}
