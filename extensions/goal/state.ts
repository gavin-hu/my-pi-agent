/**
 * Branch-derived facts the goal extension needs (pure).
 *
 * The goal itself is replayed by `lib/goal-state.ts`, which owns the entry
 * types, the objective limit, and the re-validation of stored values — the same
 * contract `plan` reads, so a corrupt or tampered branch cannot inject escapes
 * or wipe the goal on one side only. This module adds the two facts goal needs
 * on top of that replay: whether a planning goal's phase has ended, and how many
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

/**
 * A goal whose plan phase ended without an approved plan.
 *
 * `planning` is left behind by plan's approval, which sets the plan's own goal,
 * or by leaving plan mode some other way — a toggle, the shortcut, a resumed
 * branch. That second exit has no tool call to write it, so `goal` settles it when
 * it next observes the branch: the draft becomes the objective, because the user
 * chose to act on it. Returns `null` when there is nothing to promote.
 */
export function settledGoal(goal: Goal | null, planModeOn: boolean): Goal | null {
	if (goal?.status !== "planning" || planModeOn) return null;
	return { objective: goal.objective, status: "active" };
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
