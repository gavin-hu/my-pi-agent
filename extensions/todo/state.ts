/**
 * Status queries over the list the branch published (pure).
 *
 * The list itself — the item contract, its validation, and the single strict
 * replay — lives in `lib/todo-state.ts`, shared with `plan` and `goal`. These
 * are the derived facts the widget and the transcript ask of it.
 */

import type { Todo } from "./types.ts";

/** Number of completed items. */
export function completedCount(todos: Todo[]): number {
	return todos.reduce((count, todo) => (todo.status === "completed" ? count + 1 : count), 0);
}

/** True when at least one item is not completed. */
export function hasOpenTodos(todos: Todo[]): boolean {
	return todos.some((todo) => todo.status !== "completed");
}

/** The in-progress item, or the first pending one, or undefined. */
export function currentTodo(todos: Todo[]): Todo | undefined {
	return todos.find((todo) => todo.status === "in_progress") ?? todos.find((todo) => todo.status === "pending");
}
