/**
 * Terminal rendering for the watch extension's `/watch` screen.
 *
 * `WatchListComponent` is the dismissible `/watch` screen with a focused detail
 * pane and a matches view. It reads live state through injected closures and
 * tracks the selection by id so a live re-sort cannot move the cursor, through
 * the shared `IdCursor` and `LinePane`.
 *
 * The screen is drawn from the design system: a label-first `titleRule`, one
 * `listRow` grammar, and `emptyState`. Matched lines arrive already sanitized by
 * the runtime, so no untrusted escape sequence reaches the terminal here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip, fitCells } from "../../lib/tui/columns.ts";
import { fitRows, formatRange, IdCursor, isCloseKey, navIntent, wheelDelta } from "../../lib/tui/cursor.ts";
import { expandHint, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { LinePane } from "../../lib/tui/line-pane.ts";
import { emptyState, statusRow, type StatusRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { compareWatches, formatWatchDetail, shortLabel, statusGlyphChar, statusRole } from "./format.ts";
import type { WatchRecord } from "./types.ts";

/** Rows the `/watch` screen body shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 14;

/** Fixed rows around the list body: header, summary, blank, blank, hint, blank. */
const LIST_CHROME_ROWS = 7;

/** Fixed rows around the matches body: header, subtitle, blank, blank, hint, blank. */
const LINES_CHROME_ROWS = 6;

/** A watcher's stable identity, for the id-anchored cursor. */
const watchId = (watch: WatchRecord): string => watch.id;

/** One watcher row: marker, status glyph, id, label, and a right-aligned count. */
function watchRow(
	watch: WatchRecord,
	theme: Theme,
	width: number,
	options: Pick<StatusRow, "selected" | "marker"> = {},
): string {
	return statusRow(theme, width, {
		...options,
		glyph: statusGlyphChar(watch.status),
		glyphRole: statusRole(watch.status),
		label: `${watch.id}  ${shortLabel(watch)}`,
		trailing: `${watch.matchCount}`,
	});
}

/** Input for the transcript result: a themed watcher list or a matched-line tail. */
export type WatchResultInput =
	| { kind: "list"; watches: WatchRecord[]; more: number }
	| { kind: "lines"; label: string; lines: string[]; earlier: number };

/**
 * Transcript result block for the `watch` tool: a blank line, then either the
 * `/watch`-style row rail (already ordered and capped by the caller) or the
 * themed matched-line tail. Reused across renders via `setInput`.
 */
export class WatchResult implements Component {
	private input: WatchResultInput;
	private theme: Theme;

	constructor(input: WatchResultInput, theme: Theme) {
		this.input = input;
		this.theme = theme;
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: WatchResultInput, theme: Theme): void {
		this.input = input;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		// A leading blank line separates the result from the call header.
		const lines: string[] = [""];
		if (this.input.kind === "list") {
			for (const watch of this.input.watches) lines.push(watchRow(watch, this.theme, w, { marker: false }));
			if (this.input.more > 0) {
				const note = `${paint(this.theme, "faint", `… ${this.input.more} more`)} ${expandHint(this.theme)}`;
				lines.push(clip(`  ${note}`, w));
			}
		} else {
			if (this.input.earlier > 0) {
				const note = `${paint(this.theme, "faint", `… ${this.input.earlier} earlier ${this.input.label}`)} ${expandHint(this.theme)}`;
				lines.push(clip(note, w));
			}
			for (const line of this.input.lines) {
				lines.push(this.theme.fg("toolOutput", clip(line, w)));
			}
		}
		return lines;
	}
}

export interface WatchListCallbacks {
	/** Current matched lines for a watcher, or undefined when unknown. */
	lines(id: string): { lines: string[]; more?: boolean } | undefined;
	stop(id: string): void;
	clear(): void;
}

/** A destructive action waiting for y/N confirmation. */
type PendingConfirm = { kind: "stop"; id: string; label: string } | { kind: "clear"; count: number };

