/**
 * The `/todos` screen: a scrollable, dismissible list with its own frame.
 *
 * The frame, the hints, the range line and the empty state come from the
 * `lib/tui/` kit (`dockListFrame`, `screenHint`, `formatRange`, `emptyState`),
 * and the rows from `todoRow` in `format.ts`.
 *
 * Full-screen surfaces live under `view/` and load on first use: the `/todos`
 * command imports this module behind its TUI branch, so registration never pays
 * for it. The widget and the transcript block, which Pi draws synchronously,
 * stay outside this directory on purpose.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../../lib/tui/chrome.ts";
import { clip } from "../../../lib/tui/columns.ts";
import { clampScroll, fitRows, formatRange, isCloseKey, navigateScroll, wheelDelta } from "../../../lib/tui/cursor.ts";
import { emptyState } from "../../../lib/tui/rows.ts";
import { titleRule } from "../../../lib/tui/rules.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { progressSummary, todoRow } from "../format.ts";
import type { Todo } from "../types.ts";

/** Items the `/todos` screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;

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
