/**
 * Branch-aware state for the goal extension (pure).
 *
 * The goal lives in each `goal` tool result's `details`, and the `/goal`
 * command additionally appends a `goal` custom entry. `reconstructGoal` replays
 * a branch in order and returns the last written goal, so navigating or
 * branching the session reproduces the goal that was correct at that point.
 */

import { GOAL_ENTRY_TYPE, type Goal, type GoalDetails } from "./types.ts";

/** Minimal shape of a session entry, used for runtime narrowing. */
interface BranchEntryLike {
	type?: string;
	customType?: string;
	data?: unknown;
	message?: {
		role?: string;
		toolName?: string;
		details?: unknown;
	};
}

/** Whether an untrusted value is a well-formed goal. */
function isGoal(value: unknown): value is Goal {
	if (!value || typeof value !== "object") return false;
	const goal = value as Partial<Goal>;
	return typeof goal.objective === "string" && (goal.status === "active" || goal.status === "achieved");
}

function cloneGoal(goal: Goal): Goal {
	return { objective: goal.objective, status: goal.status };
}

/** The last goal written on the branch, or `null`. */
export function reconstructGoal(entries: Iterable<unknown>): Goal | null {
	let goal: Goal | null = null;
	for (const raw of entries) {
		const entry = raw as BranchEntryLike;

		// A `/goal` command records a custom entry; a `goal` tool call records a
		// tool result below. Both replay in branch order, so the last one wins.
		if (entry?.type === "custom" && entry.customType === GOAL_ENTRY_TYPE) {
			const data = entry.data as { goal?: unknown } | null | undefined;
			// A malformed entry (non-object `data`, or no `goal` field) is ignored so
			// it cannot wipe a valid goal during reconstruction.
			if (data && typeof data === "object" && "goal" in data && data.goal !== undefined) {
				goal = isGoal(data.goal) ? cloneGoal(data.goal) : null;
			}
			continue;
		}

		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== "goal") continue;
		const details = message.details as GoalDetails | undefined;
		if (!details || details.goal === undefined) continue;
		goal = isGoal(details.goal) ? cloneGoal(details.goal) : null;
	}
	return goal;
}

/** True when the goal exists and is still being pursued. */
export function isActiveGoal(goal: Goal | null): goal is Goal {
	return goal?.status === "active";
}
