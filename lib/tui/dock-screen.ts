/**
 * The two-mode docked list screen: a selectable list with a focus pane, and a
 * scrollable detail pane over one row.
 *
 * Every live list in this package has the same body: `/jobs`, `/watch`, the
 * agent board, and a check result all draw a title rule, a summary line, rows
 * under an id-anchored cursor, an optional focus block, a range note, and a
 * footer that shows either the key hints, a pending y/N confirmation, or one
 * line of feedback. Only the vocabulary differs — the row, the detail block, the
 * verbs, the words.
 *
 * So this class owns the frame, the navigation and scroll keys, the wheel, the
 * confirm layer, and the pane lifecycle; a subclass supplies `rows`, the row
 * line, the detail block, the summary cells, the hints, and what a verb does.
 * The cursor is anchored to a row id, so a live re-sort cannot move the focus or
 * swap the open detail out from under the user.
 *
 * Value-only: the cursor, pane, and pending state live on the instance.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { detailBlockRows, dockListFrame, screenHint, type ScreenHint, type ViewportRowsSource } from "./chrome.ts";
import { clip, fitCells } from "./columns.ts";
import { ConfirmState } from "./confirm.ts";
import { fitRows, formatRange, IdCursor, isCloseKey, navIntent, wheelDelta } from "./cursor.ts";
import { SEPARATORS } from "./glyphs.ts";
import { LinePane } from "./line-pane.ts";
import { emptyState } from "./rows.ts";
import { titleRule } from "./rules.ts";
import { paint } from "./tokens.ts";

/** Rows the body shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 14;

/** Fixed rows around the list body: header, summary, blank, blank, hint, blank. */
const LIST_CHROME_ROWS = 6;

/** Fixed rows around a detail body: header, subtitle, blank, blank, hint, blank. */
const DETAIL_CHROME_ROWS = 6;

/** What a detail pane shows: its title, lines, and the one-line subtitle. */
export interface DetailContents {
	/** Pane title, e.g. `j1 build`. */
	title: string;
	/** The body lines, already sanitized by the caller. */
	lines: string[];
	/** More lines exist above the ones supplied. */
	more?: boolean;
	/** Subtitle under the title, e.g. the log file path. */
	subtitle?: string;
}

/** What the pane can be refreshed from: the lines for one row id. */
export interface DetailSource {
	lines: string[];
	more?: boolean;
}

export interface DockListScreenOptions {
	theme: Theme;
	/** The header rule's label. */
	title: string;
	/** The detail pane's title when the opened row supplies none. */
	detailTitle: string;
	/** Empty-list line. */
	emptyList: string;
	/** Empty-detail line. */
	emptyDetail: string;
	/** Ask the host to repaint. */
	requestRender(): void;
	/** Close the screen. */
	onClose(): void;
	/** The terminal height source, for the visible-row count. */
	viewportRowsSource?: ViewportRowsSource;
}

/**
 * One docked list screen. Subclass it and implement the six hooks; the frame,
 * the keys, and the confirm layer are shared.
 */
export abstract class DockListScreen<T> implements Component {
	/** Focus anchored to a row id; the list is re-sorted from live state each render. */
	protected readonly cursor = new IdCursor();
	/** The open detail pane. */
	protected readonly pane = new LinePane();
	private mode: "list" | "detail" = "list";
	private readonly confirmState = new ConfirmState();
	private feedback: string | undefined;

	constructor(protected readonly options: DockListScreenOptions) {}

	/** The rows to show, already ordered. Re-read on every render. */
	protected abstract rows(): readonly T[];
	/** A row's stable id, for the cursor and the pane. */
	protected abstract idOf(row: T): string;
	/** One list line for `row`. */
	protected abstract rowLine(row: T, width: number, selected: boolean): string;
	/** The focus block under the list: one entry per line, unpainted. */
	protected abstract detailBlock(row: T): string[];
	/** The summary cells, painted by the subclass and joined by the base. */
	protected abstract summaryCells(rows: readonly T[]): string[];
	/** Footer hints while listing. */
	protected abstract listHints(): ScreenHint[];
	/** Footer hints while reading a detail pane. */
	protected abstract detailHints(): ScreenHint[];
	/** What to open for `row`, fetched fresh. */
	protected abstract detailFor(row: T): DetailContents;
	/** The lines to refresh an already-open pane with. */
	protected abstract detailById(id: string): DetailSource | undefined;
	/** A list-mode verb other than navigation, open, and close. */
	protected abstract handleVerb(key: string, focused: T | undefined): void;

