/**
 * Model-facing and transcript text for the todo list (pure).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { completedCount, currentTodo } from "./state.ts";
import type { Todo, TodoStatus } from "./types.ts";

/** Checkbox used in the model-facing list. */
const MODEL_MARK: Record<TodoStatus, string> = {
	pending: "[ ]",
	in_progress: "[~]",
	completed: "[x]",
};

/** Themed status glyph, shared by the widget and the transcript renderer. */
export function todoGlyph(todo: Todo, theme: Theme): string {
	switch (todo.status) {
		case "completed":
			return theme.fg("success", "✓");
		case "in_progress":
			return theme.fg("accent", "◐");
		default:
			return theme.fg("dim", "○");
	}
}

/** Themed item text: completed dim, in-progress accented, pending muted. */
export function todoLabel(todo: Todo, theme: Theme): string {
	if (todo.status === "completed") return theme.fg("dim", todo.content);
	if (todo.status === "in_progress") return theme.fg("text", todo.activeForm ?? todo.content);
	return theme.fg("muted", todo.content);
}

/** "2/5 completed", or a note when the list is empty. */
export function progressSummary(todos: Todo[]): string {
	if (todos.length === 0) return "No todos";
	return `${completedCount(todos)}/${todos.length} completed`;
}

/** Numbered checklist, one item per line. */
export function formatTodoList(todos: Todo[]): string {
	if (todos.length === 0) return "No todos.";
	return todos.map((todo, i) => `${i + 1}. ${MODEL_MARK[todo.status]} ${todo.content}`).join("\n");
}

/** The model-facing result: the checklist plus progress and the active item. */
export function formatTodoText(todos: Todo[]): string {
	if (todos.length === 0) return "Todo list cleared.";

	const lines = [formatTodoList(todos), "", progressSummary(todos)];
	const current = currentTodo(todos);
	if (current) {
		const label = current.status === "in_progress" ? "In progress" : "Next";
		lines.push(`${label}: ${current.activeForm ?? current.content}`);
	}
	return lines.join("\n");
}

/** One-line summary for the transcript call renderer. */
export function formatCallText(todos: { content?: string }[] | undefined): string {
	const count = todos?.length ?? 0;
	if (count === 0) return "todo → clear list";
	const item = todos?.[0]?.content?.trim();
	const noun = count === 1 ? "item" : "items";
	return `todo → ${count} ${noun}${item ? `: ${item}${count > 1 ? ", …" : ""}` : ""}`;
}
