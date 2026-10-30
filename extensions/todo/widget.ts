/**
 * The persistent one-line todo widget, shown above the editor while the list
 * has work.
 *
 * It is a rail, not a screen: `runtime.syncWidget` sets it whenever the list
 * changes, through a synchronous factory Pi calls at paint time, so this module
 * stays on the registration path. `WIDGET_KEY` lives here for the same reason —
 * the runtime and the tests read it without touching a component.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { progressCount, todoLabel } from "./format.ts";
import { currentTodo } from "./state.ts";
import type { Todo } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "todo-widget";

/**
 * One-line widget summary: progress plus the current item, or a completion note
 * when nothing is open. Label-first and glyph-free, matching the `goal` and
 * `jobs` widgets. Callers clip it to the available width.
 */
function todoLine(todos: Todo[], theme: Theme): string {
	const head = `${paint(theme, "accent", "Todos")}${paint(theme, "faint", SEPARATORS.item)}${paint(theme, "faint", progressCount(todos))}`;
	const current = currentTodo(todos);
	if (!current) return `${head} ${paint(theme, "faint", "completed")}`;
	return `${head}${paint(theme, "faint", SEPARATORS.item)}${todoLabel(current, theme)}`;
}

/** Persistent one-line widget shown above the editor while the list has work. */
export class TodoWidget implements Component {
	constructor(
		private readonly todos: Todo[],
		private readonly theme: Theme,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.todos.length === 0) return [];
		return [truncateToWidth(todoLine(this.todos, this.theme), Math.max(1, width), "…")];
	}
}
