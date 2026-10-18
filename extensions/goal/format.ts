/**
 * Model-facing and transcript text for the goal (pure).
 *
 * The transcript result is the status header (`Goal · active`) under the call
 * line, which already names the objective; the persistent widget is a plain
 * label-first line (`Goal · active · <objective>`) matching the `todo` and
 * `jobs` widgets. The status labels live here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import type { Goal, GoalStatus } from "./types.ts";

/** Longest objective preview shown in the transcript call line. */
const CALL_PREVIEW_WIDTH = 48;

/** Human label for a status, e.g. `active`. */
export function goalStatusLabel(status: GoalStatus): string {
	return status === "achieved" ? "achieved" : "active";
}

/**
 * Header row: `Goal · active` or `Goal · achieved`. The label is accented and
 * the status word is dim while active, success-colored once achieved.
 */
export function goalHeader(goal: Goal, theme: Theme): string {
	const label = paint(theme, "accent", "Goal");
	const separator = paint(theme, "faint", SEPARATORS.item);
	const word = goalStatusLabel(goal.status);
	const status = goal.status === "achieved" ? paint(theme, "ok", word) : paint(theme, "faint", word);
	return `${label}${separator}${status}`;
}

/**
 * One-line rail for the persistent widget:
 * `Goal · active · <objective>` or `Goal · achieved · <objective>`.
 * Label-first to match the `todo` and `jobs` widgets; no leading glyph.
 * Callers clip it to the available width.
 */
export function goalLine(goal: Goal, theme: Theme): string {
	const separator = paint(theme, "faint", SEPARATORS.item);
	const word = goalStatusLabel(goal.status);
	const status = goal.status === "achieved" ? paint(theme, "ok", word) : paint(theme, "faint", word);
	return `${paint(theme, "accent", "Goal")}${separator}${status}${separator}${goalObjective(goal, theme)}`;
}

/** Themed objective text: dim once achieved, normal while active. */
export function goalObjective(goal: Goal, theme: Theme): string {
	return goal.status === "achieved" ? paint(theme, "faint", goal.objective) : paint(theme, "label", goal.objective);
}

/**
 * Model-facing result text. `openTodos` counts the todo items the branch still
 * has open, so marking a goal achieved can point at work the list still holds.
 */
export function formatGoalText(goal: Goal | null, openTodos = 0): string {
	if (goal === null) return "Goal cleared.";
	if (goal.status === "achieved") {
		const text = `Goal achieved: ${goal.objective}`;
		if (openTodos <= 0) return text;
		const items = openTodos === 1 ? "1 todo item is" : `${openTodos} todo items are`;
		return `${text}\n${items} still open; close or clear the list if that work is done.`;
	}
	return `Goal: ${goal.objective}\nKeep this objective in mind as you work, and mark it achieved with the goal tool when it is done.`;
}

/** One-line notification text for the `/goal` command. */
export function formatGoalNotice(goal: Goal): string {
	return goal.status === "achieved" ? `Goal achieved: ${goal.objective}` : `Goal (active): ${goal.objective}`;
}

/**
 * First-run usage shown by a bare `/goal` with no goal set, and by
 * `/goal help`. A goal may already exist when `help` is used, so it never
 * claims the goal is unset.
 */
export const GOAL_HELP = [
	"Set a goal with /goal <what you want to accomplish> and start working on it.",
	"/goal raw <prompt> records your words verbatim, without confirming them first.",
	"/goal set <prompt> records the goal without starting work; /goal edit [<prompt>] changes it.",
	"/goal done (or achieved)  ·  /goal clear  ·  /goal help (or -h / --help)",
].join("\n");

/** Truncate an objective to `max` display columns, appending `…` when cut. */
export function previewObjective(objective: string, max = CALL_PREVIEW_WIDTH): string {
	// `strict` drops a wide grapheme that would cross the boundary, so the
	// slice plus ellipsis never exceeds `max` columns.
	return visibleWidth(objective) > max ? `${sliceByColumn(objective, 0, max - 1, true)}…` : objective;
}

/**
 * One-line body for the transcript call renderer.
 *
 * The renderer owns the styled `goal ` title, so this returns only the body.
 * `objective` is `undefined` while the call's arguments are still streaming,
 * which is distinct from an empty objective (a real clear). `argsComplete`
 * disambiguates the tail end of the stream.
 */
export function formatCallText(objective: string | undefined, argsComplete = true, status?: GoalStatus): string {
	if (objective === undefined) return argsComplete ? "→ clear" : "→ …";
	const text = objective.trim();
	if (!text) return status === "achieved" ? "→ achieve" : "→ clear";
	const verb = status === "achieved" ? "achieve" : "set";
	return `→ ${verb}: ${previewObjective(text)}`;
}
