/**
 * Terminal rendering for the checkpoint list.
 *
 * `CheckpointListComponent` is the selectable screen `/checkpoint` opens in the
 * TUI. Rows are id-free and width-safe so the friendly prompt label stays
 * readable in a narrow terminal; the model-facing and headless text lists keep
 * the ids for scripting. The component resolves the chosen action through
 * `onClose`, so the command runs the confirm dialog only after the screen is
 * gone and input focus is free again.
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
import { screenHeader, viewportRows, type ViewportRowsSource } from "../_shared/tui.ts";
import { formatChangeSummary, formatCheckpointRow } from "./format.ts";
import type { Checkpoint } from "./types.ts";

/** What the user chose from the list. */
export type CheckpointAction =
	| { action: "diff"; checkpoint: Checkpoint }
	| { action: "restore"; checkpoint: Checkpoint }
	| { action: "save" }
	| { action: "clear" };

/** Change counts for the focused checkpoint's preview. */
export interface CheckpointStats {
	changed: number;
	removed: number;
}

export interface CheckpointListOptions {
	checkpoints: Checkpoint[];
	theme: Theme;
	/** Called once when the screen closes, with the chosen action or undefined. */
	onClose: (action?: CheckpointAction) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
	/** Load change stats for the focused checkpoint. Results are cached per id. */
	loadStats?: (checkpoint: Checkpoint) => Promise<CheckpointStats>;
}

/** Rows the screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;
/** Header, summary, blanks, and footer rows around the list (excluding the optional range and detail rows). */
const SCREEN_CHROME_ROWS = 8;

/** Selectable, scrollable checkpoint list opened by `/checkpoint`. */
export class CheckpointListComponent implements Component {
	private selected = 0;
	private scrollTop = 0;
	private disposed = false;
	private visible = SCREEN_DEFAULT_ITEMS;
	private readonly stats = new Map<string, CheckpointStats>();
	private readonly loading = new Set<string>();
	private readonly errors = new Map<string, string>();

	constructor(private readonly options: CheckpointListOptions) {
		this.loadFocusedStats();
	}

	private get checkpoints(): Checkpoint[] {
		return this.options.checkpoints;
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	/** Move the cursor, keep it on screen, and load its preview. */
	private setSelected(next: number): void {
		if (this.checkpoints.length === 0) return;
		const clamped = Math.min(Math.max(0, next), this.checkpoints.length - 1);
		if (clamped === this.selected) return;
		this.selected = clamped;
		if (this.selected < this.scrollTop) this.scrollTop = this.selected;
		else if (this.selected >= this.scrollTop + this.visible) this.scrollTop = this.selected - this.visible + 1;
		this.loadFocusedStats();
		this.options.requestRender();
	}

	/** Fire the stats loader once for the focused checkpoint. */
	private loadFocusedStats(): void {
		const load = this.options.loadStats;
		const checkpoint = this.checkpoints[this.selected];
		if (!load || !checkpoint) return;
		const id = checkpoint.id;
		if (this.stats.has(id) || this.loading.has(id) || this.errors.has(id)) return;
		this.loading.add(id);
		void load(checkpoint).then(
			(stats) => {
				this.loading.delete(id);
				this.stats.set(id, stats);
				if (!this.disposed) this.options.requestRender();
			},
			(error: unknown) => {
				this.loading.delete(id);
				this.errors.set(id, (error as Error)?.message || "could not preview");
				if (!this.disposed) this.options.requestRender();
			},
		);
	}

	private detailFor(checkpoint: Checkpoint | undefined): string {
		if (!checkpoint) return "";
		const error = this.errors.get(checkpoint.id);
		if (error) return `can't preview: ${error}`;
		const stats = this.stats.get(checkpoint.id);
		if (stats) return formatChangeSummary(stats.changed, stats.removed);
		if (this.loading.has(checkpoint.id)) return "checking changes…";
		return "";
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.options.onClose(undefined);
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") this.setSelected(this.selected - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.setSelected(this.selected + 1);
		else if (matchesKey(data, Key.pageUp)) this.setSelected(this.selected - this.visible);
		else if (matchesKey(data, Key.pageDown)) this.setSelected(this.selected + this.visible);
		else if (matchesKey(data, Key.home)) this.setSelected(0);
		else if (matchesKey(data, Key.end)) this.setSelected(this.checkpoints.length - 1);
		else if (matchesKey(data, Key.enter) || data === "r") {
			const checkpoint = this.checkpoints[this.selected];
			if (checkpoint) this.options.onClose({ action: "restore", checkpoint });
		} else if (data === "d") {
			const checkpoint = this.checkpoints[this.selected];
			if (checkpoint) this.options.onClose({ action: "diff", checkpoint });
		} else if (data === "s") {
			this.options.onClose({ action: "save" });
		} else if (data === "c") {
			this.options.onClose({ action: "clear" });
		}
	}

	/** Wheel scrolling in fullscreen moves the cursor; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.setSelected(this.selected + event.wheelDelta);
		return { handled: true };
	}

	dispose(): void {
		this.disposed = true;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const lines: string[] = [screenHeader(this.theme, w, "Checkpoints"), ""];

		if (this.checkpoints.length === 0) {
			lines.push(
				truncateToWidth(
					`  ${this.theme.fg("dim", "No checkpoints yet. Use /checkpoint save before a risky change.")}`,
					w,
				),
			);
		} else {
			const count = `${this.checkpoints.length} checkpoint${this.checkpoints.length === 1 ? "" : "s"}`;
			lines.push(truncateToWidth(`  ${this.theme.fg("muted", `${count} · newest first`)}`, w));
			lines.push("");
			const hasDetail = Boolean(this.detailFor(this.checkpoints[this.selected]));
			let visible = viewportRows(this.options.viewportRows, {
				chrome: SCREEN_CHROME_ROWS + (hasDetail ? 1 : 0),
				fallback: SCREEN_DEFAULT_ITEMS,
			});
			// Reserve the range row only when the list is longer than the viewport.
			if (this.checkpoints.length > visible) {
				visible = viewportRows(this.options.viewportRows, {
					chrome: SCREEN_CHROME_ROWS + (hasDetail ? 1 : 0) + 1,
					fallback: SCREEN_DEFAULT_ITEMS,
				});
			}
			this.visible = visible;
			const end = Math.min(this.checkpoints.length, this.scrollTop + visible);
			for (let i = this.scrollTop; i < end; i++) {
				const selected = i === this.selected;
				const row = formatCheckpointRow(this.checkpoints[i], Date.now(), Math.max(1, w - 2));
				const marker = selected ? this.theme.fg("accent", "❯ ") : "  ";
				const body = selected ? this.theme.fg("accent", row) : this.theme.fg("dim", row);
				lines.push(truncateToWidth(marker + body, w));
			}
			if (this.scrollTop > 0 || end < this.checkpoints.length) {
				lines.push(
					truncateToWidth(
						this.theme.fg("dim", `  showing ${this.scrollTop + 1}–${end} of ${this.checkpoints.length}`),
						w,
					),
				);
			}
			lines.push("");
			const detail = hasDetail ? this.detailFor(this.checkpoints[this.selected]) : "";
			if (detail) lines.push(truncateToWidth(`  ${this.theme.fg("muted", detail)}`, w));
		}

		const hint =
			this.checkpoints.length === 0
				? "s save · Esc close"
				: "Enter restore · d diff · s save · c clear · Esc close";
		lines.push(truncateToWidth(`  ${this.theme.fg("dim", hint)}`, w));
		lines.push("");
		return lines;
	}
}
