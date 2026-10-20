/**
 * Terminal rendering for the watch extension's `/watch` screen.
 *
 * `WatchListComponent` is the dismissible `/watch` screen with a focused detail
 * pane and a matches view. It reads live state through injected closures and
 * tracks the selection by id so a live re-sort cannot move the cursor, through
 * the shared `IdCursor` and `LinePane`.
 *
 * The frame, the navigation keys, the y/N confirmation, and the matches pane come
 * from the shared `DockListScreen`, so this module owns only the watch
 * vocabulary: the row, the focus block, the counts, the hints, and what the
 * verbs do. Matched lines arrive already sanitized by the runtime, so no
 * untrusted escape sequence reaches the terminal here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { ScreenHint, ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { DockListScreen, type DetailContents } from "../../lib/tui/dock-screen.ts";
import { expandHint } from "../../lib/tui/glyphs.ts";
import { statusRow, type StatusRow } from "../../lib/tui/rows.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { compareWatches, formatWatchDetail, shortLabel, statusGlyphChar, statusRole } from "./format.ts";
import type { WatchRecord } from "./types.ts";

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
		labelRole: options.selected ? "accent" : "label",
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

/** Dismissible `/watch` screen: a selectable list with a focus pane and a matches view. */
export class WatchListComponent extends DockListScreen<WatchRecord> {
	constructor(
		private readonly watches: () => WatchRecord[],
		theme: Theme,
		private readonly callbacks: WatchListCallbacks,
		onClose: () => void,
		requestRender: () => void,
		viewportRowsSource?: ViewportRowsSource,
	) {
		super({
			theme,
			title: "Watch",
			detailTitle: "Watch Matches",
			emptyList: "No watchers.",
			emptyDetail: "No matches yet.",
			requestRender,
			onClose,
			viewportRowsSource,
		});
	}

	/** Replace the matches pane contents (called by the command's poll loop). */
	setLines(title: string, lines: string[], meta: { more?: boolean } = {}): void {
		this.setDetail({ title, lines, more: meta.more });
	}

	/** The watcher whose matches pane is open, or undefined in list mode. */
	currentLineId(): string | undefined {
		return this.currentDetailId();
	}

	/** Re-read the open matches pane from the runtime. */
	refreshLines(id: string): void {
		this.refreshDetail(id);
	}

	protected rows(): readonly WatchRecord[] {
		return [...this.watches()].sort(compareWatches);
	}

	protected idOf(watch: WatchRecord): string {
		return watch.id;
	}

	protected rowLine(watch: WatchRecord, width: number, selected: boolean): string {
		return watchRow(watch, this.theme, width, { selected });
	}

	protected detailBlock(watch: WatchRecord): string[] {
		return formatWatchDetail(watch, Date.now());
	}

	protected summaryCells(rows: readonly WatchRecord[]): string[] {
		const cells = [paint(this.theme, "meta", `${rows.length} watcher${rows.length === 1 ? "" : "s"}`)];
		const running = rows.filter((watch) => watch.status === "running").length;
		const matched = rows.reduce((sum, watch) => sum + watch.matchCount, 0);
		if (running > 0) cells.push(paint(this.theme, "meta", `${running} running`));
		if (matched > 0) cells.push(paint(this.theme, "accent", `${matched} matches`));
		return cells;
	}

	protected listHints(): ScreenHint[] {
		return [
			"Esc close",
			"↑/↓ or j/k select",
			{ text: "Enter or l matches", color: "accent" },
			{ text: "x or K stop", color: "warning" },
			{ text: "d clear stopped", color: "warning" },
			"PgUp/PgDn",
		];
	}

	protected detailHints(): ScreenHint[] {
		return ["Esc back", "↑/↓ scroll", "g/G ends", "PgUp/PgDn"];
	}

	protected detailFor(watch: WatchRecord): DetailContents {
		const result = this.callbacks.lines(watch.id);
		return {
			title: `${watch.id} ${shortLabel(watch)}`,
			lines: result?.lines ?? [],
			more: result?.more ?? false,
		};
	}

	protected detailById(id: string): { lines: string[]; more?: boolean } | undefined {
		return this.callbacks.lines(id);
	}

	protected handleVerb(key: string, watch: WatchRecord | undefined): void {
		if (key === "x" || key === "K") {
			if (!watch) return;
			if (watch.status === "running") {
				this.confirm(`Stop ${watch.id} (${shortLabel(watch)})? y/N`, () => this.callbacks.stop(watch.id));
			} else {
				this.notify(`${watch.id} is ${watch.status}; nothing to stop.`);
			}
			return;
		}
		if (key !== "d") return;
		const stopped = this.rows().filter((row) => row.status !== "running");
		if (stopped.length === 0) {
			this.notify("No stopped watchers to clear.");
			return;
		}
		this.confirm(`Clear ${stopped.length} stopped watcher${stopped.length === 1 ? "" : "s"}? y/N`, () =>
			this.callbacks.clear(),
		);
	}
}
