/**
 * Terminal rendering for the goal.
 *
 * `goalBlockLines` is the shared block layout: it wraps the body to the
 * available width and prefixes every physical row with the dim `| ` bar so the
 * goal reads as one quoted block. `goalWidgetLines` caps the block for the
 * persistent widget; `GoalResult` reuses it uncapped for the transcript.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { goalHeader, goalObjective, ROW_PREFIX } from "./format.ts";
import type { Goal } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "goal-widget";

/** Total rows in the widget, including the header and any ellipsis row. */
const MAX_ROWS = 3;

interface GoalBlockOptions {
	/** Show the `active` suffix on an active header (the transcript does). */
	withStatus?: boolean;
	/** Cap the block at this many rows, marking the overflow with `…`. */
	maxRows?: number;
}

/**
 * Rows for a goal block: the themed header plus `body` wrapped and prefixed
 * with the dim `| ` bar on every row. With `maxRows` the block is capped and
 * the last shown row ends in `…`; without it every wrapped row is shown.
 */
export function goalBlockLines(
	goal: Goal,
	body: string,
	theme: Theme,
	width: number,
	options: GoalBlockOptions = {},
): string[] {
	const w = Math.max(1, width);
	const inner = Math.max(1, w - visibleWidth(ROW_PREFIX));
	const prefix = theme.fg("dim", ROW_PREFIX);

	const wrapped = wrapTextWithAnsi(body, inner);
	const budget = options.maxRows === undefined ? wrapped.length : Math.max(1, options.maxRows - 1);
	const shown = wrapped.slice(0, budget);
	if (options.maxRows !== undefined && wrapped.length > budget && shown.length > 0) {
		shown[shown.length - 1] = truncateToWidth(`${shown[shown.length - 1]}…`, inner, "…");
	}

	const lines = [goalHeader(goal, theme, options.withStatus ?? false), ...shown.map((line) => `${prefix}${line}`)];
	return lines.map((line) => truncateToWidth(line, w, "…"));
}

/** Rows for the goal block, bounded so it cannot crowd the editor. */
export function goalWidgetLines(goal: Goal, theme: Theme, width: number): string[] {
	return goalBlockLines(goal, goalObjective(goal, theme), theme, width, { maxRows: MAX_ROWS });
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

/** Transcript result block: the widget's quoted layout, uncapped and with the status suffix. */
export class GoalResult implements Component {
	constructor(
		private readonly goal: Goal,
		private readonly body: string,
		private readonly theme: Theme,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		return goalBlockLines(this.goal, this.body, this.theme, Math.max(1, width), { withStatus: true });
	}
}
