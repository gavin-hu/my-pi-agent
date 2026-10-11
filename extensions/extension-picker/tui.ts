/**
 * The `/extensions` dock screen: a scrollable, keyboard-driven list of every
 * resolved extension with its group header.
 *
 * The component is derived: it reads `runtime.items()` on each render and
 * requests a repaint after a toggle or a scope switch through the injected
 * callbacks. It reuses the shared screen chrome (`lib/tui.ts`) and scroll math
 * (`lib/list-cursor.ts`) rather than re-deriving either.
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
import { sanitizeLine } from "../../lib/format.ts";
import { fitRows, formatRange, ListCursor, navIntent, selectionMarker, wheelDelta } from "../../lib/list-cursor.ts";
import { screenHeader, screenHint, type ViewportRowsSource } from "../../lib/tui.ts";
import { buildEntries, firstSelectable, nextSelectable } from "./resources.ts";
import type { ExtensionsManagerRuntime as Runtime } from "./runtime.ts";
import type { Entry } from "./types.ts";

/** Rows the screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 16;

/**
 * Fixed rows around the list: header, summary, blank, blank, hint, blank. The
 * focused-detail and pending-changes rows are added on top when present.
 */
const CHROME = 6;

export class ExtensionsListComponent implements Component {
	private readonly cursor: ListCursor;
	/** Serialises toggles so a rapid double press toggles twice, not once. */
	private chain: Promise<void> = Promise.resolve();

	constructor(
		private readonly runtime: Runtime,
		private readonly theme: Theme,
		private readonly agentDir: string,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
		private readonly viewportRowsSource?: ViewportRowsSource,
		private readonly onNotice?: (message: string) => void,
	) {
		this.cursor = new ListCursor(() => this.requestRender());
	}

	private entries(): Entry[] {
		return buildEntries(this.runtime.items(), this.agentDir);
	}

	private currentItem() {
		const entry = this.entries()[this.cursor.selected];
		return entry?.kind === "item" ? entry.item : undefined;
	}

	private select(index: number | undefined): void {
		if (index === undefined) return;
		this.cursor.set(index, this.entries().length);
	}

	/** Keep the cursor on an item row when the list shape changes. */
	private ensureSelectable(): void {
		const entries = this.entries();
		if (entries[this.cursor.selected]?.kind === "item") return;
		this.select(firstSelectable(entries));
	}

	/** Move the cursor onto an item row when the list shape changed. No repaint. */
	private clampSelection(entries: Entry[]): void {
		if (entries[this.cursor.selected]?.kind === "item") return;
		const first = firstSelectable(entries);
		if (first !== undefined) this.cursor.selected = first;
	}

	/** Move `delta` item rows, skipping group headers. */
	private move(delta: number): void {
		if (delta === 0) return;
		this.ensureSelectable();
		const entries = this.entries();
		const direction = delta < 0 ? -1 : 1;
		let index = this.cursor.selected;
		let remaining = Math.abs(delta);
		while (remaining > 0) {
			const next = nextSelectable(entries, index, direction);
			if (next === undefined) break;
			index = next;
			remaining -= 1;
		}
		this.cursor.set(index, entries.length);
	}

	private switchScope(): void {
		const next = this.runtime.scope() === "global" ? "project" : "global";
		if (next === "project" && !this.runtime.projectAvailable()) {
			this.onNotice?.("Project is not trusted; manage extensions in Global scope only.");
			return;
		}
		this.runtime.setScope(next);
		this.clampSelection(this.entries());
		this.requestRender();
	}

