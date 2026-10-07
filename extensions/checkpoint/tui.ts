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
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
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
	viewportRows?: number;
	/** Load change stats for the focused checkpoint. Results are cached per id. */
	loadStats?: (checkpoint: Checkpoint) => Promise<CheckpointStats>;
}

/** Rows the screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;
/** Never show fewer/more than this many rows, however tall the terminal. */
const SCREEN_MIN_ITEMS = 3;
const SCREEN_MAX_ITEMS = 20;
/** Header, summary, detail, footer, and blank rows the screen spends around items. */
const SCREEN_CHROME_ROWS = 9;

/** How many checkpoints fit in a terminal of `rows` rows (undefined falls back). */
function visibleItems(rows: number | undefined): number {
	if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return SCREEN_DEFAULT_ITEMS;
	return Math.max(SCREEN_MIN_ITEMS, Math.min(rows - SCREEN_CHROME_ROWS, SCREEN_MAX_ITEMS));
}

/** Top border with the title centered-left, exactly `width` columns wide. */
function screenHeader(theme: Theme, width: number): string {
	const label = " Checkpoints ";
	const prefix = "───";
	// Too narrow for the title and a border on each side: show a plain rule
	// rather than truncating the title into an ellipsis.
	if (width < visibleWidth(prefix) + visibleWidth(label) + 1) {
		return theme.fg("borderMuted", "─".repeat(width));
	}
	const remaining = width - visibleWidth(prefix) - visibleWidth(label);
	return theme.fg("borderMuted", prefix) + theme.fg("accent", label) + theme.fg("borderMuted", "─".repeat(remaining));
}

/** Selectable, scrollable checkpoint list opened by `/checkpoint`. */
export class CheckpointListComponent implements Component {
	private selected = 0;
	private scrollTop = 0;
	private disposed = false;
	private readonly visible: number;
	private readonly stats = new Map<string, CheckpointStats>();
	private readonly loading = new Set<string>();
	private readonly errors = new Map<string, string>();

	constructor(private readonly options: CheckpointListOptions) {
		this.visible = visibleItems(options.viewportRows);
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

	dispose(): void {
		this.disposed = true;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const lines: string[] = [screenHeader(this.theme, w), ""];

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
			const end = Math.min(this.checkpoints.length, this.scrollTop + this.visible);
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
			const detail = this.detailFor(this.checkpoints[this.selected]);
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
