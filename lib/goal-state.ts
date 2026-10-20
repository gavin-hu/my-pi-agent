/**
 * The published goal state, read back from the session branch (pure).
 *
 * `goal` publishes its objective two ways: every `goal` tool result carries the
 * goal in `details` — a rejected call carries the unchanged goal *and* an
 * `error`, which is not a write — and the `/goal` command appends a `goal` custom
 * entry whose `data.goal` is `null` when the goal is cleared. Replaying the branch
 * in order is how another extension reads the goal without importing goal's
 * modules: `plan` restates an active goal in its planning context and offers to
 * record one when a plan is approved with none.
 *
 * Stored values are re-validated and re-sanitized here. Branch data can be
 * tampered with, migrated, or written by an older version, and a reader must not
 * pass escapes or unbounded text onward; anything that fails validation is
 * ignored rather than clearing a goal that is still valid.
 *
 * The entry type and the objective limit live here and are imported by `goal`, so
 * the publisher and the reader cannot drift. `goal` reads the branch through
 * {@link lastGoal} as well — [`extensions/goal/state.ts`](../extensions/goal/state.ts)
 * adds only the widget's active check and the open-todo count on top — so there
 * is one replay, not two.
 */

import { sanitizeLine } from "./format.ts";
import { GOAL_TOOL } from "./tool-names.ts";

/** Custom-entry type `goal` uses to persist a goal set outside the tool. */
export const GOAL_ENTRY_TYPE = "goal";

/** Longest objective the goal tool accepts, and the most a reader will replay. */
export const MAX_GOAL_OBJECTIVE = 2000;

/** Whether the goal is still being pursued, or already done. */
export type PublishedGoalStatus = "active" | "achieved";

/** The goal as another extension may read it. */
export interface PublishedGoal {
	/** The objective, sanitized to a single line. */
	objective: string;
	status: PublishedGoalStatus;
}

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
 * A stored goal value: `undefined` when it cannot be read, `null` for an explicit
 * clear, otherwise the validated goal.
 */
function readGoal(value: unknown): PublishedGoal | null | undefined {
	if (value === null) return null;
	if (!value || typeof value !== "object") return undefined;
	const goal = value as { objective?: unknown; status?: unknown };
	if (typeof goal.objective !== "string") return undefined;
	if (goal.status !== "active" && goal.status !== "achieved") return undefined;
	const objective = sanitizeLine(goal.objective);
	if (!objective || objective.length > MAX_GOAL_OBJECTIVE) return undefined;
	return { objective, status: goal.status };
}

/** The last goal written on the branch, or `null` when the session has none. */
export function lastGoal(entries: Iterable<unknown>): PublishedGoal | null {
	let goal: PublishedGoal | null = null;
	for (const raw of entries) {
		const entry = raw as BranchEntryLike;

		// The `/goal` command records a custom entry; the tool records a result below.
		// Both replay in branch order, so the last write wins.
		if (entry?.type === "custom" && entry.customType === GOAL_ENTRY_TYPE) {
			const data = entry.data as { goal?: unknown } | null | undefined;
			if (!data || typeof data !== "object" || !("goal" in data)) continue;
			const next = readGoal(data.goal);
			if (next !== undefined) goal = next;
			continue;
		}

		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== GOAL_TOOL) continue;
		const details = message.details as { goal?: unknown; error?: unknown } | undefined;
		if (!details || details.error) continue;
		if (!("goal" in details)) continue;
		const next = readGoal(details.goal);
		if (next !== undefined) goal = next;
	}
	return goal;
}
