/**
 * Approval-time todo bridge (pure).
 *
 * `todo` is whole-list replacement, so seeding an approved plan straight over
 * the list would discard whatever the user was already tracking. This module
 * merges the plan's steps into the list `lib/todo-state.ts` replays from the
 * session branch: existing items keep their place and status, a step whose text
 * is already present is skipped, and the tool's item cap is respected without
 * dropping anything the user had.
 */

import type { ExistingTodo } from "../../lib/todo-state.ts";
import type { PlanStep } from "./steps.ts";

/** The merged list plus the counts the approval message reports. */
export interface TodoMerge {
	todos: ExistingTodo[];
	/** Plan steps appended to the list. */
	added: number;
	/** Plan steps already in the list (same normalized text). */
	skipped: number;
	/** Existing items kept as they were. */
	kept: number;
	/** Plan steps left out because the list reached its cap. */
	deferred: number;
}

/** Fallback list cap when the registered todo tool does not advertise one. */
export const DEFAULT_TODO_MAX = 50;

/** Case- and whitespace-insensitive key for recognizing a repeated item. */
function contentKey(content: string): string {
	return content.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Merge the plan's steps into an existing list. Existing items come first and
 * keep their status, a legacy in-progress item without an `activeForm` gets its
 * content as one so the todo tool accepts it, and the appended steps stop at
 * `max` items — the rest are counted as deferred, never dropped.
 */
export function mergeTodos(existing: ExistingTodo[], steps: PlanStep[], max: number): TodoMerge {
	const limit = Number.isInteger(max) && max > 0 ? max : DEFAULT_TODO_MAX;
	const todos: ExistingTodo[] = existing.map((todo) =>
		todo.status === "in_progress" && !todo.activeForm ? { ...todo, activeForm: todo.content } : todo,
	);
	const seen = new Set(todos.map((todo) => contentKey(todo.content)));
	let added = 0;
	let skipped = 0;
	let deferred = 0;
	for (const step of steps) {
		const key = contentKey(step.content);
		if (!key) continue;
		if (seen.has(key)) {
			skipped += 1;
			continue;
		}
		if (todos.length >= limit) {
			deferred += 1;
			continue;
		}
		seen.add(key);
		todos.push({ content: step.content, status: step.status });
		added += 1;
	}
	return { todos, added, skipped, kept: existing.length, deferred };
}
