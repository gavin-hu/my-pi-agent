import { TODO_NUDGE_CONTEXT_TYPE } from "../../../extensions/todo/index.ts";
import type { Todo } from "../../../extensions/todo/types.ts";
import { toolResultEntry } from "../entries.ts";

/** A stored `todo` tool-result entry, as it appears on a session branch. */
export function resultEntry(todos: Todo[], toolName = "todo"): unknown {
	return toolResultEntry(toolName, { todos, action: todos.length === 0 ? "clear" : "write" });
}

/** The injected lag reminder, as it appears in `context` messages. */
export function nudgeMessage(text = "update the list"): unknown {
	return { role: "custom", customType: TODO_NUDGE_CONTEXT_TYPE, content: text, display: false };
}
