/**
 * Parameter schema and validation for the `todo` tool.
 *
 * Everything here is pure: no host APIs, no terminal. Invalid input throws a
 * model-readable `Error` before any state changes, so the model can retry with
 * a corrected list instead of silently corrupting the list.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { TODO_STATUSES, type Todo, type TodoStatus } from "./types.ts";

/** Maximum number of items in one list. */
export const MAX_TODOS = 50;
/** Maximum length of a single item's text. */
export const MAX_CONTENT = 500;

const TodoItem = Type.Object({
	content: Type.String({ description: "Imperative description of the task" }),
	status: StringEnum(TODO_STATUSES),
	activeForm: Type.Optional(
		Type.String({
			description: 'Present-continuous label shown while in progress, e.g. "Running tests". Defaults to content.',
		}),
	),
});

export const TodoParams = Type.Object({
	todos: Type.Array(TodoItem, {
		maxItems: MAX_TODOS,
		description: "The complete todo list. It replaces the previous list; pass [] to clear.",
	}),
});

export type TodoArgs = Static<typeof TodoParams>;

function normalizeStatus(raw: unknown, index: number): TodoStatus {
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if ((TODO_STATUSES as readonly string[]).includes(value)) return value as TodoStatus;
	throw new Error(`Todo ${index + 1}: status must be one of ${TODO_STATUSES.join(", ")}.`);
}

/**
 * Validate and normalize the model's list.
 *
 * Rejects an empty description, an unknown status, duplicate content, and more
 * than one `in_progress` item. `activeForm` is trimmed and dropped when blank.
 */
export function normalizeTodos(raw: unknown): Todo[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) throw new Error("todos must be an array.");
	if (raw.length > MAX_TODOS) throw new Error(`At most ${MAX_TODOS} todos are allowed.`);

	const todos: Todo[] = [];
	const seen = new Set<string>();
	let inProgress = 0;

	for (let i = 0; i < raw.length; i++) {
		const item = (raw[i] ?? {}) as Partial<Todo>;
		const content = typeof item.content === "string" ? item.content.trim() : "";
		if (!content) throw new Error(`Todo ${i + 1}: content is required.`);
		if (content.length > MAX_CONTENT) {
			throw new Error(`Todo ${i + 1}: content is longer than ${MAX_CONTENT} characters.`);
		}

		const key = content.toLowerCase();
		if (seen.has(key)) throw new Error(`Todo ${i + 1}: duplicate content "${content}".`);
		seen.add(key);

		const status = normalizeStatus(item.status, i);
		if (status === "in_progress") inProgress++;

		const activeForm =
			typeof item.activeForm === "string" && item.activeForm.trim() ? item.activeForm.trim() : undefined;
		todos.push(activeForm ? { content, status, activeForm } : { content, status });
	}

	if (inProgress > 1) {
		throw new Error("At most one todo may be in_progress; mark the rest pending or completed.");
	}
	return todos;
}
