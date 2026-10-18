/**
 * Approval-time todo bridge (pure).
 *
 * `todo` is whole-list replacement, so seeding an approved plan straight over
 * the list would discard whatever the user was already tracking. This module
 * reads the last `todo` result from the session branch — the published state
 * channel, replayed the way the todo extension itself reconstructs it, with no
 * import from that extension — and merges the plan's steps into it: existing
 * items keep their place and status, a step whose text is already present is
 * skipped, and the tool's item cap is respected without dropping anything the
 * user had.
 */

import { TODO_TOOL } from "../../lib/tool-names.ts";
import type { PlanStep } from "./steps.ts";

/** One item in the existing todo list, as the todo tool stores it. */
export interface ExistingTodo {
	content: string;
	status: "pending" | "in_progress" | "completed";
	/** Present-continuous label the todo tool requires for an in-progress item. */
	activeForm?: string;
}

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

/** Minimal shape of a session entry, used for runtime narrowing. */
interface BranchEntryLike {
	type?: string;
	message?: {
		role?: string;
		toolName?: string;
		details?: unknown;
	};
}

/** Fallback list cap when the registered todo tool does not advertise one. */
export const DEFAULT_TODO_MAX = 50;

function isStatus(value: unknown): value is ExistingTodo["status"] {
	return value === "pending" || value === "in_progress" || value === "completed";
}

/**
 * The last valid todo list written on the branch, or an empty list. A rejected
 * call carries the unchanged list and is not a state write, so it is skipped;
 * an entry that does not re-validate is ignored rather than wiping a good list.
 */
export function lastTodos(entries: Iterable<unknown>): ExistingTodo[] {
	let todos: ExistingTodo[] = [];
	for (const raw of entries) {
		const entry = raw as BranchEntryLike;
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== TODO_TOOL) continue;
		const details = message.details as { todos?: unknown; error?: unknown } | undefined;
		if (!details || details.error) continue;
		if (!Array.isArray(details.todos)) continue;
		todos = details.todos.flatMap((item): ExistingTodo[] => {
			if (typeof item !== "object" || item === null) return [];
			const value = item as { content?: unknown; status?: unknown; activeForm?: unknown };
			if (typeof value.content !== "string" || !isStatus(value.status)) return [];
			const content = value.content.trim();
			if (!content) return [];
			const activeForm =
				typeof value.activeForm === "string" && value.activeForm.trim() ? value.activeForm.trim() : undefined;
			return [activeForm ? { content, status: value.status, activeForm } : { content, status: value.status }];
		});
	}
	return todos;
}

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
