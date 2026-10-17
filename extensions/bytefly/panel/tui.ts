/**
 * The unified bytefly panel: one docked screen listing every extension with its
 * enable checkbox and its health.
 *
 * The component is derived: it rebuilds the merged model from the picker
 * runtime and the current reports on every render, keeps the focused row's key
 * across rebuilds, and requests a repaint only after an input changes state.
 * The screen is drawn from the design system — a label-first `titleRule`, one
 * `listRow` grammar, one `checkbox` — and its scroll math from
 * `lib/tui/cursor.ts`. A row without a report renders no glyph and no summary,
 * never a false `ok`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../lib/format.ts";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../../lib/tui/chrome.ts";
import { clip, fitCells, splitRow } from "../../../lib/tui/columns.ts";
import { fitRows, formatRange, isCloseKey, ListCursor, navIntent, wheelDelta } from "../../../lib/tui/cursor.ts";
import { checkbox, emptyState, listRow } from "../../../lib/tui/rows.ts";
import { titleRule } from "../../../lib/tui/rules.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import {
	detailLines as reportDetailLines,
	reportSeverity,
	reportSummary,
	severityGlyphChar,
	severityRole,
} from "../doctor/format.ts";
import type { ExtensionsPickerRuntime } from "../picker/runtime.ts";
import {
	SETTINGS_EMPTY_LABEL,
	sectionSegments,
	settingsSummarySegments,
	summarySegments,
	type SummarySegment,
} from "./format.ts";
import { buildPanelModel } from "./join.ts";
import type { PanelModel, PanelRow, PanelSection } from "./types.ts";

/** Body rows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 16;
/** Fixed rows around the body: header, summary, blank, blank, hint, blank. */
const FRAME_ROWS = 6;
/** Detail rows reserved for the focused extension's findings. */
const DETAIL_ROWS = 4;
/** Body rows that must survive before the detail pane collapses to its title. */
const MIN_BODY_ROWS = 3;

/** A flat display entry: a group header or a selectable row. */
type PanelEntry = { kind: "group"; key: string; label: string; count: number } | { kind: "row"; row: PanelRow };

/** The next row from `from` in `direction`, or `undefined` when there is none. */
function nextRow(entries: PanelEntry[], from: number, direction: -1 | 1): number | undefined {
	for (let index = from + direction; index >= 0 && index < entries.length; index += direction) {
		if (entries[index].kind === "row") return index;
	}
	return undefined;
}

/** Interleave the model's groups and rows into one display list. */
function entriesOf(model: PanelModel): PanelEntry[] {
	const entries: PanelEntry[] = [];
	for (const group of model.groups) {
		entries.push({ kind: "group", key: group.key, label: group.label, count: group.count });
		for (const row of model.rows) {
			if (row.group === group.key) entries.push({ kind: "row", row });
		}
	}
	return entries;
}

/** Terminal rows, or `undefined` when the height is unknown. */
function totalRows(source: ViewportRowsSource | undefined): number | undefined {
	const rows = typeof source === "function" ? source() : source;
	return rows !== undefined && Number.isFinite(rows) && rows > 0 ? rows : undefined;
}

/** Host seams for the panel screen, injected by the command runner. */
export interface PanelComponentOptions {
	/** The session's picker runtime: items, scope, toggles, dirty flag. */
	runtime: ExtensionsPickerRuntime;
	/** Current reports; read on every render so a refresh is picked up. */
	reports: () => readonly ExtensionReport[];
	/** Narrow to one extension directory, when the command named one. */
	filter?: string;
	/** The active section to open on; Extensions by default. */
	section?: PanelSection;
	theme: Theme;
	agentDir: string;
	/** Live terminal height, for the row budget. */
	viewportRows?: ViewportRowsSource;
	requestRender: () => void;
	/** Re-probe with refresh; awaited before the busy state clears. */
	refresh: () => void | Promise<void>;
	onClose: () => void;
	onNotice?: (message: string) => void;
}

/** The docked bytefly panel. */
export class PanelComponent implements Component {
	private readonly cursors: Record<PanelSection, ListCursor>;
	/** Serialises toggles so a rapid double press toggles twice, not once. */
	private chain: Promise<void> = Promise.resolve();
	/** Focused row key per section, so it survives a rebuild that reorders rows. */
	private readonly focusedKeys: Record<PanelSection, string | undefined> = {
		extensions: undefined,
		settings: undefined,
	};
	/** Whether the detail pane shows every check or only problems. */
	private showDetail = false;
	/** True while a re-probe is in flight, so `r` does not stack probes. */
	private refreshing = false;
	/** The visible section. Settings is an empty shell for now. */
	private section: PanelSection;

	constructor(private readonly options: PanelComponentOptions) {
		const requestRender = (): void => this.options.requestRender();
		this.cursors = { extensions: new ListCursor(requestRender), settings: new ListCursor(requestRender) };
		this.section = options.section ?? "extensions";
	}

	/** The active section's cursor. */
	private get cursor(): ListCursor {
		return this.cursors[this.section];
	}

	/** The active theme, read live on every render. */
	private get theme(): Theme {
		return this.options.theme;
	}

