/**
 * Shared types for the goal extension.
 *
 * A session has at most one goal, and the model sets it as a whole value the
 * way `todo` replaces its list: the objective is the complete text, and an
 * empty objective clears the goal. There is no id and no per-field mutation.
 */

/**
 * Every phase a goal can hold: being designed, final and pursued, or done.
 *
 * `planning` is the goal workflow's to set — it means a plan is being designed and
 * the objective is still a draft. A model-issued call may only send `active` or
 * `achieved`, so a single call can never claim a plan that does not exist.
 */
export const GOAL_STATUSES = ["planning", "active", "achieved"] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Statuses a `goal` tool call may send; `planning` belongs to the workflow. */
export const GOAL_MODEL_STATUSES = ["active", "achieved"] as const;

/** What a call did, used by the result schema, details, and transcript renderer. */
export const GOAL_ACTIONS = ["set", "achieve", "clear"] as const;

export type GoalAction = (typeof GOAL_ACTIONS)[number];

/**
 * Custom-entry type used to persist a goal set outside the tool (the `/goal`
 * command). Owned by `lib/goal-state.ts` because another extension's reader
 * dispatches on it; re-exported here so goal's own modules keep one import.
 */
export { GOAL_ENTRY_TYPE } from "../../lib/goal-state.ts";

/** How an achieved goal renders in the persistent widget. */
export type AchievedStyle = "show" | "hide";

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

/** Structured result carried in the tool's `details` and used for reconstruction. */
export interface GoalDetails {
	/** The goal after the call, or `null` when it was cleared. */
	goal: Goal | null;
	action: GoalAction;
	/** Model-readable validation message when the call was rejected. */
	error?: string;
}
