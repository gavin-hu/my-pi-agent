/**
 * Config-file support for the goal widget.
 *
 * Read from `~/.pi/agent/goal.json` and `<cwd>/.pi/goal.json`; project values
 * override global ones, and missing or malformed files are ignored. Only the
 * widget presentation is configurable — goal behavior never depends on it.
 */

import { clampInteger, loadConfigFile } from "../_shared/config.ts";
import { DEFAULT_MAX_ROWS, type AchievedStyle } from "./types.ts";

export interface GoalConfig {
	/** Total widget rows, including the header. */
	maxRows: number;
	/** How an achieved goal renders: collapsed, as a block, or hidden. */
	achieved: AchievedStyle;
}

export const DEFAULT_GOAL_CONFIG: GoalConfig = { maxRows: DEFAULT_MAX_ROWS, achieved: "collapse" };

/** Smallest/largest widget row budget that still shows the objective. */
export const MIN_MAX_ROWS = 3;
export const MAX_MAX_ROWS = 6;

const ACHIEVED_STYLES: readonly AchievedStyle[] = ["collapse", "block", "hide"];

function normalizeAchieved(value: unknown, fallback: AchievedStyle): AchievedStyle {
	const style = typeof value === "string" ? value.trim().toLowerCase() : "";
	return (ACHIEVED_STYLES as readonly string[]).includes(style) ? (style as AchievedStyle) : fallback;
}

/** Validate/clamp a raw config object over `base`. */
export function normalizeGoalConfig(raw: Record<string, unknown> | undefined, base: GoalConfig): GoalConfig {
	if (!raw) return base;
	return {
		maxRows: clampInteger(raw.maxRows, base.maxRows, MIN_MAX_ROWS, MAX_MAX_ROWS),
		achieved: normalizeAchieved(raw.achieved, base.achieved),
	};
}

/** Effective goal config for `cwd` (global file, then project file, over defaults). */
export function loadGoalConfig(cwd: string): GoalConfig {
	return loadConfigFile(cwd, "goal.json", DEFAULT_GOAL_CONFIG, normalizeGoalConfig);
}
