/**
 * Terminal rendering for the todo list.
 *
 * `renderTodoLines` is the shared layout used by the persistent widget and the
 * `/todos` screen. Two tiny components wrap it: a non-interactive widget for
 * `ctx.ui.setWidget()`, and a dismissible list for `ctx.ui.custom()`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { completedCount } from "./state.ts";
import type { Todo, TodoStatus } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "todo-widget";

const GLYPH: Record<TodoStatus, string> = {
	pending: "○",
	in_progress: "◐",
	completed: "✓",
};

/** Themed status glyph. */
function glyph(todo: Todo, theme: Theme): string {
	switch (todo.status) {
		case "completed":
			return theme.fg("success", GLYPH.completed);
		case "in_progress":
			return theme.fg("accent", GLYPH.in_progress);
		default:
			return theme.fg("dim", GLYPH.pending);
	}
}

/** Themed item text: completed dim, in-progress accented, pending muted. */
function label(todo: Todo, theme: Theme): string {
	if (todo.status === "completed") return theme.fg("dim", todo.content);
	if (todo.status === "in_progress") return theme.fg("text", todo.activeForm ?? todo.content);
	return theme.fg("muted", todo.content);
}

/** Count shown in the header, e.g. "1/3 completed". */
function summary(todos: Todo[]): string {
	if (todos.length === 0) return "No todos";
	return `${completedCount(todos)}/${todos.length} completed`;
}

/** Rows for the compact widget, bounded so it cannot crowd the editor. */
function widgetLines(todos: Todo[], theme: Theme, width: number): string[] {
	const maxRows = 5;
	const shown = todos.slice(0, maxRows);
	const lines = [`${theme.fg("accent", "Todos")} ${theme.fg("dim", summary(todos))}`];
	for (const todo of shown) {
		lines.push(truncateToWidth(`  ${glyph(todo, theme)} ${label(todo, theme)}`, width));
	}
	if (todos.length > shown.length) {
		lines.push(theme.fg("dim", `  … ${todos.length - shown.length} more`));
	}
	return lines.map((line) => truncateToWidth(line, width));
}

/** Full-screen rows for `/todos`, including an empty-state hint. */
function screenLines(todos: Todo[], theme: Theme, width: number): string[] {
	const lines: string[] = [];
	const title = theme.fg("accent", " Todos ");
	lines.push(
		truncateToWidth(
			theme.fg("borderMuted", "───") + title + theme.fg("borderMuted", "─".repeat(Math.max(0, width - 9))),
			width,
		),
	);
	lines.push("");

	if (todos.length === 0) {
		lines.push(truncateToWidth(`  ${theme.fg("dim", "No todos yet. Ask the agent to plan some work.")}`, width));
	} else {
		lines.push(truncateToWidth(`  ${theme.fg("muted", summary(todos))}`, width));
		lines.push("");
		for (const todo of todos) {
			lines.push(truncateToWidth(`  ${glyph(todo, theme)} ${label(todo, theme)}`, width));
		}
	}

	lines.push("");
	lines.push(truncateToWidth(`  ${theme.fg("dim", "Press Escape to close")}`, width));
	lines.push("");
	return lines;
}

/** Persistent widget body shown above the editor while the list is non-empty. */
export class TodoWidget implements Component {
	constructor(
		private readonly todos: Todo[],
		private readonly theme: Theme,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		return widgetLines(this.todos, this.theme, Math.max(1, width));
	}
}

/** Dismissible list opened by `/todos`. */
export class TodoListComponent implements Component {
	constructor(
		private readonly todos: Todo[],
		private readonly theme: Theme,
		private readonly onClose: () => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) this.onClose();
	}

	invalidate(): void {}

	render(width: number): string[] {
		return screenLines(this.todos, this.theme, Math.max(1, width));
	}
}
