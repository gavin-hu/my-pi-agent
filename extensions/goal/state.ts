/**
 * Branch-derived facts the goal extension needs (pure).
 *
 * The goal itself is replayed by `lib/goal-state.ts`, which owns the entry
 * types, the objective limit, and the re-validation of stored values — the same
 * contract `plan` reads, so a corrupt or tampered branch cannot inject escapes
 * or wipe the goal on one side only. This module adds the two facts goal needs
 * on top of that replay: whether the goal is still being pursued, and how many
 * todo items the branch's list still has open.
 */

import { lastGoal } from "../../lib/goal-state.ts";
import { lastTodos } from "../../lib/todo-state.ts";
import type { Goal } from "./types.ts";

/**
 * The last goal written on the branch, or `null`.
 *
 * Delegates to the published reader, so the replay rules — a rejected call is
 * not a state write, `null` is an explicit clear, an invalid value is ignored
 * rather than wiping a valid goal — exist once.
 */
export function reconstructGoal(entries: Iterable<unknown>): Goal | null {
	return lastGoal(entries);
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