/** Dismissible `/watch` screen: a selectable list with a focus pane and a matches view. */
export class WatchListComponent implements Component {
	private mode: "list" | "lines" = "list";
	/** Focus anchored to a watcher id; the list is re-sorted from live state each render. */
	private readonly cursor = new IdCursor();
	/** The open matches tail. */
	private readonly pane = new LinePane();
	private confirm: PendingConfirm | undefined;
	private notice: string | undefined;

	constructor(
		private readonly watches: () => WatchRecord[],
		private readonly theme: Theme,
		private readonly callbacks: WatchListCallbacks,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
		private readonly viewportRowsSource?: ViewportRowsSource,
	) {}

	invalidate(): void {}

	/** Replace the matches pane contents (called by the command's poll loop). */
	setLines(title: string, lines: string[], meta: { more?: boolean } = {}): void {
		if (this.pane.update({ title, lines, more: meta.more })) this.requestRender();
	}

	/** The watcher whose matches pane is open, or undefined in list mode. */
	currentLineId(): string | undefined {
		return this.mode === "lines" && this.pane.id ? this.pane.id : undefined;
	}

	/** Re-read the open matches pane from the runtime. */
	refreshLines(id: string): void {
		const result = this.callbacks.lines(id);
		if (result && this.pane.update({ lines: result.lines, more: result.more })) this.requestRender();
	}

	private get ordered(): WatchRecord[] {
		return [...this.watches()].sort(compareWatches);
	}

	/** Focus watcher `next` (clamped) and keep it visible. */
	private select(next: number): void {
		const ordered = this.ordered;
		if (ordered.length === 0) return;
		this.cursor.select(ordered, watchId, next);
		this.requestRender();
	}

	private openLines(): void {
		const watch = this.ordered[this.cursor.indexOf(this.ordered, watchId)];
		if (!watch) return;
		this.mode = "lines";
		const result = this.callbacks.lines(watch.id);
		this.pane.open(watch.id, {
			title: `${watch.id} ${shortLabel(watch)}`,
			lines: result?.lines ?? [],
			more: result?.more ?? false,
		});
		this.requestRender();
	}

	handleInput(data: string): void {
		if (this.confirm) {
			this.handleConfirmInput(data);
			return;
		}
		if (this.mode === "list") this.handleListInput(data);
		else this.handleLinesInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		if (this.confirm) return { handled: true };
		if (this.mode === "list") {
			this.select(this.cursor.indexOf(this.ordered, watchId) + delta);
		} else {
			this.pane.setScroll(this.pane.scroll + delta);
			this.requestRender();
		}
		return { handled: true };
	}

