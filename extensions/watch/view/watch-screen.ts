/**
 * The `/watch` screen: a dismissible list with a focused detail pane and a
 * matches view, drawn as a `DockListScreen`.
 *
 * It reads live state through injected closures and tracks the selection by id
 * so a live re-sort cannot move the cursor, through the shared `IdCursor` and
 * `LinePane`. The frame, the navigation keys, the y/N confirmation, and the
 * matches pane come from the shared `DockListScreen`, so this module owns only
 * the watch vocabulary: the rows, the focus block, the counts, the hints, and
 * what the verbs do. Matched lines arrive already sanitized by the runtime.
 *
 * Full-screen surfaces live under `view/` and load on first use: the `/watch`
 * command imports this module behind its TUI branch, so registration never
 * pays for it.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ScreenHint, ViewportRowsSource } from "../../../lib/tui/chrome.ts";
import { DockListScreen, type DetailContents } from "../../../lib/tui/dock-screen.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { compareWatches, formatWatchDetail, shortLabel, watchRow } from "../format.ts";
import type { WatchRecord } from "../types.ts";

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
			{ text: "x or K stop", color: "warn" },
			{ text: "d clear stopped", color: "warn" },
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
