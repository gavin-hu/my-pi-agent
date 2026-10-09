/**
 * Config-file support for the goal widget.
 *
 * Read from `~/.pi/agent/goal.json` and `<cwd>/.pi/goal.json`; project values
 * override global ones, and missing or malformed files are ignored. Only the
 * widget presentation is configurable — goal behavior never depends on it.
 */

import { loadConfigFile } from "../../lib/config.ts";
import type { AchievedStyle } from "./types.ts";

export interface GoalConfig {
	/** How an achieved goal renders: the one-line rail, or hidden. */
	achieved: AchievedStyle;
}

export const DEFAULT_GOAL_CONFIG: GoalConfig = { achieved: "hide" };

const ACHIEVED_STYLES: readonly AchievedStyle[] = ["show", "hide"];

function normalizeAchieved(value: unknown, fallback: AchievedStyle): AchievedStyle {
	const style = typeof value === "string" ? value.trim().toLowerCase() : "";
	return (ACHIEVED_STYLES as readonly string[]).includes(style) ? (style as AchievedStyle) : fallback;
}

/** Validate a raw config object over `base`. */
export function normalizeGoalConfig(raw: Record<string, unknown> | undefined, base: GoalConfig): GoalConfig {
	if (!raw) return base;
	return { achieved: normalizeAchieved(raw.achieved, base.achieved) };
}

/** Effective goal config for `cwd` (global file, then project file, over defaults). */
export function loadGoalConfig(cwd: string): GoalConfig {
	return loadConfigFile(cwd, "goal.json", DEFAULT_GOAL_CONFIG, normalizeGoalConfig);
}
