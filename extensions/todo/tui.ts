/**
 * Terminal rendering for the todo list.
 *
 * `todoRow` is the shared item layout used by the persistent widget and the
 * `/todos` screen. Two tiny components wrap it: a non-interactive widget for
 * `ctx.ui.setWidget()`, and a scrollable, dismissible list for `ctx.ui.custom()`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { clampScroll, fitRows, formatRange, isCloseKey, navigateScroll, wheelDelta } from "../../lib/tui/cursor.ts";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { emptyState, listRow } from "../../lib/tui/rows.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { RenderCache } from "../../lib/tui/render-cache.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
import {
	progressCount,
	progressSummary,
	todoGlyphChar,
	todoGlyphRole,
	todoLabel,
	todoLabelRole,
	todoLabelText,
	todoRailLines,
	type TodoRailInput,
} from "./format.ts";
import { currentTodo } from "./state.ts";
import type { Todo } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "todo-widget";

/** Items the `/todos` screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;

/** One indented item line, clipped to `width`. */
function todoRow(todo: Todo, theme: Theme, width: number): string {
	return listRow(theme, width, {
		glyph: todoGlyphChar(todo),
		glyphRole: todoGlyphRole(todo),
		label: todoLabelText(todo),
		labelRole: todoLabelRole(todo),
	});
}

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

/**
 * Transcript result block: the indented glyph rail, wrapping at the render width.
 *
 * `render` runs on every frame Pi draws, for every block in the transcript, so the
 * rail is memoized on the width (`RenderCache`) and rebuilt only when
 * `setInput` hands over a new list or `invalidate` says the theme moved. The
 * caller must go through `setInput`: mutating a list in place would leave the
 * block showing what it drew last.
 */
export class TodoResult implements Component {
	private input: TodoRailInput;
	private theme: Theme;
	private readonly cache = new RenderCache();

	constructor(input: TodoRailInput, theme: Theme) {
		this.input = input;
		this.theme = theme;
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: TodoRailInput, theme: Theme): void {
		this.input = input;
		this.theme = theme;
		this.cache.invalidate();
	}

	invalidate(): void {
		this.cache.invalidate();
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.cache.lines(w, undefined, () => this.build(w));
	}

	private build(w: number): string[] {
		// The leading blank line separates the rail from the call header, matching
		// the built-ins' header/output gap.
		return ["", ...todoRailLines(this.input, this.theme, w)];
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
		if (isCloseKey(data)) {
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
		const next = navigateScroll(data, this.scrollTop, this.todos.length, this.visible);
		if (next !== undefined) this.setScroll(next);
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
		const header = titleRule(this.theme, w, "Todos");

		if (this.todos.length === 0) {
			return dockListFrame({
				theme: this.theme,
				width: w,
				header,
				body: emptyState(this.theme, w, { label: "No todos yet. Ask the agent to plan some work." }),
				hint: screenHint(this.theme, w, ["Esc close"]),
			});
		}

		// header, summary, blank, blank-after-list, hint, closing rule
		const chrome = 6;
		this.visible = fitRows(this.viewportRowsSource, this.todos.length, chrome, SCREEN_DEFAULT_ITEMS);
		this.scrollTop = clampScroll(this.scrollTop, this.todos.length, this.visible);

		const end = Math.min(this.todos.length, this.scrollTop + this.visible);
		const body: string[] = [];
		for (let i = this.scrollTop; i < end; i++) body.push(todoRow(this.todos[i], this.theme, w));

		return dockListFrame({
			theme: this.theme,
			width: w,
			header,
			summary: clip(`  ${paint(this.theme, "meta", progressSummary(this.todos))}`, w),
			body,
			range:
				this.scrollTop > 0 || end < this.todos.length
					? formatRange(this.theme, w, { start: this.scrollTop, end, total: this.todos.length })
					: undefined,
			hint: screenHint(this.theme, w, ["Esc close", "↑/↓ or k/j scroll", "PgUp/PgDn", "g/G or Home/End"]),
		});
	}
}
