import type { Todo } from "../../../extensions/todo/types.ts";
import { toolResultEntry } from "../entries.ts";

/** A stored `todo` tool-result entry, as it appears on a session branch. */
export function resultEntry(todos: Todo[], toolName = "todo"): unknown {
	return toolResultEntry(toolName, { todos, action: todos.length === 0 ? "clear" : "write" });
}