	invalidate(): void {
		// Everything is rebuilt from live state on each render.
	}

	/** The merged model for the current items and reports. */
	private model(): PanelModel {
		return buildPanelModel({
			items: this.options.runtime.items(),
			reports: this.options.reports(),
			agentDir: this.options.agentDir,
			filter: this.options.filter,
		});
	}

	private entries(): PanelEntry[] {
		return entriesOf(this.model());
	}

	/** Keep the focus on the same row key when the list shape changes. */
	private retainFocus(entries: PanelEntry[]): void {
		const entry = entries[this.cursor.selected];
		if (entry?.kind === "row") {
			this.focusedKeys[this.section] = entry.row.key;
			return;
		}
		const focusedKey = this.focusedKeys[this.section];
		if (focusedKey === undefined) return;
		const index = entries.findIndex((candidate) => candidate.kind === "row" && candidate.row.key === focusedKey);
		if (index >= 0) this.cursor.selected = index;
	}

	/** Move onto the first row when the focus is not already on one. */
	private clampSelection(entries: PanelEntry[]): void {
		if (entries[this.cursor.selected]?.kind === "row") return;
		const first = entries.findIndex((entry) => entry.kind === "row");
		if (first >= 0) this.cursor.selected = first;
	}

	private firstRow(): number | undefined {
		const index = this.entries().findIndex((entry) => entry.kind === "row");
		return index >= 0 ? index : undefined;
	}

