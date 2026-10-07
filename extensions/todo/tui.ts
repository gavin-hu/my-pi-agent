/**
 * Terminal rendering for the todo list.
 *
 * `renderTodoLines` is the shared layout used by the persistent widget and the
 * `/todos` screen. Two tiny components wrap it: a non-interactive widget for
 * `ctx.ui.setWidget()`, and a dismissible list for `ctx.ui.custom()`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { progressSummary, todoGlyph, todoLabel } from "./format.ts";
import type { Todo } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "todo-widget";

/** Rows for the compact widget, bounded so it cannot crowd the editor. */
function widgetLines(todos: Todo[], theme: Theme, width: number): string[] {
	const maxRows = 5;
	const shown = todos.slice(0, maxRows);
	const lines = [`${theme.fg("accent", "Todos")} ${theme.fg("dim", progressSummary(todos))}`];
	for (const todo of shown) {
		lines.push(truncateToWidth(`  ${todoGlyph(todo, theme)} ${todoLabel(todo, theme)}`, width));
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
		lines.push(truncateToWidth(`  ${theme.fg("muted", progressSummary(todos))}`, width));
		lines.push("");
		for (const todo of todos) {
			lines.push(truncateToWidth(`  ${todoGlyph(todo, theme)} ${todoLabel(todo, theme)}`, width));
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
