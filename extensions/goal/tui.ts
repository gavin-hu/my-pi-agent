/**
 * Terminal rendering for the goal.
 *
 * Two surfaces share one vocabulary. The persistent above-editor widget is a
 * single label-first rail line (`Goal · active · <objective>`, dimmed once
 * achieved), matching the `todo` and `jobs` widgets. The transcript result is
 * the status header alone (`Goal · active`): the call line already names the
 * objective, so the result only states the new status.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { goalHeader, goalLine } from "./format.ts";
import type { AchievedStyle, Goal } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "goal-widget";

export interface GoalWidgetOptions {
	/** `hide` removes an achieved goal; `show` renders the one-line rail. */
	achieved?: AchievedStyle;
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

/** Transcript result block: the status header, separated from the call line. */
export class GoalResult implements Component {
	private goal: Goal;
	private theme: Theme;

	constructor(goal: Goal, theme: Theme) {
		this.goal = goal;
		this.theme = theme;
	}

	/** Update in place so the transcript can reuse this component across renders. */
	update(goal: Goal, theme: Theme): void {
		this.goal = goal;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		// The leading blank line separates the header from the call line, matching
		// the built-ins' header/output gap.
		return ["", truncateToWidth(goalHeader(this.goal, this.theme), Math.max(1, width), "…")];
	}
}