	private lastRow(): number | undefined {
		const entries = this.entries();
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			if (entries[index].kind === "row") return index;
		}
		return undefined;
	}

	private select(index: number | undefined): void {
		if (index === undefined) return;
		this.cursor.set(index, this.entries().length);
	}

	/** Move `delta` rows, skipping group headers. */
	private move(delta: number): void {
		if (delta === 0) return;
		this.clampSelection(this.entries());
		const entries = this.entries();
		const direction = delta < 0 ? -1 : 1;
		let index = this.cursor.selected;
		let remaining = Math.abs(delta);
		while (remaining > 0) {
			const next = nextRow(entries, index, direction);
			if (next === undefined) break;
			index = next;
			remaining -= 1;
		}
		this.select(index);
	}

	private switchScope(): void {
		const next = this.options.runtime.scope() === "global" ? "project" : "global";
		if (next === "project" && !this.options.runtime.projectAvailable()) {
			this.options.onNotice?.("Project is not trusted; manage extensions in Global scope only.");
			return;
		}
		this.options.runtime.setScope(next);
		this.options.requestRender();
	}

	private toggle(): void {
		const entry = this.entries()[this.cursor.selected];
		if (entry?.kind !== "row" || !entry.row.item) return;
		const item = entry.row.item;
		this.chain = this.chain
			.then(() => this.options.runtime.toggle(item))
			.catch(() => undefined)
			.then(() => this.options.requestRender());
	}

	/** Re-probe once; a second request while one is in flight is ignored. */
	async refresh(): Promise<void> {
		if (this.refreshing) return;
		this.refreshing = true;
		this.options.requestRender();
		try {
			await this.options.refresh();
		} catch (error) {
			this.options.onNotice?.(`Could not refresh: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.refreshing = false;
			this.options.requestRender();
		}
	}

	/** Show one of the two sections; each keeps its own cursor and focus. */
	private switchSection(next: PanelSection): void {
		if (next === this.section) return;
		this.section = next;
		this.options.requestRender();
	}

	handleInput(data: string): void {
		if (isCloseKey(data)) {
			this.options.onClose();
			return;
		}
		if (matchesKey(data, Key.left)) {
			this.switchSection("extensions");
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.switchSection("settings");
			return;
		}
		// Settings is an empty shell: there is no row to select or toggle yet.
		if (this.section === "settings") {
			if (matchesKey(data, Key.tab)) this.switchScope();
			return;
		}
		// An input can arrive before the first render; put the focus on a row.
		this.clampSelection(this.entries());
		if (matchesKey(data, Key.space)) {
			this.toggle();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.showDetail = !this.showDetail;
			this.options.requestRender();
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.switchScope();
			return;
		}
		if (matchesKey(data, "r")) {
			void this.refresh();
			return;
		}
		if (data === "g") {
			this.select(this.firstRow());
			return;
		}
		if (data === "G") {
			this.select(this.lastRow());
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
				this.select(this.firstRow());
				return;
			case "end":
				this.select(this.lastRow());
				return;
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		this.move(delta);
		return { handled: true };
	}

	/** The themed section bar: both section names, the active one accented. */
	private sectionBar(width: number, counts: string): string {
		const separator = paint(this.theme, "faint", " · ");
		const left = `  ${sectionSegments(this.section)
			.map((segment) => paint(this.theme, segment.color, segment.text))
			.join(separator)}`;
		return clip(splitRow(left, counts, width), width);
	}

	/** One section's counts as whole segments, so a narrow screen drops a count. */
	private counts(segments: readonly SummarySegment[], width: number): string {
		const separator = paint(this.theme, "faint", " · ");
		const styled = segments.map((segment) => paint(this.theme, segment.color, segment.text));
		return fitCells(styled, Math.max(1, width - 2), separator);
	}

	/** The Extensions section's counts, next to the section bar. */
	private extensionCounts(width: number, model: PanelModel): string {
		return this.counts(
			summarySegments(model, this.options.runtime.scope(), {
				filter: this.options.filter,
				compact: width < 72,
			}),
			width,
		);
	}

	/** The Settings shell: the section bar, an empty state, and no detail pane. */
	private renderSettings(width: number, header: string): string[] {
		const counts = this.counts(settingsSummarySegments(this.options.runtime.scope()), width);
		return dockListFrame({
			header,
			summary: this.sectionBar(width, counts),
			body: emptyState(this.theme, width, { label: SETTINGS_EMPTY_LABEL }),
			hint: this.hint(width),
		});
	}

	/** Key hints for the active section; whole hints drop as the width runs out. */
	private hint(width: number): string {
		const common = ["Esc close", "←/→"];
		const hints =
			this.section === "settings"
				? [...common, "Tab scope"]
				: [
						...common,
						"Space toggle",
						"Enter detail",
						"Tab scope",
						this.refreshing ? "refreshing…" : "r refresh",
						"↑/↓ select",
					];
		return screenHint(this.theme, width, hints);
	}

	private groupLine(entry: Extract<PanelEntry, { kind: "group" }>, width: number): string {
		const label = paint(this.theme, "meta", sanitizeLine(entry.label));
		const count = paint(this.theme, "faint", `(${entry.count})`);
		return clip(`  ${label} ${count}`, width);
	}

	private rowLine(row: PanelRow, selected: boolean, width: number): string {
		const severity = row.report ? reportSeverity(row.report) : undefined;
		return listRow(this.theme, width, {
			selected,
			// A reported-only row has no enable pattern, but still reserves the box
			// column so the list stays aligned.
			leading: row.item ? checkbox(this.theme, row.item.enabled) : " ",
			glyph: severity ? severityGlyphChar(severity) : " ",
			glyphRole: severity ? severityRole(severity) : "faint",
			label: sanitizeLine(row.label),
			labelRole: selected ? "accent" : row.item && !row.item.enabled ? "faint" : "label",
			trailing: row.report ? reportSummary(row.report) : undefined,
			trailingRole: severity === "missing" ? "bad" : severity === "degraded" ? "warn" : "faint",
		});
	}

	/** The focused row's label, findings, and the pending-changes note. */
	private detail(row: PanelRow | undefined, width: number, budget: number): string[] {
		const lines: string[] = [];
		if (row?.report) {
			const tail = reportSummary(row.report);
			const head = `${paint(this.theme, "meta", sanitizeLine(row.label))} ${paint(this.theme, "faint", "—")} ${paint(this.theme, row.report.enabled ? "meta" : "warn", tail)}`;
			lines.push(clip(`  ${head}`, width));
			if (budget > 0) lines.push(...reportDetailLines(row.report, this.theme, width, budget, this.showDetail));
		} else if (row?.item) {
			lines.push(clip(`  ${paint(this.theme, "meta", sanitizeLine(row.item.path))}`, width));
		}
		if (this.options.runtime.isDirty()) {
			lines.push(clip(`  ${paint(this.theme, "warn", "Saved · reload to apply")}`, width));
		}
		return lines;
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "bytefly");
		if (this.section === "settings") return this.renderSettings(w, header);

		const model = this.model();
		const entries = entriesOf(model);
		const summary = this.sectionBar(w, this.extensionCounts(w, model));

		if (entries.length === 0) {
			return dockListFrame({
				header,
				summary,
				body: emptyState(this.theme, w, { label: "No extensions found." }),
				hint: this.hint(w),
			});
		}

		this.retainFocus(entries);
		this.clampSelection(entries);

		const focusedEntry = entries[this.cursor.selected];
		const focused = focusedEntry?.kind === "row" ? focusedEntry.row : undefined;
		const total = totalRows(this.options.viewportRows);
		const detailBudget = total !== undefined && total < FRAME_ROWS + 1 + MIN_BODY_ROWS + DETAIL_ROWS ? 0 : DETAIL_ROWS;
		const detail = this.detail(focused, w, detailBudget);

		this.cursor.visible = fitRows(
			this.options.viewportRows,
			entries.length,
			FRAME_ROWS + detail.length,
			SCREEN_DEFAULT_ROWS,
		);
		this.cursor.sync(entries.length);
		const { start, end } = this.cursor.window(entries.length);

		const body: string[] = [];
		for (let index = start; index < end; index += 1) {
			const entry = entries[index];
			if (entry.kind === "group") body.push(this.groupLine(entry, w));
			else body.push(this.rowLine(entry.row, index === this.cursor.selected, w));
		}

		return dockListFrame({
			header,
			summary,
			body,
			range: this.cursor.clipped(entries.length)
				? formatRange(this.theme, w, { start, end, total: entries.length })
				: undefined,
			detail: detail.length > 0 ? detail : undefined,
			hint: this.hint(w),
		});
	}
}
