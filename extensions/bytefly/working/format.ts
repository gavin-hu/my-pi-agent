/**
 * Pure text for the live working line.
 *
 * Before the first tool starts it is a plain count (`Working… 42s`). After that
 * it names the last top-level tool and how many this run has started, then the
 * elapsed time (`edit · 3 tools · 42s`). Whole seconds, because the tick
 * advances once a second; negative and non-finite input reads as `0s`.
 */

import { sanitizeLine } from "../../../lib/format.ts";
import { SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { WORKING_CONFIG } from "./config.ts";

/** What the current run has done so far, for the live line. */
export interface WorkingRun {
	/** The last top-level tool started, or `null` before the first one. */
	readonly tool: string | null;
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

/** The working-row message: `Working… 4s` until a tool starts, then the run line. */
export function workingCounter(ms: number, run?: WorkingRun): string {
	const elapsed = formatElapsed(ms);
	const tools = run?.tools ?? 0;
	const tool = run?.tool ? sanitizeLine(run.tool) : "";
	if (tools > 0) {
		const word = tools === 1 ? WORKING_CONFIG.tool : WORKING_CONFIG.tools;
		return [tool, `${tools} ${word}`, elapsed].filter((part) => part !== "").join(SEPARATORS.item);
	}
	return `${WORKING_CONFIG.working}${WORKING_CONFIG.ellipsis} ${elapsed}`;
}
