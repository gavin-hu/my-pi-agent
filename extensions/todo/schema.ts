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

/**
 * One item in the tool's input and output schemas.
 *
 * The input schema (`TodoParams`) enforces `maxItems` and the status enum
 * before `execute` runs. `normalizeTodos` re-enforces both for branch replay
 * and direct unit use, and owns the semantic rules the schema cannot express
 * (one `in_progress`, unique non-empty content, content length).
 */
export const TodoItem = Type.Object({
	content: Type.String({ description: "Imperative description of the task" }),
	status: StringEnum(TODO_STATUSES),
	activeForm: Type.Optional(
		Type.String({
			description:
				'Present-continuous label shown while in progress, e.g. "Running tests". Required when the item is in_progress.',
		}),
	),
});

export const TodoParams = Type.Object({
	todos: Type.Array(TodoItem, {
		maxItems: MAX_TODOS,
		description: "The complete todo list. It replaces the previous list; pass [] to clear.",
	}),
});

/**
 * Structured result returned as `structuredContent`, mirroring the `details`
 * payload so codemode/scripts can read the list as data.
 */
export const TodoResult = Type.Object({
	todos: Type.Array(TodoItem, { maxItems: MAX_TODOS }),
	action: StringEnum(["write", "clear"] as const),
	error: Type.Optional(Type.String()),
});

export type TodoArgs = Static<typeof TodoParams>;

function normalizeStatus(raw: unknown, index: number): TodoStatus {
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if ((TODO_STATUSES as readonly string[]).includes(value)) return value as TodoStatus;
	throw new Error(`Todo ${index + 1}: status must be one of ${TODO_STATUSES.join(", ")}.`);
}

/**
 * Make model text safe to render on one terminal line.
 *
 * Control characters (including ESC) are replaced with spaces so they cannot
 * move the cursor or inject styling, and any whitespace run (newlines, tabs,
 * repeated spaces) collapses to a single space. The result has no embedded
 * newlines, which every surface relies on for its one-line-per-item layout.
 */
function sanitizeText(raw: string): string {
	return raw
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
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
 * Validate and normalize the model's list.
 *
 * Content and `activeForm` are sanitized to a single safe line (see
 * `sanitizeText`). Rejects an empty description, an unknown status, duplicate
 * content, an over-long field, more than one `in_progress` item, and — unless
 * `options.requireActiveForm` is `false` — an `in_progress` item without a
 * non-blank `activeForm`. `activeForm` is dropped when blank.
 */
export function normalizeTodos(raw: unknown, options: NormalizeOptions = {}): Todo[] {
	const requireActiveForm = options.requireActiveForm ?? true;
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) throw new Error("todos must be an array.");
	if (raw.length > MAX_TODOS) throw new Error(`At most ${MAX_TODOS} todos are allowed.`);

	const todos: Todo[] = [];
	const seen = new Set<string>();
	let inProgress = 0;

	for (let i = 0; i < raw.length; i++) {
		const item = (raw[i] ?? {}) as Partial<Todo>;
		const content = typeof item.content === "string" ? sanitizeText(item.content) : "";
		if (!content) throw new Error(`Todo ${i + 1}: content is required.`);
		if (content.length > MAX_CONTENT) {
			throw new Error(`Todo ${i + 1}: content is longer than ${MAX_CONTENT} characters.`);
		}

		const key = content.toLowerCase();
		if (seen.has(key)) throw new Error(`Todo ${i + 1}: duplicate content "${content}".`);
		seen.add(key);

		const status = normalizeStatus(item.status, i);
		if (status === "in_progress") inProgress++;

		const activeForm = typeof item.activeForm === "string" ? sanitizeText(item.activeForm) : "";
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