	private handleListInput(data: string): void {
		if (isCloseKey(data) || data === "q") {
			this.onClose();
			return;
		}
		if (this.notice !== undefined) {
			this.notice = undefined;
			this.requestRender();
		}
		const ordered = this.ordered;
		const index = this.cursor.indexOf(ordered, watchId);
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
				this.select(ordered.length - 1);
				return;
		}
		if (matchesKey(data, Key.enter) || data === "l") {
			this.openLines();
		} else if (data === "x" || data === "K") {
			const watch = ordered[index];
			if (!watch) return;
			if (watch.status === "running") {
				this.confirm = { kind: "stop", id: watch.id, label: shortLabel(watch) };
			} else {
				this.notice = `${watch.id} is ${watch.status}; nothing to stop.`;
			}
			this.requestRender();
		} else if (data === "d") {
			const stopped = ordered.filter((watch) => watch.status !== "running");
			if (stopped.length > 0) this.confirm = { kind: "clear", count: stopped.length };
			else this.notice = "No stopped watchers to clear.";
			this.requestRender();
		}
	}

	private handleConfirmInput(data: string): void {
		const pending = this.confirm;
		if (!pending) return;
		if (data === "y" || data === "Y" || matchesKey(data, Key.enter)) {
			this.confirm = undefined;
			if (pending.kind === "stop") this.callbacks.stop(pending.id);
			else this.callbacks.clear();
			this.cursor.clamp(this.ordered, watchId);
			this.requestRender();
			return;
		}
		if (data === "n" || data === "N" || isCloseKey(data) || data === "q") {
			this.confirm = undefined;
			this.requestRender();
		}
	}

	private confirmPrompt(): string {
		const pending = this.confirm;
		if (!pending) return "";
		if (pending.kind === "stop") return `Stop ${pending.id} (${pending.label})? y/N`;
		return `Clear ${pending.count} stopped watcher${pending.count === 1 ? "" : "s"}? y/N`;
	}

	private handleLinesInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.backspace) || data === "q") {
			this.mode = "list";
			this.pane.close();
			this.requestRender();
			return;
		}
		if (this.pane.handleKey(data)) this.requestRender();
	}

	private summary(watches: WatchRecord[], width: number): string {
		const cells = [paint(this.theme, "meta", `${watches.length} watcher${watches.length === 1 ? "" : "s"}`)];
		const running = watches.filter((watch) => watch.status === "running").length;
		const matched = watches.reduce((sum, watch) => sum + watch.matchCount, 0);
		if (running > 0) cells.push(paint(this.theme, "meta", `${running} running`));
		if (matched > 0) cells.push(paint(this.theme, "accent", `${matched} matches`));
		const separator = paint(this.theme, "meta", SEPARATORS.item);
		return clip(`  ${fitCells(cells, Math.max(1, width - 2), separator)}`, width);
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.mode === "lines" ? this.renderLines(w) : this.renderList(w);
	}

	private renderList(w: number): string[] {
		const watches = this.ordered;
		this.cursor.clamp(watches, watchId);
		const index = this.cursor.indexOf(watches, watchId);
		const focused = watches[index];
		const detail = focused ? formatWatchDetail(focused, Date.now()) : [];
		this.cursor.visible = fitRows(
			this.viewportRowsSource,
			watches.length,
			LIST_CHROME_ROWS + detail.length,
			SCREEN_DEFAULT_ROWS,
		);
		this.cursor.clamp(watches, watchId);

		const body: string[] = [];
		let range: string | undefined;
		if (watches.length === 0) {
			body.push(...emptyState(this.theme, w, { label: "No watchers." }));
		} else {
			const end = Math.min(watches.length, this.cursor.scroll + this.cursor.visible);
			for (let i = this.cursor.scroll; i < end; i++)
				body.push(watchRow(watches[i], this.theme, w, { selected: i === index }));
			if (this.cursor.scroll > 0 || end < watches.length) {
				range = formatRange(this.theme, w, { start: this.cursor.scroll, end, total: watches.length });
			}
		}

		const hint = this.confirm
			? clip(`  ${paint(this.theme, "warn", this.confirmPrompt())}`, w)
			: this.notice
				? clip(`  ${paint(this.theme, "meta", this.notice)}`, w)
				: screenHint(this.theme, w, [
						"Esc close",
						"↑/↓ or j/k select",
						"Enter or l matches",
						"x or K stop",
						"d clear stopped",
						"PgUp/PgDn",
					]);

		return dockListFrame({
			header: titleRule(this.theme, w, "Watch"),
			summary: this.summary(watches, w),
			body,
			range,
			// The detail pane is separated from the list by a blank line.
			detail: ["", ...detail.map((line) => clip(`  ${paint(this.theme, "meta", line)}`, w))],
			hint,
		});
	}

	private renderLines(w: number): string[] {
		const visible = fitRows(this.viewportRowsSource, this.pane.count, LINES_CHROME_ROWS, SCREEN_DEFAULT_ROWS);
		this.pane.fit(visible);

		const body: string[] = [];
		let range: string | undefined;
		if (this.pane.count === 0) {
			body.push(...emptyState(this.theme, w, { label: "No matches yet." }));
		} else {
			const { start, end } = this.pane.window();
			for (let i = start; i < end; i++) body.push(clip(`  ${this.pane.lines[i]}`, w));
			if (start > 0 || end < this.pane.count) {
				range = formatRange(this.theme, w, { start, end, total: this.pane.count, label: "line" });
			}
		}

		return dockListFrame({
			header: titleRule(this.theme, w, this.pane.title("Watch Matches")),
			summary: clip(`  ${paint(this.theme, "faint", this.pane.subtitleLine())}`, w),
			body,
			range,
			hint: screenHint(this.theme, w, ["Esc back", "↑/↓ scroll", "g/G ends", "PgUp/PgDn"]),
		});
	}
}
