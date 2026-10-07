/**
 * Model-facing and transcript text for the goal (pure).
 *
 * The active goal is drawn as a quoted block: a dim `| ` bar prefixes every
 * row, then the status glyph, then the objective. `| ◎` marks an active goal
 * and `| ✓` an achieved one. The symbols and prefix live here so the widget,
 * the status chip, and the transcript renderer all agree.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import type { Goal } from "./types.ts";

/** Left bar that makes the goal read as a quoted block. */
export const ROW_PREFIX = "| ";

/** Active-goal glyph. */
export const ACTIVE_SYMBOL = "◎";
/** Achieved-goal glyph. */
export const ACHIEVED_SYMBOL = "✓";

/** Longest objective preview shown in the transcript call line. */
const CALL_PREVIEW_WIDTH = 48;

/** Themed status glyph, shared by the widget and the transcript renderer. */
export function goalGlyph(goal: Goal, theme: Theme): string {
	return goal.status === "achieved" ? theme.fg("success", ACHIEVED_SYMBOL) : theme.fg("accent", ACTIVE_SYMBOL);
}

/** Header row: `| ◎ Goal` (optionally with the status label) or `| ✓ Goal achieved`. */
export function goalHeader(goal: Goal, theme: Theme, withStatus = false): string {
	const prefix = theme.fg("dim", ROW_PREFIX);
	const symbol = goalGlyph(goal, theme);
	if (goal.status === "achieved") {
		return `${prefix}${symbol} ${theme.fg("success", "Goal achieved")}`;
	}
	const status = withStatus ? `  ${theme.fg("dim", "active")}` : "";
	return `${prefix}${symbol} ${theme.fg("accent", "Goal")}${status}`;
}

/** Themed objective text: dim once achieved, normal while active. */
export function goalObjective(goal: Goal, theme: Theme): string {
	return goal.status === "achieved" ? theme.fg("dim", goal.objective) : theme.fg("text", goal.objective);
}

/** Short status chip shown by the status bar, e.g. `| ◎ goal`.
 *
 * `theme` is optional because a headless run has no initialized theme; the
 * chip then falls back to plain text rather than throwing. */
export function goalChip(goal: Goal, theme?: Theme): string {
	const prefix = theme ? theme.fg("dim", ROW_PREFIX) : ROW_PREFIX;
	if (goal.status === "achieved") {
		const label = `${ACHIEVED_SYMBOL} goal`;
		return `${prefix}${theme ? theme.fg("success", label) : label}`;
	}
	const label = `${ACTIVE_SYMBOL} goal`;
	return `${prefix}${theme ? theme.fg("accent", label) : label}`;
}

/** Model-facing result text. */
export function formatGoalText(goal: Goal | null): string {
	if (goal === null) return "Goal cleared.";
	if (goal.status === "achieved") return `Goal achieved: ${goal.objective}`;
	return `Goal: ${goal.objective}\nKeep this objective in mind as you work, and mark it achieved with the goal tool when it is done.`;
}

/** One-line notification text for the `/goal` command. */
export function formatGoalNotice(goal: Goal): string {
	return goal.status === "achieved" ? `Goal achieved: ${goal.objective}` : `Goal (active): ${goal.objective}`;
}

/** Truncate an objective to `max` display columns, appending `…` when cut. */
export function previewObjective(objective: string, max = CALL_PREVIEW_WIDTH): string {
	return visibleWidth(objective) > max ? `${sliceByColumn(objective, 0, max - 1)}…` : objective;
}

/**
 * One-line summary for the transcript call renderer.
 *
 * `objective` is `undefined` while the call's arguments are still streaming,
 * which is distinct from an empty objective (a real clear). `argsComplete`
 * disambiguates the tail end of the stream.
 */
export function formatCallText(objective: string | undefined, argsComplete = true): string {
	if (objective === undefined) return argsComplete ? "goal → clear" : "goal → …";
	const text = objective.trim();
	if (!text) return "goal → clear";
	return `goal → set: ${previewObjective(text)}`;
}
