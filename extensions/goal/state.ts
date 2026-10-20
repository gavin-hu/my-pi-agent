/**
 * Branch-aware state for the goal extension (pure).
 *
 * The goal lives in each `goal` tool result's `details`, and the `/goal`
 * command additionally appends a `goal` custom entry. `reconstructGoal` replays
 * a branch in order and returns the last valid goal, so navigating or branching
 * the session reproduces the goal that was correct at that point. Stored values
 * are re-validated and re-sanitized so corrupt or tampered branch data cannot
 * inject escapes or wipe the goal. {@link openTodoCount} is the other
 * branch-derived fact: the *how* both completion paths check before closing the
 * *what*.
 */

import { lastTodos } from "../../lib/todo-state.ts";
import { normalizeStoredGoal } from "./schema.ts";
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

/**
 * Apply a stored goal to the running value. `null` is an explicit clear; any
 * other value that fails validation is ignored so a malformed entry cannot wipe
 * a valid goal.
 */
function applyStoredGoal(current: Goal | null, value: unknown): Goal | null {
	if (value === null) return null;
	return normalizeStoredGoal(value) ?? current;
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
			if (data && typeof data === "object" && "goal" in data && data.goal !== undefined) {
				goal = applyStoredGoal(goal, data.goal);
			}
			continue;
		}

		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== "goal") continue;
		const details = message.details as GoalDetails | undefined;
		if (!details || details.goal === undefined) continue;
		// A rejected call carries the unchanged goal for the model to read; it is
		// not a state write and must not be replayed as one.
		if (details.error) continue;
		goal = applyStoredGoal(goal, details.goal);
	}
	return goal;
}

/** True when the goal exists and is still being pursued. */
export function isActiveGoal(goal: Goal | null): goal is Goal {
	return goal?.status === "active";
}

/**
 * How many items the branch's todo list still has open.
 *
 * `todo` is the *how* to the goal's *what*, so both paths that complete a goal
 * — the tool and `/goal done` — consult this count before closing the *what*
 * over an unfinished list. The list is replayed from the branch
 * (`lib/todo-state.ts`), never by importing the todo extension.
 */
export function openTodoCount(entries: Iterable<unknown>): number {
	return lastTodos(entries).filter((todo) => todo.status !== "completed").length;
}
