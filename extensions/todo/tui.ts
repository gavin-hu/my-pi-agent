/**
 * Terminal rendering for the todo list.
 *
 * `todoRow` is the shared item layout used by the persistent widget and the
 * `/todos` screen. Two tiny components wrap it: a non-interactive widget for
 * `ctx.ui.setWidget()`, and a scrollable, dismissible list for `ctx.ui.custom()`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { progressCount, progressSummary, todoGlyph, todoLabel } from "./format.ts";
import { currentTodo } from "./state.ts";
import type { Todo } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "todo-widget";

/** Items the `/todos` screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;
/** Never show fewer/more than this many items, however tall the terminal. */
const SCREEN_MIN_ITEMS = 3;
const SCREEN_MAX_ITEMS = 20;
/** Header, summary, footer, and blank rows the screen spends around the items. */
const SCREEN_CHROME_ROWS = 9;

/** How many items fit in a terminal of `rows` rows (undefined falls back). */
function visibleItems(rows: number | undefined): number {
	if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return SCREEN_DEFAULT_ITEMS;
	return Math.max(SCREEN_MIN_ITEMS, Math.min(rows - SCREEN_CHROME_ROWS, SCREEN_MAX_ITEMS));
}

/** One indented item line, clipped to `width`. */
function todoRow(todo: Todo, theme: Theme, width: number): string {
	return truncateToWidth(`  ${todoGlyph(todo, theme)} ${todoLabel(todo, theme)}`, width);
}

/**
 * One-line widget summary: progress plus the current item, or a completion note
 * when nothing is open. Callers clip it to the available width.
 */
export function todoLine(todos: Todo[], theme: Theme): string {
	const head = `${theme.fg("accent", "Todos")} ${theme.fg("dim", "·")} ${theme.fg("dim", progressCount(todos))}`;
	const current = currentTodo(todos);
	if (!current) return `${head} ${theme.fg("dim", "completed")}`;
	return `${head} ${theme.fg("dim", "·")} ${todoGlyph(current, theme)} ${todoLabel(current, theme)}`;
}

/** Top border with the title centered-left, exactly `width` columns wide. */
function screenHeader(theme: Theme, width: number): string {
	const label = " Todos ";
	const prefix = "───";
	// Too narrow for the title and a border on each side: show a plain rule
	// rather than truncating the title into an ellipsis.
	if (width < visibleWidth(prefix) + visibleWidth(label) + 1) {
		return theme.fg("borderMuted", "─".repeat(width));
	}
	const remaining = width - visibleWidth(prefix) - visibleWidth(label);
	return theme.fg("borderMuted", prefix) + theme.fg("accent", label) + theme.fg("borderMuted", "─".repeat(remaining));
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

/** Dismissible, scrollable list opened by `/todos`. */
export class TodoListComponent implements Component {
	private scrollTop = 0;

	/** Number of items shown at once, derived from the terminal height. */
	private readonly visible: number;

	constructor(
		private readonly todos: Todo[],
		private readonly theme: Theme,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
		viewportRows?: number,
	) {
		this.visible = visibleItems(viewportRows);
	}

	private get maxScroll(): number {
		return Math.max(0, this.todos.length - this.visible);
	}

	private setScroll(next: number): void {
		const clamped = Math.min(Math.max(0, next), this.maxScroll);
		if (clamped === this.scrollTop) return;
		this.scrollTop = clamped;
		this.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.onClose();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") this.setScroll(this.scrollTop - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.setScroll(this.scrollTop + 1);
		else if (matchesKey(data, Key.pageUp)) this.setScroll(this.scrollTop - this.visible);
		else if (matchesKey(data, Key.pageDown)) this.setScroll(this.scrollTop + this.visible);
		else if (matchesKey(data, Key.home)) this.setScroll(0);
		else if (matchesKey(data, Key.end)) this.setScroll(this.maxScroll);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const lines: string[] = [screenHeader(this.theme, w), ""];

		if (this.todos.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No todos yet. Ask the agent to plan some work.")}`, w));
		} else {
			lines.push(truncateToWidth(`  ${this.theme.fg("muted", progressSummary(this.todos))}`, w));
			lines.push("");
			const end = Math.min(this.todos.length, this.scrollTop + this.visible);
			for (let i = this.scrollTop; i < end; i++) lines.push(todoRow(this.todos[i], this.theme, w));
			if (this.scrollTop > 0 || end < this.todos.length) {
				lines.push(truncateToWidth(this.theme.fg("dim", `  showing ${this.scrollTop + 1}–${end} of ${this.todos.length}`), w));
			}
		}

		lines.push("");
		const hint =
			this.todos.length > this.visible
				? "↑/↓ or j/k scroll · PgUp/PgDn · Home/End · Esc to close"
				: "Press Escape to close";
		lines.push(truncateToWidth(`  ${this.theme.fg("dim", hint)}`, w));
		lines.push("");
		return lines;
	}
}