	private toggle(): void {
		const item = this.currentItem();
		if (!item) return;
		this.chain = this.chain
			.then(() => this.runtime.toggle(item))
			.catch(() => undefined)
			.then(() => this.requestRender());
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.onClose();
			return;
		}
		this.ensureSelectable();
		if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
			this.toggle();
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.switchScope();
			return;
		}
		if (data === "g") {
			this.select(firstSelectable(this.entries()));
			return;
		}
		if (data === "G") {
			this.select(nextSelectable(this.entries(), this.entries().length, -1));
			return;
		}
		switch (navIntent(data)) {
			case "up":
				this.move(-1);
				return;
			case "down":
				this.move(1);
				return;
			case "pageUp":
				this.move(-Math.max(1, this.cursor.visible));
				return;
			case "pageDown":
				this.move(Math.max(1, this.cursor.visible));
				return;
			case "home":
				this.select(firstSelectable(this.entries()));
				return;
			case "end":
				this.select(nextSelectable(this.entries(), this.entries().length, -1));
				return;
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		this.move(delta);
		return { handled: true };
	}

	invalidate(): void {
		// Everything is rebuilt from live state on each render.
	}

	private summary(width: number): string {
		const items = this.runtime.items();
		const scope = this.runtime.scope() === "global" ? "Global" : "Project";
		const untrusted = this.runtime.scope() === "global" && !this.runtime.projectAvailable();
		const counts = `${items.length} extension${items.length === 1 ? "" : "s"} · ${this.runtime.disabledCount()} disabled`;
		return truncateToWidth(
			`  ${this.theme.fg("accent", scope)}${untrusted ? this.theme.fg("warning", " (project untrusted)") : ""}${this.theme.fg("muted", ` · ${counts}`)}`,
			width,
			"…",
		);
	}

	private itemRow(entry: Extract<Entry, { kind: "item" }>, selected: boolean, width: number): string {
		const checkbox = entry.item.enabled ? this.theme.fg("success", "[x]") : this.theme.fg("dim", "[ ]");
		const label = sanitizeLine(entry.label);
		const styled = selected ? this.theme.fg("accent", label) : entry.item.enabled ? label : this.theme.fg("dim", label);
		return truncateToWidth(`${selectionMarker(this.theme, selected)}${checkbox} ${styled}`, width, "…");
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const entries = this.entries();
		const lines: string[] = [screenHeader(this.theme, w, "Extensions"), this.summary(w), ""];

		if (entries.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No extensions found.")}`, w));
			lines.push("");
			lines.push(screenHint(this.theme, w, ["Esc close"]));
			lines.push("");
			return lines;
		}

		this.clampSelection(entries);

		const focused = entries[this.cursor.selected];
		const detail = focused?.kind === "item" ? sanitizeLine(focused.item.path) : "";
		const chrome = CHROME + (detail ? 1 : 0) + (this.runtime.isDirty() ? 1 : 0);
		this.cursor.visible = fitRows(this.viewportRowsSource, entries.length, chrome, SCREEN_DEFAULT_ROWS);
		this.cursor.sync(entries.length);

		const { start, end } = this.cursor.window(entries.length);
		for (let index = start; index < end; index++) {
			const entry = entries[index];
			if (entry.kind === "group") {
				lines.push(
					truncateToWidth(
						`  ${this.theme.fg("muted", entry.label)} ${this.theme.fg("dim", `(${entry.count})`)}`,
						w,
						"…",
					),
				);
			} else {
				lines.push(this.itemRow(entry, index === this.cursor.selected, w));
			}
		}
		if (this.cursor.clipped(entries.length)) {
			lines.push(formatRange(this.theme, w, { start, end, total: entries.length }));
		}

		if (detail) lines.push(truncateToWidth(`  ${this.theme.fg("muted", detail)}`, w, "…"));
		if (this.runtime.isDirty()) {
			lines.push(truncateToWidth(`  ${this.theme.fg("warning", "Pending changes · close to apply")}`, w, "…"));
		}
		lines.push("");
		lines.push(screenHint(this.theme, w, ["Esc close", "Space/Enter toggle", "Tab scope", "↑/↓ select", "g/G"]));
		lines.push("");
		return lines;
	}
}