	/** Paint through the theme. */
	protected get theme(): Theme {
		return this.options.theme;
	}

	/** The row under the cursor, if any. */
	protected get focused(): T | undefined {
		const rows = this.rows();
		return rows[this.cursor.indexOf(rows, (row) => this.idOf(row))];
	}

	/** Ask for a y/N confirmation before `accept` runs. */
	protected confirm(prompt: string, accept: () => void): void {
		this.confirmState.ask(prompt, accept);
		this.options.requestRender();
	}

	/** Show one line of feedback in place of the hints. */
	protected notify(text: string): void {
		this.feedback = text;
		this.options.requestRender();
	}

	/** Re-clamp the focus after a mutation removed the selected row. */
	protected resort(): void {
		this.cursor.clamp(this.rows(), (row) => this.idOf(row));
		this.options.requestRender();
	}

	invalidate(): void {}

	/** Replace the open detail pane's contents. */
	setDetail(contents: DetailContents): void {
		const changed =
			contents.subtitle === undefined
				? this.pane.update({ title: contents.title, lines: contents.lines, more: contents.more })
				: this.pane.update({
						title: contents.title,
						lines: contents.lines,
						more: contents.more,
						subtitle: contents.subtitle,
					});
		if (changed) this.options.requestRender();
	}

	/** The row id whose detail is open, or undefined in list mode. */
	currentDetailId(): string | undefined {
		return this.mode === "detail" && this.pane.id ? this.pane.id : undefined;
	}

	/** Re-read the open detail pane, so a poll cannot show stale lines. */
	refreshDetail(id: string): void {
		const source = this.detailById(id);
		if (source && this.pane.update({ lines: source.lines, more: source.more })) this.options.requestRender();
	}

	handleInput(data: string): void {
		if (this.confirmState.pending) {
			this.handleConfirmKey(data);
			return;
		}
		if (this.mode === "list") this.handleListKey(data);
		else this.handleDetailKey(data);
	}

	/** Wheel scrolling moves the selection, or scrolls the open pane. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		if (this.confirmState.pending) return { handled: true };
		if (this.mode === "list") {
			const rows = this.rows();
			this.select(this.cursor.indexOf(rows, (row) => this.idOf(row)) + delta);
		} else {
			this.pane.setScroll(this.pane.scroll + delta);
			this.options.requestRender();
		}
		return { handled: true };
	}

	private select(next: number): void {
		const rows = this.rows();
		if (rows.length === 0) return;
		this.cursor.select(rows, (row) => this.idOf(row), next);
		this.options.requestRender();
	}

	private openDetail(): void {
		const row = this.focused;
		if (!row) return;
		this.mode = "detail";
		this.pane.open(this.idOf(row), this.detailFor(row));
		this.options.requestRender();
	}

	private handleListKey(data: string): void {
		if (isCloseKey(data) || data === "q") {
			this.options.onClose();
			return;
		}
		// Any other key dismisses a prior notice, so it does not linger.
		if (this.feedback !== undefined) {
			this.feedback = undefined;
			this.options.requestRender();
		}
		const rows = this.rows();
		const index = this.cursor.indexOf(rows, (row) => this.idOf(row));
		switch (navIntent(data)) {
			case "up":
				this.select(index - 1);
				return;
			case "down":
				this.select(index + 1);
				return;
			case "pageUp":
				this.select(index - this.cursor.visible);
				return;
			case "pageDown":
				this.select(index + this.cursor.visible);
				return;
			case "home":
				this.select(0);
				return;
			case "end":
				this.select(rows.length - 1);
				return;
		}
		if (matchesKey(data, Key.enter) || data === "l") {
			this.openDetail();
			return;
		}
		this.handleVerb(data, this.focused);
	}

	private handleConfirmKey(data: string): void {
		const outcome = this.confirmState.resolve(data);
		if (!outcome) return;
		if (outcome === "accept") this.cursor.clamp(this.rows(), (row) => this.idOf(row));
		this.options.requestRender();
	}

	private handleDetailKey(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.backspace) || data === "q") {
			this.mode = "list";
			this.pane.close();
			this.options.requestRender();
			return;
		}
		if (this.pane.handleKey(data)) this.options.requestRender();
	}

	/** The footer: a pending confirmation, one line of feedback, or the hints. */
	private hint(width: number): string {
		const pending = this.confirmState.pending;
		if (pending) return clip(`  ${paint(this.theme, "warn", pending.prompt)}`, width);
		if (this.feedback) return clip(`  ${paint(this.theme, "meta", this.feedback)}`, width);
		return screenHint(this.theme, width, this.listHints());
	}

