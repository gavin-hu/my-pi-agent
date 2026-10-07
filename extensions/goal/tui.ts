/**
 * Terminal rendering for the goal.
 *
 * `goalWidgetLines` is the shared block layout used by the persistent widget;
 * it prefixes every row with the dim `| ` bar and caps the block so it cannot
 * crowd the editor. `GoalWidget` is the tiny non-interactive component that
 * `ctx.ui.setWidget()` mounts.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { goalHeader, goalObjective, ROW_PREFIX } from "./format.ts";
import type { Goal } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "goal-widget";

/** Total rows in the widget, including the header and any ellipsis row. */
const MAX_ROWS = 3;

/** Rows for the goal block, bounded so it cannot crowd the editor. */
export function goalWidgetLines(goal: Goal, theme: Theme, width: number): string[] {
	const w = Math.max(1, width);
	const inner = Math.max(1, w - visibleWidth(ROW_PREFIX));
	const prefix = theme.fg("dim", ROW_PREFIX);

	const wrapped = wrapTextWithAnsi(goalObjective(goal, theme), inner);
	const budget = MAX_ROWS - 1;
	const shown = wrapped.slice(0, budget);
	if (wrapped.length > budget && shown.length > 0) {
		shown[shown.length - 1] = truncateToWidth(`${shown[shown.length - 1]}…`, inner);
	}

	const lines = [goalHeader(goal, theme), ...shown.map((line) => `${prefix}${line}`)];
	return lines.map((line) => truncateToWidth(line, w));
}

/** Persistent widget body shown above the editor whenever a goal exists. */
export class GoalWidget implements Component {
	constructor(
		private readonly goal: Goal,
		private readonly theme: Theme,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		return goalWidgetLines(this.goal, this.theme, Math.max(1, width));
	}
}
