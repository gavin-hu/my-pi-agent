/**
 * The todo item contract, its parser, and the published state replayed from the
 * session branch.
 *
 * The list is a whole-list replacement stored in each `todo` tool result's
 * `details`, so replaying the branch is how an extension reads it without
 * importing the todo extension. `todo` reads the branch through the same
 * {@link lastTodos} replay, so the tool, `plan`, and `goal` cannot disagree
 * about which write is a state write: a write that fails validation is ignored
 * and the last valid list stays, exactly as the tool itself keeps the previous
 * list on a rejected call.
 *
 * Stored values are re-validated and re-sanitized here. Branch data can be
 * tampered with, migrated, or written by an older version, and a reader must not
 * pass escapes or unbounded text onward; anything that fails validation is
 * ignored rather than partially applied.
 *
 * Value-only: no module state, no host access.
 */

import { sanitizeLine } from "./format.ts";
import { TODO_TOOL } from "./tool-names.ts";

/** Statuses a todo item may carry. */
export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;

/** One item's status. */
export type TodoStatus = (typeof TODO_STATUSES)[number];

/** Maximum number of items in one list. */
export const MAX_TODOS = 50;
/** Maximum length of a single item's text. */
export const MAX_CONTENT = 500;

/** One item in a `todo` list, as the tool stores it. */
export interface ExistingTodo {
	/** Imperative description of the task. */
	content: string;
	/** Where the item sits in the list. */
	status: TodoStatus;
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

const STATUS_SET: ReadonlySet<string> = new Set(TODO_STATUSES);

function normalizeTodoStatus(raw: unknown, index: number): TodoStatus {
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (STATUS_SET.has(value)) return value as TodoStatus;
	throw new Error(`Todo ${index + 1}: status must be one of ${TODO_STATUSES.join(", ")}.`);
}

/** Options for {@link normalizeTodos}. */
export interface NormalizeOptions {
	/**
	 * Require a non-blank `activeForm` on `in_progress` items. Live tool input
	 * enforces this (the default); branch replay passes `false` so lists written
	 * before the rule was added still load.
	 */
	requireActiveForm?: boolean;
}

/**
 * Validate and normalize a todo list.
 *
 * Content and `activeForm` are sanitized to a single safe line (see
 * `sanitizeLine`). Rejects an empty description, an unknown status, duplicate
 * content, an over-long field, more than one `in_progress` item, and — unless
 * `options.requireActiveForm` is `false` — an `in_progress` item without a
 * non-blank `activeForm`. `activeForm` is dropped when blank.
 */
export function normalizeTodos(raw: unknown, options: NormalizeOptions = {}): ExistingTodo[] {
	const requireActiveForm = options.requireActiveForm ?? true;
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) throw new Error("todos must be an array.");
	if (raw.length > MAX_TODOS) throw new Error(`At most ${MAX_TODOS} todos are allowed.`);

	const todos: ExistingTodo[] = [];
	const seen = new Set<string>();
	let inProgress = 0;

	for (let i = 0; i < raw.length; i++) {
		const item = (raw[i] ?? {}) as Partial<ExistingTodo>;
		const content = typeof item.content === "string" ? sanitizeLine(item.content) : "";
		if (!content) throw new Error(`Todo ${i + 1}: content is required.`);
		if (content.length > MAX_CONTENT) {
			throw new Error(`Todo ${i + 1}: content is longer than ${MAX_CONTENT} characters.`);
		}

		const key = content.toLowerCase();
		if (seen.has(key)) throw new Error(`Todo ${i + 1}: duplicate content "${content}".`);
		seen.add(key);

		const status = normalizeTodoStatus(item.status, i);
		if (status === "in_progress") inProgress++;

		const activeForm = typeof item.activeForm === "string" ? sanitizeLine(item.activeForm) : "";
		if (activeForm.length > MAX_CONTENT) {
			throw new Error(`Todo ${i + 1}: activeForm is longer than ${MAX_CONTENT} characters.`);
		}
		if (status === "in_progress" && requireActiveForm && !activeForm) {
			throw new Error(
				`Todo ${i + 1}: activeForm is required for an in_progress item (present-continuous, e.g. "Running tests").`,
			);
		}
		todos.push(activeForm ? { content, status, activeForm } : { content, status });
	}

	if (inProgress > 1) {
		throw new Error("At most one todo may be in_progress; mark the rest pending or completed.");
	}
	return todos;
}

/**
 * The last valid todo list written on the branch, or an empty list.
 *
 * A rejected call carries the unchanged list and is not a state write, so it is
 * skipped. A write that fails validation is ignored whole, so a corrupt or
 * tampered entry cannot wipe or partially replace a valid list.
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
		try {
			todos = normalizeTodos(details.todos, { requireActiveForm: false });
		} catch {
			// Keep the previous list.
		}
	}
	return todos;
}
