/**
 * Config-file support for the goal widget.
 *
 * The `goal` section of the shared `bytefly.json` (global then project, project
 * wins). Only the widget
 * presentation is configurable — goal behavior never depends on it.
 */

import { loadConfigSection } from "../../lib/config.ts";
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

/** Effective goal config from the shared `goal` section (defaults, global, project, env). */
export function loadGoalConfig(cwd: string): GoalConfig {
	return loadConfigSection(cwd, "goal", DEFAULT_GOAL_CONFIG, normalizeGoalConfig);
}
