/**
 * Shared types for the todo extension.
 *
 * The item contract itself lives in `lib/todo-state.ts`, which owns the parser
 * and the branch replay shared with `plan` and `goal`; this module re-exports it
 * under the name the extension uses and adds the tool-result shape.
 */

import type { ExistingTodo } from "../../lib/todo-state.ts";

export { TODO_STATUSES, type TodoStatus } from "../../lib/todo-state.ts";

/** One item in the list. */
export type Todo = ExistingTodo;

/** Structured result carried in the tool's `details` and used for reconstruction. */
export interface TodoDetails {
	/** The full list after the call. */
	todos: Todo[];
	/** `clear` when the call emptied the list, otherwise `write`. */
	action: "write" | "clear";
	/** Model-readable validation message when the call was rejected. */
	error?: string;
}
