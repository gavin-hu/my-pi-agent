/**
 * Session-scoped state and synchronization for the goal extension.
 *
 * The goal is reconstructed from the active branch on session start and tree
 * navigation, and the widget mirrors it whenever it changes. Only interactive
 * (`tui`) sessions get a widget; the tool works in every mode. The widget's row
 * budget and achieved-goal treatment come from the goal config.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_GOAL_CONFIG, type GoalConfig } from "./config.ts";
import { reconstructGoal } from "./state.ts";
import { GoalWidget, WIDGET_KEY } from "./tui.ts";
import type { Goal } from "./types.ts";

export interface GoalRuntime {
	/** The current goal, or `null`. */
	getGoal(): Goal | null;
	/** Replace the goal and refresh the widget. */
	setGoal(goal: Goal | null, ctx?: ExtensionContext): void;
	/** Rebuild the goal from the active branch. */
	reconstruct(ctx: ExtensionContext): void;
	/** Apply the widget config (loaded per session). */
	setConfig(config: GoalConfig): void;
	/** Remove the widget, for example on shutdown. */
	clear(ctx: ExtensionContext): void;
}

export function createGoalRuntime(): GoalRuntime {
	let goal: Goal | null = null;
	let config: GoalConfig = DEFAULT_GOAL_CONFIG;

	const sync = (ctx?: ExtensionContext): void => {
		if (!ctx || ctx.mode !== "tui") return;
		const current = goal;
		if (!current || (current.status === "achieved" && config.achieved === "hide")) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		const snapshot = current;
		const options = { maxRows: config.maxRows, achieved: config.achieved };
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new GoalWidget(snapshot, theme, options));
	};

	return {
		getGoal: () => goal,
		setGoal: (next, ctx) => {
			goal = next;
			sync(ctx);
		},
		reconstruct: (ctx) => {
			goal = reconstructGoal(ctx.sessionManager.getBranch());
			sync(ctx);
		},
		setConfig: (next) => {
			config = next;
		},
		clear: (ctx) => {
			goal = null;
			if (!ctx) return;
			if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		},
	};
}
