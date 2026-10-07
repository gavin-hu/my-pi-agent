/**
 * Session-scoped state and synchronization for the goal extension.
 *
 * The goal is reconstructed from the active branch on session start and tree
 * navigation, and the widget and status chip mirror it whenever it changes.
 * Only interactive (`tui`) sessions get a widget; the status chip and the tool
 * work in every mode.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { goalChip } from "./format.ts";
import { reconstructGoal } from "./state.ts";
import { GoalWidget, WIDGET_KEY } from "./tui.ts";
import type { Goal } from "./types.ts";

/** Status-bar key for the goal chip. */
export const STATUS_KEY = "goal";

export interface GoalRuntime {
	/** The current goal, or `null`. */
	getGoal(): Goal | null;
	/** Replace the goal and refresh the widget and status chip. */
	setGoal(goal: Goal | null, ctx?: ExtensionContext): void;
	/** Rebuild the goal from the active branch. */
	reconstruct(ctx: ExtensionContext): void;
	/** Remove the widget and status chip, for example on shutdown. */
	clear(ctx: ExtensionContext): void;
}

export function createGoalRuntime(): GoalRuntime {
	let goal: Goal | null = null;

	// `ctx.ui.theme` is a lazily-initialized global; in a headless run accessing
	// its properties throws, so the status chip degrades to plain text instead of
	// failing the tool call.
	const chip = (ctx: ExtensionContext, goal: Goal): string => {
		try {
			return goalChip(goal, ctx.ui.theme);
		} catch {
			return goalChip(goal);
		}
	};

	const sync = (ctx?: ExtensionContext): void => {
		if (!ctx) return;
		if (ctx.mode === "tui") {
			if (goal) {
				const snapshot = goal;
				ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new GoalWidget(snapshot, theme));
			} else {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
			}
		}
		ctx.ui.setStatus(STATUS_KEY, goal ? chip(ctx, goal) : undefined);
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
			ctx.ui.setStatus(STATUS_KEY, undefined);
		},
	};
}
