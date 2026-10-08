/**
 * Session-scoped state and synchronization for the goal extension.
 *
 * The goal is reconstructed from the active branch on session start and tree
 * navigation, and the widget mirrors it whenever it changes. Only interactive
 * (`tui`) sessions get a widget; the tool works in every mode. The widget's row
 * budget and achieved-goal treatment come from the goal config.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { announceRailChanged } from "../_shared/rails.ts";
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

export function createGoalRuntime(pi?: Pick<ExtensionAPI, "events">): GoalRuntime {
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
		const options = { achieved: config.achieved };
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new GoalWidget(snapshot, theme, options));
		// The goal is the upper rail; tell lower rails (todo) to re-assert so they
		// stay below it. Re-insertion always appends, so a stale goal update would
		// otherwise sink the goal under the list.
		if (pi) announceRailChanged(pi);
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
