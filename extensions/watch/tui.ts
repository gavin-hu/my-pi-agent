/**
 * Terminal rendering for the watch extension's `/watch` screen.
 *
 * `WatchListComponent` is the dismissible `/watch` screen with a focused detail
 * pane and a matches view. It reads live state through injected closures and
 * tracks the selection by id so a live re-sort cannot move the cursor. Every
 * line is clipped with `truncateToWidth`; matched lines arrive already sanitized
 * by the runtime, so no untrusted escape sequence reaches the terminal here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
	clampScroll,
	fitRows,
	formatRange,
	isCloseKey,
	keepVisible,
	navIntent,
	navigateScroll,
	selectionMarker,
	wheelDelta,
} from "../../lib/list-cursor.ts";
import { screenHeader, screenHint, type ViewportRowsSource } from "../../lib/tui.ts";
import { expandHint } from "../../lib/ui.ts";
import { compareWatches, formatWatchDetail, shortLabel, statusGlyph } from "./format.ts";
import type { WatchRecord } from "./types.ts";

/** Rows the `/watch` screen body shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 14;

/** One watcher row: marker, status glyph, id, label, and match count. */
function watchRow(watch: WatchRecord, theme: Theme, width: number, selected = false): string {
	const head = `${selectionMarker(theme, selected)}${statusGlyph(watch.status, theme)} ${watch.id}  `;
	const count = `${watch.matchCount}`;
	const available = Math.max(1, width - visibleWidth(head) - count.length - 1);
	const clipped = truncateToWidth(shortLabel(watch), available, "…");
	const pad = " ".repeat(Math.max(0, available - visibleWidth(clipped)));
	return truncateToWidth(`${head}${clipped}${pad} ${theme.fg("dim", count)}`, width);
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
			for (const watch of this.input.watches) lines.push(watchRow(watch, this.theme, w));
			if (this.input.more > 0) {
				lines.push(
					truncateToWidth(`  ${this.theme.fg("dim", `… ${this.input.more} more`)} ${expandHint(this.theme)}`, w, "…"),
				);
			}
		} else {
			if (this.input.earlier > 0) {
				lines.push(
					truncateToWidth(
						`${this.theme.fg("dim", `… ${this.input.earlier} earlier ${this.input.label}`)} ${expandHint(this.theme)}`,
						w,
						"…",
					),
				);
			}
			for (const line of this.input.lines) {
				lines.push(this.theme.fg("toolOutput", truncateToWidth(line, w, "…")));
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
	/** Stable selection identity; survives the live re-sort of the watcher list. */
	private selectedId: string | undefined;
	private listScroll = 0;
	/** Watcher whose matches pane is open; captured so a re-sort cannot switch it. */
	private lineWatchId: string | undefined;
	private lineScroll = 0;
	private lineLines: string[] = [];
	private lineTitle = "";
	private lineMore = false;
	private follow = true;
	private confirm: PendingConfirm | undefined;
	private notice: string | undefined;
	private visible = SCREEN_DEFAULT_ROWS;

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
		const titleChanged = title !== this.lineTitle;
		const linesChanged = !this.sameLines(lines);
		const moreChanged = meta.more !== undefined && meta.more !== this.lineMore;
		this.lineTitle = title;
		this.lineLines = lines;
		if (meta.more !== undefined) this.lineMore = meta.more;
		if (this.follow) this.lineScroll = this.maxLineScroll;
		else this.lineScroll = Math.min(this.lineScroll, this.maxLineScroll);
		if (titleChanged || linesChanged || moreChanged) this.requestRender();
	}

	private sameLines(next: string[]): boolean {
		if (next.length !== this.lineLines.length) return false;
		for (let i = 0; i < next.length; i++) if (next[i] !== this.lineLines[i]) return false;
		return true;
	}

	/** The watcher whose matches pane is open, or undefined in list mode. */
	currentLineId(): string | undefined {
		return this.mode === "lines" ? this.lineWatchId : undefined;
	}

	/** Re-read the open matches pane from the runtime. */
	refreshLines(id: string): void {
		const result = this.callbacks.lines(id);
		if (result) this.setLines(this.lineTitle, result.lines, { more: result.more });
	}

	private get ordered(): WatchRecord[] {
		return [...this.watches()].sort(compareWatches);
	}

	private indexOfSelected(ordered: WatchRecord[]): number {
		if (ordered.length === 0) return 0;
		const index = this.selectedId ? ordered.findIndex((watch) => watch.id === this.selectedId) : -1;
		return index >= 0 ? index : 0;
	}

	private setSelection(next: number): void {
		const ordered = this.ordered;
		if (ordered.length === 0) return;
		const index = Math.min(Math.max(0, next), ordered.length - 1);
		this.selectedId = ordered[index].id;
		this.listScroll = Math.max(0, keepVisible(this.listScroll, index, this.visible));
		this.requestRender();
	}

	private clampSelection(): void {
		const ordered = this.ordered;
		if (ordered.length === 0) {
			this.selectedId = undefined;
			this.listScroll = 0;
			return;
		}
		this.selectedId = ordered[this.indexOfSelected(ordered)].id;
		this.listScroll = clampScroll(this.listScroll, ordered.length, this.visible);
	}

	private get maxLineScroll(): number {
		return Math.max(0, this.lineLines.length - this.visible);
	}

	private openLines(): void {
		const watch = this.ordered[this.indexOfSelected(this.ordered)];
		if (!watch) return;
		this.mode = "lines";
		this.lineWatchId = watch.id;
		this.lineScroll = 0;
		this.follow = true;
		this.lineLines = [];
		this.lineTitle = `${watch.id} ${shortLabel(watch)}`;
		this.lineMore = false;
		const result = this.callbacks.lines(watch.id);
		if (result) this.setLines(this.lineTitle, result.lines, { more: result.more });
		else this.requestRender();
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
		if (this.mode === "list") this.setSelection(this.indexOfSelected(this.ordered) + delta);
		else this.setLineScroll(this.lineScroll + delta);
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
		const index = this.indexOfSelected(ordered);
		switch (navIntent(data)) {
			case "up":
				this.setSelection(index - 1);
				return;
			case "down":
				this.setSelection(index + 1);
				return;
			case "pageUp":
				this.setSelection(index - this.visible);
				return;
			case "pageDown":
				this.setSelection(index + this.visible);
				return;
			case "home":
				this.setSelection(0);
				return;
			case "end":
				this.setSelection(ordered.length - 1);
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
			this.clampSelection();
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

	private setLineScroll(next: number): void {
		this.lineScroll = clampScroll(next, this.lineLines.length, this.visible);
		this.follow = this.lineScroll >= this.maxLineScroll;
		this.requestRender();
	}

	private handleLinesInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.backspace) || data === "q") {
			this.mode = "list";
			this.lineWatchId = undefined;
			this.requestRender();
			return;
		}
		const next = navigateScroll(data, this.lineScroll, this.lineLines.length, this.visible);
		if (next !== undefined) {
			this.setLineScroll(next);
			return;
		}
		if (data === "g") this.setLineScroll(0);
		else if (data === "G") this.setLineScroll(this.maxLineScroll);
	}

	private summary(watches: WatchRecord[], width: number): string {
		const sep = this.theme.fg("muted", " · ");
		let text = this.theme.fg("muted", `${watches.length} watcher${watches.length === 1 ? "" : "s"}`);
		const running = watches.filter((watch) => watch.status === "running").length;
		const matched = watches.reduce((sum, watch) => sum + watch.matchCount, 0);
		if (running > 0) text += sep + this.theme.fg("muted", `${running} running`);
		if (matched > 0) text += sep + this.theme.fg("accent", `${matched} matches`);
		return truncateToWidth(`  ${text}`, width);
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.mode === "lines" ? this.renderLines(w) : this.renderList(w);
	}

	private renderList(w: number): string[] {
		const watches = this.ordered;
		this.clampSelection();
		const index = this.indexOfSelected(watches);
		const focused = watches[index];
		const detail = focused ? formatWatchDetail(focused, Date.now()) : [];
		// header, summary, blank, blank-after-list, blank-after-detail, hint, blank
		const chrome = 7 + detail.length;
		this.visible = fitRows(this.viewportRowsSource, watches.length, chrome, SCREEN_DEFAULT_ROWS);
		this.clampSelection();

		const lines: string[] = [screenHeader(this.theme, w, "Watch"), this.summary(watches, w), ""];
		if (watches.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No watchers.")}`, w));
		} else {
			const end = Math.min(watches.length, this.listScroll + this.visible);
			for (let i = this.listScroll; i < end; i++) {
				lines.push(watchRow(watches[i], this.theme, w, i === index));
			}
			if (this.listScroll > 0 || end < watches.length) {
				lines.push(formatRange(this.theme, w, { start: this.listScroll, end, total: watches.length }));
			}
		}
		lines.push("");
		for (const line of detail) lines.push(truncateToWidth(`  ${this.theme.fg("muted", line)}`, w));
		lines.push("");
		lines.push(
			this.confirm
				? truncateToWidth(`  ${this.theme.fg("warning", this.confirmPrompt())}`, w)
				: this.notice
					? truncateToWidth(`  ${this.theme.fg("muted", this.notice)}`, w)
					: screenHint(this.theme, w, [
							"Esc close",
							"↑/↓ or j/k select",
							"Enter or l matches",
							"x or K stop",
							"d clear stopped",
							"PgUp/PgDn",
						]),
		);
		lines.push("");
		return lines;
	}

	private renderLines(w: number): string[] {
		// header, title, blank, blank-after-lines, hint, blank
		const chrome = 6;
		this.visible = fitRows(this.viewportRowsSource, this.lineLines.length, chrome, SCREEN_DEFAULT_ROWS);
		this.lineScroll = clampScroll(this.lineScroll, this.lineLines.length, this.visible);
		if (this.follow) this.lineScroll = this.maxLineScroll;

		const label = this.lineTitle ? `Watch Matches · ${this.lineTitle}` : "Watch Matches";
		const parts: string[] = [];
		if (this.lineMore && this.lineLines.length > 0) parts.push(`showing last ${this.lineLines.length} lines`);
		if (this.lineLines.length > 0) parts.push(this.follow ? "following" : "paused");
		const titleLine = truncateToWidth(`  ${this.theme.fg("dim", parts.join(" · "))}`, w);
		const lines: string[] = [screenHeader(this.theme, w, label), titleLine, ""];
		if (this.lineLines.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No matches yet.")}`, w));
		} else {
			const end = Math.min(this.lineLines.length, this.lineScroll + this.visible);
			for (let i = this.lineScroll; i < end; i++) {
				lines.push(truncateToWidth(`  ${this.lineLines[i]}`, w));
			}
			if (this.lineScroll > 0 || end < this.lineLines.length) {
				lines.push(
					formatRange(this.theme, w, { start: this.lineScroll, end, total: this.lineLines.length, label: "line" }),
				);
			}
		}
		lines.push("");
		lines.push(screenHint(this.theme, w, ["Esc back", "↑/↓ scroll", "g/G ends", "PgUp/PgDn"]));
		lines.push("");
		return lines;
	}
}
