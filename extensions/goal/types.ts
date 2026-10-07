/**
 * Shared types for the goal extension.
 *
 * A session has at most one goal, and the model sets it as a whole value the
 * way `todo` replaces its list: the objective is the complete text, and an
 * empty objective clears the goal. There is no id and no per-field mutation.
 */

export const GOAL_STATUSES = ["active", "achieved"] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Custom-entry type used to persist a goal set outside the tool (the `/goal` command). */
export const GOAL_ENTRY_TYPE = "goal";

/** How an achieved goal renders in the persistent widget. */
export type AchievedStyle = "collapse" | "block" | "hide";

/** Default total rows for the persistent goal widget, header included. */
export const DEFAULT_MAX_ROWS = 3;

/** The single session goal. */
export interface Goal {
	/** The objective, sanitized to a single line. */
	objective: string;
	/**
	 * `active` while the goal should steer the agent and be re-injected each
	 * turn; `achieved` once it is done (kept visible, no longer reminded).
	 */
	status: GoalStatus;
}

/** What a call did, used by the transcript renderer. */
export type GoalAction = "set" | "achieve" | "clear";

/** Structured result carried in the tool's `details` and used for reconstruction. */
export interface GoalDetails {
	/** The goal after the call, or `null` when it was cleared. */
	goal: Goal | null;
	action: GoalAction;
	/** Model-readable validation message when the call was rejected. */
	error?: string;
}
