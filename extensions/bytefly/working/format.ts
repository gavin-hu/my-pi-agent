/**
 * Pure text for the live working line.
 *
 * A plain count while the run has started nothing (`working · 42s`), then how
 * many top-level tools this run has started and the elapsed time
 * (`working · 3 tools · 42s`). The line no longer names the tool: it is one word
 * a reader can skim, and the transcript already draws each call as its own block.
 * Whole seconds, because the tick advances once a second; negative and
 * non-finite input reads as `0s`.
 */

import { formatToolCount } from "../../../lib/format.ts";
import { SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { WORKING_CONFIG } from "./config.ts";

/** What the current run has done so far, for the live line. */
export interface WorkingRun {
	/** Top-level tool calls started in this run. */
	readonly tools: number;
}

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

/** The working line's message: `working · 4s`, then `working · 3 tools · 4s`. */
export function workingCounter(ms: number, run?: WorkingRun): string {
	const elapsed = formatElapsed(ms);
	const tools = run?.tools ?? 0;
	const count = tools > 0 ? formatToolCount(tools) : "";
	return [WORKING_CONFIG.working, count, elapsed].filter((part) => part !== "").join(SEPARATORS.item);
}
