/**
 * Shared types for the todo extension.
 *
 * The todo list is a whole-list replacement, the way Claude Code's `TodoWrite`
 * works: the model always sends the complete list, so there is no "add" or
 * "toggle" operation and no id bookkeeping.
 */

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

/** One item in the list. */
export interface Todo {
	/** Imperative description of the task, e.g. "Write the parser tests". */
	content: string;
	status: TodoStatus;
	/**
	 * Present-continuous label shown while the item is in progress, e.g.
	 * "Writing the parser tests". Falls back to `content` when absent.
	 */
	activeForm?: string;
}

/** Structured result carried in the tool's `details` and used for reconstruction. */
export interface TodoDetails {
	/** The full list after the call. */
	todos: Todo[];
	/** `clear` when the call emptied the list, otherwise `write`. */
	action: "write" | "clear";
	/** Model-readable validation message when the call was rejected. */
	error?: string;
}
