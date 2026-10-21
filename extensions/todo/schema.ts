/**
 * Parameter schema for the `todo` tool.
 *
 * The schema is the host-facing shape; the semantic validation and the branch
 * replay live together in `lib/todo-state.ts`, so the tool, `plan`, and `goal`
 * read the same rules. Invalid input still throws a model-readable `Error`
 * before any state changes.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { MAX_TODOS, TODO_STATUSES } from "../../lib/todo-state.ts";

/**
 * One item in the tool's input and output schemas.
 *
 * The input schema (`TodoParams`) enforces `maxItems` and the status enum
 * before `execute` runs; `normalizeTodos` in `lib/todo-state.ts` re-enforces
 * both and owns the semantic rules the schema cannot express.
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
