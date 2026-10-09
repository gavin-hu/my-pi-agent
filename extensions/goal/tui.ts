/**
 * Terminal rendering for the goal.
 *
 * Two surfaces share one vocabulary. `goalWidgetLines` renders the persistent
 * above-editor widget as a single label-first rail line (`Goal · active ·
 * <objective>`, dimmed once achieved), matching the `todo` and `jobs` widgets.
 * `goalRailLines` renders the transcript result as a header (`Goal · active`)
 * plus the objective wrapped and led by the status glyph, with continuation rows
 * aligned under the text; it matches the todo transcript result's indent + glyph
 * grammar so the two read as a pair.
 * `GoalResult` wraps `goalRailLines` uncapped for the transcript.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { BODY_INDENT, GLYPH_GAP } from "../../lib/ui.ts";
import { goalGlyph, goalHeader, goalLine } from "./format.ts";
import type { AchievedStyle, Goal } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "goal-widget";

export interface GoalWidgetOptions {
	/** `hide` removes an achieved goal; `show` renders the one-line rail. */
	achieved?: AchievedStyle;
}

/**
 * Rows for the transcript goal rail: the themed header plus `body` wrapped and
 * led by the status glyph. Continuation rows are padded to the text column.
 */
export function goalRailLines(goal: Goal, body: string, theme: Theme, width: number): string[] {
	const w = Math.max(1, width);
	const glyph = goalGlyph(goal, theme);
	const glyphWidth = visibleWidth(glyph);
	const textColumn = BODY_INDENT + glyphWidth + GLYPH_GAP;
	const inner = Math.max(1, w - textColumn);

	const wrapped = wrapTextWithAnsi(body, inner);
	const pad = " ".repeat(BODY_INDENT);
	const continuation = " ".repeat(textColumn);
	const lines = [goalHeader(goal, theme)];
	wrapped.forEach((line, index) => {
		lines.push(index === 0 ? `${pad}${glyph}${" ".repeat(GLYPH_GAP)}${line}` : `${continuation}${line}`);
	});
	return lines.map((line) => truncateToWidth(line, w, "…"));
}

/** Rows for the goal widget: a single rail line, or nothing when hidden. */
export function goalWidgetLines(goal: Goal, theme: Theme, width: number, options: GoalWidgetOptions = {}): string[] {
	const w = Math.max(1, width);
	if (goal.status === "achieved" && options.achieved === "hide") return [];
	return [truncateToWidth(goalLine(goal, theme), w, "…")];
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
