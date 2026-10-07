/**
 * Branch-aware state for the todo extension (pure).
 *
 * The list lives in each `todo` tool result's `details`, so navigating or
 * branching the session reproduces the list that was correct at that point.
 * `reconstructTodos` replays a branch and returns the last written list.
 */

import type { Todo, TodoDetails, TodoStatus } from "./types.ts";

/** Minimal shape of a session entry, used for runtime narrowing. */
interface BranchEntryLike {
	type?: string;
	message?: {
		role?: string;
		toolName?: string;
		details?: unknown;
	};
}

function cloneTodo(todo: Todo): Todo {
	return todo.activeForm === undefined
		? { content: todo.content, status: todo.status }
		: { content: todo.content, status: todo.status, activeForm: todo.activeForm };
}

/** The last list written on the branch, or an empty list. */
export function reconstructTodos(entries: Iterable<unknown>): Todo[] {
	let todos: Todo[] = [];
	for (const raw of entries) {
		const entry = raw as BranchEntryLike;
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== "todo") continue;
		const details = message.details as TodoDetails | undefined;
		if (details && Array.isArray(details.todos)) todos = details.todos.map(cloneTodo);
	}
	return todos;
}

/** Count of items in each status. */
export function countByStatus(todos: Todo[]): Record<TodoStatus, number> {
	const counts: Record<TodoStatus, number> = { pending: 0, in_progress: 0, completed: 0 };
	for (const todo of todos) counts[todo.status]++;
	return counts;
}

/** Number of completed items. */
export function completedCount(todos: Todo[]): number {
	return countByStatus(todos).completed;
}

/** True when at least one item is not completed. */
export function hasOpenTodos(todos: Todo[]): boolean {
	return todos.some((todo) => todo.status !== "completed");
}

/** The in-progress item, or the first pending one, or undefined. */
export function currentTodo(todos: Todo[]): Todo | undefined {
	return todos.find((todo) => todo.status === "in_progress") ?? todos.find((todo) => todo.status === "pending");
}
