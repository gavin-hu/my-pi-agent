/**
 * Model-facing and transcript text for the todo list (pure).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { completedCount, currentTodo } from "./state.ts";
import type { Todo, TodoStatus } from "./types.ts";

/** Sort order so the widget and transcript surface current work before finished rows. */
const STATUS_ORDER: Record<TodoStatus, number> = { in_progress: 0, pending: 1, completed: 2 };

/** Compare todos so `in_progress` sorts before `pending` before `completed` (stable). */
export function compareByActivity(a: Todo, b: Todo): number {
	return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
}

/** Longest first-item preview shown in the transcript call line. */
const CALL_PREVIEW_WIDTH = 40;

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

/** "2/5" — completed over total. */
export function progressCount(todos: Todo[]): string {
	if (todos.length === 0) return "0/0";
	return `${completedCount(todos)}/${todos.length}`;
}

/** "2/5 completed", or a note when the list is empty. */
export function progressSummary(todos: Todo[]): string {
	if (todos.length === 0) return "No todos";
	return `${progressCount(todos)} completed`;
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

/**
 * One-line summary for the transcript call renderer.
 *
 * `todos` is `undefined` while the call's arguments are still streaming, which
 * is distinct from an empty list (a real clear). `argsComplete` disambiguates
 * the tail end of the stream.
 */
export function formatCallText(todos: { content?: string }[] | undefined, argsComplete = true): string {
	if (todos === undefined) return argsComplete ? "todo → clear list" : "todo → …";
	const count = todos.length;
	if (count === 0) return "todo → clear list";
	const item = todos[0]?.content?.trim();
	const noun = count === 1 ? "item" : "items";
	if (!item) return `todo → ${count} ${noun}`;
	const preview =
		visibleWidth(item) > CALL_PREVIEW_WIDTH ? `${sliceByColumn(item, 0, CALL_PREVIEW_WIDTH - 1)}…` : item;
	return `todo → ${count} ${noun}: ${preview}${count > 1 ? ", …" : ""}`;
}
