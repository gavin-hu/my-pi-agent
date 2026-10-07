/**
 * Terminal rendering for the goal.
 *
 * `goalRailLines` is the shared layout: a header (`Goal · active`) plus the
 * objective wrapped and led by the status glyph, with continuation rows aligned
 * under the text. It matches the todo widget's indent + glyph grammar so the
 * two read as a pair. `goalWidgetLines` caps the rail for the persistent widget;
 * `GoalResult` reuses it uncapped for the transcript.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import {
	BODY_INDENT,
	GLYPH_GAP,
	goalAchievedLine,
	goalGlyph,
	goalHeader,
	goalObjective,
} from "./format.ts";
import { DEFAULT_MAX_ROWS, type AchievedStyle, type Goal } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "goal-widget";

export interface GoalWidgetOptions {
	/** Total rows the rail may occupy, including the header. */
	maxRows?: number;
	/** `collapse` to one dim line, `block` to the rail, `hide` to no widget. */
	achieved?: AchievedStyle;
}

interface GoalRailOptions {
	/** Cap the rail at this many rows (header included), marking overflow. */
	maxRows?: number;
}

/**
 * Rows for a goal rail: the themed header plus `body` wrapped and led by the
 * status glyph. Continuation rows are padded to the text column. With `maxRows`
 * the rail is capped and a final dim `…` row marks the overflow, matching the
 * todo widget's overflow row.
 */
export function goalRailLines(
	goal: Goal,
	body: string,
	theme: Theme,
	width: number,
	options: GoalRailOptions = {},
): string[] {
	const w = Math.max(1, width);
	const glyph = goalGlyph(goal, theme);
	const glyphWidth = visibleWidth(glyph);
	const textColumn = BODY_INDENT + glyphWidth + GLYPH_GAP;
	const inner = Math.max(1, w - textColumn);

	const wrapped = wrapTextWithAnsi(body, inner);
	const maxRows = options.maxRows;
	const hasMore = maxRows !== undefined && wrapped.length > maxRows - 1;
	const shown = hasMore ? wrapped.slice(0, Math.max(0, maxRows - 2)) : wrapped;

	const pad = " ".repeat(BODY_INDENT);
	const continuation = " ".repeat(textColumn);
	const lines = [goalHeader(goal, theme)];
	shown.forEach((line, index) => {
		lines.push(index === 0 ? `${pad}${glyph}${" ".repeat(GLYPH_GAP)}${line}` : `${continuation}${line}`);
	});
	if (hasMore) lines.push(theme.fg("dim", `${pad}…`));
	return lines.map((line) => truncateToWidth(line, w, "…"));
}

/** Rows for the goal widget, bounded so it cannot crowd the editor. */
export function goalWidgetLines(
	goal: Goal,
	theme: Theme,
	width: number,
	options: GoalWidgetOptions = {},
): string[] {
	const w = Math.max(1, width);
	if (goal.status === "achieved") {
		const style = options.achieved ?? "collapse";
		if (style === "hide") return [];
		if (style === "collapse") return [truncateToWidth(goalAchievedLine(goal, theme), w, "…")];
	}
	return goalRailLines(goal, goalObjective(goal, theme), theme, w, {
		maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
	});
}

/** Persistent widget body shown above the editor whenever a goal exists. */
export class GoalWidget implements Component {
	constructor(
		private readonly goal: Goal,
		private readonly theme: Theme,
		private readonly options: GoalWidgetOptions = {},
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		return goalWidgetLines(this.goal, this.theme, Math.max(1, width), this.options);
	}
}

/** Transcript result block: the rail, uncapped, with the themed body. */
export class GoalResult implements Component {
	constructor(
		private readonly goal: Goal,
		private readonly body: string,
		private readonly theme: Theme,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		return goalRailLines(this.goal, this.body, this.theme, Math.max(1, width));
	}
}
