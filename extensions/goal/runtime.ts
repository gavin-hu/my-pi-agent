/**
 * Session-scoped state and synchronization for the goal extension.
 *
 * The goal is reconstructed from the active branch on session start and tree
 * navigation, and the widget mirrors it whenever it changes. Only interactive
 * (`tui`) sessions get a widget; the tool works in every mode.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
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
	/** Remove the widget, for example on shutdown. */
	clear(ctx: ExtensionContext): void;
}

export function createGoalRuntime(): GoalRuntime {
	let goal: Goal | null = null;

	const sync = (ctx?: ExtensionContext): void => {
		if (!ctx || ctx.mode !== "tui") return;
		if (goal) {
			const snapshot = goal;
			ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new GoalWidget(snapshot, theme));
		} else {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		}
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
		clear: (ctx) => {
			goal = null;
			if (!ctx) return;
			if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		},
	};
}
