/**
 * Branch-aware state for the todo extension (pure).
 *
 * The list lives in each `todo` tool result's `details`, so navigating or
 * branching the session reproduces the list that was correct at that point.
 * `reconstructTodos` replays a branch and returns the last valid list; stored
 * values are re-validated and re-sanitized so corrupt or tampered branch data
 * cannot inject escapes, crash reconstruction, or wipe a valid list.
 */

import { normalizeTodos } from "./schema.ts";
import type { Todo, TodoDetails } from "./types.ts";

/** Minimal shape of a session entry, used for runtime narrowing. */
interface BranchEntryLike {
	type?: string;
	message?: {
		role?: string;
		toolName?: string;
		details?: unknown;
	};
}

/** The last valid list written on the branch, or an empty list. */
export function reconstructTodos(entries: Iterable<unknown>): Todo[] {
	let todos: Todo[] = [];
	for (const raw of entries) {
		const entry = raw as BranchEntryLike;
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== "todo") continue;
		const details = message.details as TodoDetails | undefined;
		if (!details || details.todos === undefined) continue;
		// A rejected call carries the unchanged list for the model to read; it is
		// not a state write and must not be replayed as one.
		if (details.error) continue;
		// Anything that does not re-validate as a todo list is ignored, so a
		// malformed entry cannot wipe a valid one. Replay is lenient about
		// `activeForm`: a list written before that field was required still loads
		// instead of being dropped.
		if (!Array.isArray(details.todos)) continue;
		try {
			todos = normalizeTodos(details.todos, { requireActiveForm: false });
		} catch {
			// Keep the previous list.
		}
	}
	return todos;
}

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