	private summary(rows: readonly T[], width: number): string {
		const separator = paint(this.theme, "meta", SEPARATORS.item);
		return clip(`  ${fitCells(this.summaryCells(rows), Math.max(1, width - 2), separator)}`, width);
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.mode === "detail" ? this.renderDetail(w) : this.renderList(w);
	}

	private renderList(w: number): string[] {
		const rows = this.rows();
		const id = (row: T): string => this.idOf(row);
		this.cursor.clamp(rows, id);
		const focused = rows[this.cursor.indexOf(rows, id)];
		const block = focused ? this.detailBlock(focused) : [];
		this.cursor.visible = fitRows(
			this.options.viewportRowsSource,
			rows.length,
			LIST_CHROME_ROWS + detailBlockRows(block),
			SCREEN_DEFAULT_ROWS,
		);
		this.cursor.clamp(rows, id);
		const index = this.cursor.indexOf(rows, id);
		this.cursor.ensureVisible(index);

		const body: string[] = [];
		let range: string | undefined;
		if (rows.length === 0) {
			body.push(...emptyState(this.theme, w, { label: this.options.emptyList }));
		} else {
			const end = Math.min(rows.length, this.cursor.scroll + this.cursor.visible);
			for (let i = this.cursor.scroll; i < end; i++) body.push(this.rowLine(rows[i], w, i === index));
			if (this.cursor.scroll > 0 || end < rows.length) {
				range = formatRange(this.theme, w, { start: this.cursor.scroll, end, total: rows.length });
			}
		}

		return dockListFrame({
			header: titleRule(this.theme, w, this.options.title),
			summary: this.summary(rows, w),
			body,
			range,
			detail: block.map((line) => clip(`  ${paint(this.theme, "meta", line)}`, w)),
			hint: this.hint(w),
		});
	}

	private renderDetail(w: number): string[] {
		const visible = fitRows(this.options.viewportRowsSource, this.pane.count, DETAIL_CHROME_ROWS, SCREEN_DEFAULT_ROWS);
		this.pane.fit(visible);

		const body: string[] = [];
		let range: string | undefined;
		if (this.pane.count === 0) {
			body.push(...emptyState(this.theme, w, { label: this.options.emptyDetail }));
		} else {
			const { start, end } = this.pane.window();
			for (let i = start; i < end; i++) body.push(clip(`  ${this.pane.lines[i]}`, w));
			if (start > 0 || end < this.pane.count) {
				range = formatRange(this.theme, w, { start, end, total: this.pane.count, label: "line" });
			}
		}

		return dockListFrame({
			header: titleRule(this.theme, w, this.pane.title(this.options.detailTitle)),
			summary: clip(`  ${paint(this.theme, "faint", this.pane.subtitleLine())}`, w),
			body,
			range,
			hint: screenHint(this.theme, w, this.detailHints()),
		});
	}
}
