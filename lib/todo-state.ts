/**
 * The published `todo` state, read back from the session branch (pure).
 *
 * The todo list is a whole-list replacement stored in each `todo` tool result's
 * `details`, so replaying the branch is how another extension reads it without
 * importing the todo extension. `plan` merges an approved plan's steps into the
 * last list, and `goal` mentions the items still open when a goal is marked
 * achieved.
 */

import { TODO_TOOL } from "./tool-names.ts";

/** One item in a `todo` list, as the todo tool stores it. */
export interface ExistingTodo {
	content: string;
	status: "pending" | "in_progress" | "completed";
	/** Present-continuous label the todo tool requires for an in-progress item. */
	activeForm?: string;
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
