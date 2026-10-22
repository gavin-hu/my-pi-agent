/**
 * The shared multi-select checklist screen.
 *
 * `/rewind`'s partial restore, `/review`'s changed-file list, and `/review`'s
 * hunk step are one screen: a docked list where Space toggles the focused row,
 * `a` and `n` fill or clear the selection, Enter returns it, and the summary
 * names how much is chosen. The frame, the cursor arithmetic, the wheel, and the
 * height math come from the `lib/tui/` kit; this base owns the selection and the
 * keys, and a subclass supplies the rows, the row line, the detail block, the
 * summary text, and the hints.
 *
 * Value-only: the cursor and the selection live on the instance.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { detailBlockRows, dockListFrame, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { fitRows, formatRange, isCloseKey, ListCursor, navigateList, scrollList } from "../../lib/tui/cursor.ts";
import { emptyState } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";

/** Rows the checklist shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;
/** Header, summary, blanks, and footer rows around the list. */
const SCREEN_CHROME_ROWS = 6;

export interface ChecklistOptions {
	/** The header rule's label. */
	title: string;
	theme: Theme;
	/** Ask the host to repaint. */
	requestRender(): void;
	/** The terminal height source, for the visible-row count. */
	viewportRows?: ViewportRowsSource;
	/** The empty-list line; omit when an empty list is never shown. */
	emptyLabel?: string;
}

export abstract class ChecklistScreen<T> implements Component {
	/** Focus by row index: a checklist's rows are fixed for the life of the screen. */
	protected readonly cursor: ListCursor;
	/** Chosen row keys, in the order they were selected. */
	protected readonly chosen = new Set<string>();
	private seeded = false;

	constructor(protected readonly options: ChecklistOptions) {
		this.cursor = new ListCursor(options.requestRender);
	}

	/** The rows to show, in screen order. */
	protected abstract rows(): readonly T[];
	/** A row's stable key, which is what the selection holds. */
	protected abstract keyOf(row: T): string;
	/** One list line for `row`. */
	protected abstract rowLine(row: T, width: number, selected: boolean): string;
	/** The summary line's text, without its indent or paint role. */
	protected abstract summaryText(): string;
	/** The footer hint row. */
	protected abstract hint(width: number): string;
	/** Enter, with the chosen keys in selection order. */
	protected abstract onEnter(selection: string[]): void;
	/** Esc or q. */
	protected abstract onCancel(): void;
	/** The focus block under the list, painted and clipped; empty for none. */
	protected detailLines(_width: number): string[] {
		return [];
	}
	/** The keys selected on the first render. */
	protected initialSelection(): readonly string[] {
		return this.rows().map((row) => this.keyOf(row));
	}
	/** The keys `a` selects; defaults to every row. */
	protected selectableKeys(): readonly string[] {
		return this.rows().map((row) => this.keyOf(row));
	}
	/** Rows the detail block costs, for the visible-row count. */
	protected detailRows(detail: readonly string[]): number {
		return detailBlockRows(detail);
	}
	/** A verb other than navigation, toggle, all, none, and enter. */
	protected verb?(data: string): void;

	/**
	 * The row under the cursor.
	 *
	 * Not named `focused`: Pi's `Focusable` check is `"focused" in component`, and a
	 * component that answers it is handed the focus flag by assignment, which a
	 * read-only accessor turns into a process-ending `TypeError`. The checklist
	 * tracks its own cursor and needs no hardware cursor.
	 */
	protected get focusedRow(): T | undefined {
		return this.rows()[this.cursor.selected];
	}

	/** Paint through the theme. */
	protected get theme(): Theme {
		return this.options.theme;
	}

	/** Space on the focused row. */
	protected toggle(row: T): void {
		const key = this.keyOf(row);
		if (this.chosen.has(key)) this.chosen.delete(key);
		else this.chosen.add(key);
	}

	handleInput(data: string): void {
		this.seed();
		if (isCloseKey(data)) {
			this.onCancel();
			return;
		}
		if (navigateList(data, this.cursor, this.rows().length)) return;
		if (data === " ") {
			const row = this.focusedRow;
			if (row !== undefined) this.toggle(row);
			this.options.requestRender();
			return;
		}
		if (data === "a") {
			for (const key of this.selectableKeys()) this.chosen.add(key);
			this.options.requestRender();
			return;
		}
		if (data === "n") {
			this.chosen.clear();
			this.options.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.onEnter([...this.chosen]);
			return;
		}
		this.verb?.(data);
	}

	/** Wheel scrolling in fullscreen moves the cursor; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return scrollList(event, this.cursor, this.rows().length);
	}

	dispose(): void {}

	invalidate(): void {}

	render(width: number): string[] {
		this.seed();
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, this.options.title);
		const rows = this.rows();
		if (rows.length === 0 && this.options.emptyLabel !== undefined) {
			return dockListFrame({
				theme: this.theme,
				width: w,
				header,
				body: emptyState(this.theme, w, { label: this.options.emptyLabel }),
				hint: this.hint(w),
			});
		}

		const detail = this.detailLines(w);
		this.cursor.visible = fitRows(
			this.options.viewportRows,
			rows.length,
			SCREEN_CHROME_ROWS + this.detailRows(detail),
			SCREEN_DEFAULT_ITEMS,
		);
		const { start, end } = this.cursor.window(rows.length);
		const body: string[] = [];
		for (let index = start; index < end; index++) {
			body.push(this.rowLine(rows[index], w, index === this.cursor.selected));
		}

		return dockListFrame({
			theme: this.theme,
			width: w,
			header,
			summary: clip(`  ${paint(this.theme, "meta", this.summaryText())}`, w),
			body,
			range: this.cursor.clipped(rows.length)
				? formatRange(this.theme, w, { start, end, total: rows.length })
				: undefined,
			detail: detail.length > 0 ? detail : undefined,
			hint: this.hint(w),
		});
	}

	/** Fill the selection on the first interaction, after the subclass is built. */
	private seed(): void {
		if (this.seeded) return;
		this.seeded = true;
		for (const key of this.initialSelection()) this.chosen.add(key);
	}
}
