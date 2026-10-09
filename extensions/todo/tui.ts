/**
 * Terminal rendering for the todo list.
 *
 * `todoRow` is the shared item layout used by the persistent widget and the
 * `/todos` screen. Two tiny components wrap it: a non-interactive widget for
 * `ctx.ui.setWidget()`, and a scrollable, dismissible list for `ctx.ui.custom()`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { clampScroll, fitRows, formatRange, navIntent, wheelDelta } from "../../lib/list-cursor.ts";
import { screenHeader, screenHint, type ViewportRowsSource } from "../../lib/tui.ts";
import { progressCount, progressSummary, todoGlyph, todoLabel, todoRailLines, type TodoRailInput } from "./format.ts";
import { currentTodo } from "./state.ts";
import type { Todo } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "todo-widget";

/** Items the `/todos` screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;

/** One indented item line, clipped to `width`. */
function todoRow(todo: Todo, theme: Theme, width: number): string {
	return truncateToWidth(`  ${todoGlyph(todo, theme)} ${todoLabel(todo, theme)}`, width, "…");
}

/**
 * One-line widget summary: progress plus the current item, or a completion note
 * when nothing is open. Label-first and glyph-free, matching the `goal` and
 * `jobs` widgets. Callers clip it to the available width.
 */
function todoLine(todos: Todo[], theme: Theme): string {
	const head = `${theme.fg("accent", "Todos")} ${theme.fg("dim", "·")} ${theme.fg("dim", progressCount(todos))}`;
	const current = currentTodo(todos);
	if (!current) return `${head} ${theme.fg("dim", "completed")}`;
	return `${head} ${theme.fg("dim", "·")} ${todoLabel(current, theme)}`;
}

/** Transcript result block: the indented glyph rail, wrapping at the render width. */
export class TodoResult implements Component {
	private input: TodoRailInput;
	private theme: Theme;

	constructor(input: TodoRailInput, theme: Theme) {
		this.input = input;
		this.theme = theme;
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: TodoRailInput, theme: Theme): void {
		this.input = input;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		// The leading blank line separates the rail from the call header, matching
		// the built-ins' header/output gap.
		return ["", ...todoRailLines(this.input, this.theme, Math.max(1, width))];
	}
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

/** Dismissible, scrollable list opened by `/todos`; reads the live list on each render. */
export class TodoListComponent implements Component {
	private scrollTop = 0;
	/** Rows shown at once; recomputed from the terminal height on every render. */
	private visible = SCREEN_DEFAULT_ITEMS;

	constructor(
		private readonly getTodos: () => Todo[],
		private readonly theme: Theme,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
		private readonly viewportRowsSource?: ViewportRowsSource,
	) {}

	/** The live list; re-read on each render so an open screen follows changes. */
	private get todos(): Todo[] {
		return this.getTodos();
	}

	private get maxScroll(): number {
		return Math.max(0, this.todos.length - this.visible);
	}

	private setScroll(next: number): void {
		const clamped = clampScroll(next, this.todos.length, this.visible);
		if (clamped === this.scrollTop) return;
		this.scrollTop = clamped;
		this.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.onClose();
			return;
		}
		// `g`/`G` jump to the ends, matching the `/jobs` and plan screens.
		if (data === "g") {
			this.setScroll(0);
			return;
		}
		if (data === "G") {
			this.setScroll(this.maxScroll);
			return;
		}
		switch (navIntent(data)) {
			case "up":
				this.setScroll(this.scrollTop - 1);
				return;
			case "down":
				this.setScroll(this.scrollTop + 1);
				return;
			case "pageUp":
				this.setScroll(this.scrollTop - this.visible);
				return;
			case "pageDown":
				this.setScroll(this.scrollTop + this.visible);
				return;
			case "home":
				this.setScroll(0);
				return;
			case "end":
				this.setScroll(this.maxScroll);
				return;
		}
	}

	/** Wheel scrolling moves the list, matching the other list screens. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		this.setScroll(this.scrollTop + delta);
		return { handled: true };
	}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const lines: string[] = [screenHeader(this.theme, w, "Todos")];

		if (this.todos.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No todos yet. Ask the agent to plan some work.")}`, w));
			lines.push("");
			lines.push(screenHint(this.theme, w, ["Esc close"]));
			lines.push("");
			return lines;
		}

		lines.push(truncateToWidth(`  ${this.theme.fg("muted", progressSummary(this.todos))}`, w));
		lines.push("");
		// header, summary, blank, blank-after-list, hint, blank
		const chrome = 6;
		this.visible = fitRows(this.viewportRowsSource, this.todos.length, chrome, SCREEN_DEFAULT_ITEMS);
		this.scrollTop = clampScroll(this.scrollTop, this.todos.length, this.visible);

		const end = Math.min(this.todos.length, this.scrollTop + this.visible);
		for (let i = this.scrollTop; i < end; i++) lines.push(todoRow(this.todos[i], this.theme, w));
		if (this.scrollTop > 0 || end < this.todos.length) {
			lines.push(formatRange(this.theme, w, { start: this.scrollTop, end, total: this.todos.length }));
		}

		lines.push("");
		lines.push(screenHint(this.theme, w, ["Esc close", "↑/↓ or k/j scroll", "PgUp/PgDn", "g/G or Home/End"]));
		lines.push("");
		return lines;
	}
}
