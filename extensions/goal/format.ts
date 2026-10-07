/**
 * Model-facing and transcript text for the goal (pure).
 *
 * The active goal is drawn as a quoted block: a dim `| ` bar prefixes every
 * row, then the status glyph, then the objective. `| ◎` marks an active goal
 * and `| ✓` an achieved one. The symbols and prefix live here so the widget
 * and the transcript renderer agree.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import type { Goal, GoalStatus } from "./types.ts";

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
	// `strict` drops a wide grapheme that would cross the boundary, so the
	// slice plus ellipsis never exceeds `max` columns.
	return visibleWidth(objective) > max ? `${sliceByColumn(objective, 0, max - 1, true)}…` : objective;
}

/**
 * One-line summary for the transcript call renderer.
 *
 * `objective` is `undefined` while the call's arguments are still streaming,
 * which is distinct from an empty objective (a real clear). `argsComplete`
 * disambiguates the tail end of the stream.
 */
export function formatCallText(objective: string | undefined, argsComplete = true, status?: GoalStatus): string {
	if (objective === undefined) return argsComplete ? "goal → clear" : "goal → …";
	const text = objective.trim();
	if (!text) return "goal → clear";
	const verb = status === "achieved" ? "achieve" : "set";
	return `goal → ${verb}: ${previewObjective(text)}`;
}
