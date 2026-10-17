/**
 * The unified bytefly panel: two sections around one docked list.
 *
 * Extensions lists every resolved extension with its enable checkbox and its
 * health; Settings lists the curated preferences with their values. The
 * component is derived: it rebuilds the model from the picker runtime, the
 * reports, or the settings surface on every render, keeps the focused row's key
 * across rebuilds, and requests a repaint only after an input changes state.
 * The screen is drawn from the design system — a label-first `titleRule`, one
 * `listRow` grammar, one `checkbox` — and its scroll math from
 * `lib/tui/cursor.ts`. A row without a report renders no glyph and no summary,
 * never a false `ok`.
 */

import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../lib/format.ts";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../../lib/tui/chrome.ts";
import { clip, fitCells, splitRow } from "../../../lib/tui/columns.ts";
import { fitRows, formatRange, isCloseKey, ListCursor, navIntent, wheelDelta } from "../../../lib/tui/cursor.ts";
import { BODY_INDENT } from "../../../lib/tui/indent.ts";
import { checkbox, emptyState, listRow } from "../../../lib/tui/rows.ts";
import { titleRule } from "../../../lib/tui/rules.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { detailLines as reportDetailLines } from "../doctor/format.ts";
import type { ExtensionsPickerRuntime } from "../picker/runtime.ts";
import { rowBadge, sectionSegments, settingsSummarySegments, summarySegments, type SummarySegment } from "./format.ts";
import { buildPanelModel } from "./join.ts";
import { groupViews, type SettingView } from "./settings.ts";
import { configPath, type SettingsSurface } from "./settings-runtime.ts";
import type { PanelModel, PanelRow, PanelSection } from "./types.ts";

/** Body rows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 16;
/** Fixed rows around the body: header, summary, blank, blank, hint, blank. */
const FRAME_ROWS = 6;
/** Detail rows reserved for the focused row. */
const DETAIL_ROWS = 4;
/** Body rows that must survive before the detail pane collapses to its title. */
const MIN_BODY_ROWS = 3;
/** Detail rows when the terminal height is unknown and the focused row is expanded. */
const EXPANDED_DETAIL_FALLBACK = 8;
/** Pi's personal settings file, named in the detail pane. */
const PI_SETTINGS_FILE = "settings.json";
/** The body indent, shared by the note and the detail pane. */
const INDENT = " ".repeat(BODY_INDENT);

/** A flat display entry: a group header or a selectable row. */
type PanelEntry =
	| { kind: "group"; key: string; label: string; count: number }
	| { kind: "row"; row: PanelRow }
	| { kind: "setting"; setting: SettingView };

/** A selectable entry's stable key, or `undefined` for a group header. */
function entryKey(entry: PanelEntry | undefined): string | undefined {
	if (entry?.kind === "row") return entry.row.key;
	if (entry?.kind === "setting") return entry.setting.id;
	return undefined;
}

/** Whether an entry can take the focus. */
function isSelectable(entry: PanelEntry | undefined): boolean {
	return entryKey(entry) !== undefined;
}

/** The next selectable entry from `from` in `direction`, or `undefined`. */
function nextRow(entries: PanelEntry[], from: number, direction: -1 | 1): number | undefined {
	for (let index = from + direction; index >= 0 && index < entries.length; index += direction) {
		if (isSelectable(entries[index])) return index;
	}
	return undefined;
}

/** Interleave the extension model's groups and rows into one display list. */
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

/** Interleave the settings views into the same group/row display list. */
function settingEntries(views: readonly SettingView[]): PanelEntry[] {
	const entries: PanelEntry[] = [];
	for (const group of groupViews(views)) {
		entries.push({ kind: "group", key: group.key, label: group.label, count: group.views.length });
		for (const view of group.views) entries.push({ kind: "setting", setting: view });
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
	/** The Settings section's rows, values, and writes. */
	settings: SettingsSurface;
	/** Narrow to one extension directory, when the command named one. */
	filter?: string;
	/** The active section to open on; Extensions by default. */
	section?: PanelSection;
	theme: Theme;
	agentDir: string;
	/** The session working directory, for the config-file path in the detail pane. */
	cwd: string;
	/** Live terminal height, for the row budget. */
	viewportRows?: ViewportRowsSource;
	requestRender: () => void;
	/** The Extensions view probes on first show (no session cache, or the command asked to refresh). */
	needsProbe?: boolean;
	/** Force that first probe (`/bytefly … refresh`). */
	initialRefresh?: boolean;
	/** Re-probe; `force` ignores the session cache. Awaited before the busy state clears. */
	refresh: (force?: boolean) => void | Promise<void>;
	onClose: () => void;
	onNotice?: (message: string) => void;
}

/** The docked bytefly panel. */
export class PanelComponent implements Component {
	private readonly cursors: Record<PanelSection, ListCursor>;
	/** Serialises writes so a rapid double press applies twice, not once. */
	private chain: Promise<void> = Promise.resolve();
	/** Focused row key per section, so it survives a rebuild that reorders rows. */
	private readonly focusedKeys: Record<PanelSection, string | undefined> = {
		extensions: undefined,
		settings: undefined,
	};
	/** Row keys whose findings are expanded; Enter toggles only the focused row. */
	private readonly expanded = new Set<string>();
	/** True while a re-probe is in flight, so `r` does not stack probes. */
	private refreshing = false;
	/** True once the Extensions view has asked for its first probe. */
	private probed = false;
	/** The visible section. */
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

	/** The entries of the visible section. */
	private activeEntries(): PanelEntry[] {
		return this.section === "settings"
			? settingEntries(this.options.settings.views(this.options.runtime.scope()))
			: entriesOf(this.model());
	}

	/** Keep the focus on the same row key when the list shape changes. */
	private retainFocus(entries: PanelEntry[]): void {
		const key = entryKey(entries[this.cursor.selected]);
		if (key !== undefined) {
			this.focusedKeys[this.section] = key;
			return;
		}
		const focusedKey = this.focusedKeys[this.section];
		if (focusedKey === undefined) return;
		const index = entries.findIndex((candidate) => entryKey(candidate) === focusedKey);
		if (index >= 0) this.cursor.selected = index;
	}

	/** Move onto the first row when the focus is not already on one. */
	private clampSelection(entries: PanelEntry[]): void {
		if (isSelectable(entries[this.cursor.selected])) return;
		const first = entries.findIndex(isSelectable);
		if (first >= 0) this.cursor.selected = first;
	}

	private firstRow(): number | undefined {
		const index = this.activeEntries().findIndex(isSelectable);
		return index >= 0 ? index : undefined;
	}

	private lastRow(): number | undefined {
		const entries = this.activeEntries();
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			if (isSelectable(entries[index])) return index;
		}
		return undefined;
	}

	private select(index: number | undefined): void {
		if (index === undefined) return;
		this.cursor.set(index, this.activeEntries().length);
	}

	/** Move `delta` rows, skipping group headers. */
	private move(delta: number): void {
		if (delta === 0) return;
		this.clampSelection(this.activeEntries());
		const entries = this.activeEntries();
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
			this.options.onNotice?.(
				this.section === "settings"
					? "Project is not trusted; settings can only be changed in Global scope."
					: "Project is not trusted; manage extensions in Global scope only.",
			);
			return;
		}
		this.options.runtime.setScope(next);
		this.options.requestRender();
	}

	private toggle(): void {
		const entry = this.activeEntries()[this.cursor.selected];
		if (entry?.kind !== "row" || !entry.row.item) return;
		const item = entry.row.item;
		this.chain = this.chain
			.then(() => this.options.runtime.toggle(item))
			.catch(() => undefined)
			.then(() => this.options.requestRender());
	}

	/** Change the focused setting, if the section has one. */
	private changeSetting(): void {
		const entry = this.activeEntries()[this.cursor.selected];
		if (entry?.kind !== "setting") return;
		const scope = this.options.runtime.scope();
		const id = entry.setting.id;
		this.chain = this.chain
			.then(() => this.options.settings.change(scope, id))
			.catch((error: unknown) => this.options.onNotice?.(error instanceof Error ? error.message : String(error)))
			.then(() => this.options.requestRender());
	}

	/**
	 * Ask for the first Extensions probe when the session had no cache. The first
	 * time the section is visible is when the rows need health; doing it at mount
	 * would delay `/bytefly settings`, which never reads the reports.
	 */
	prime(): void {
		if (this.probed || this.options.needsProbe !== true || this.section !== "extensions") return;
		this.probed = true;
		void this.refresh(this.options.initialRefresh === true);
	}

	/** Re-probe once; a second request while one is in flight is ignored. */
	async refresh(force = false): Promise<void> {
		if (this.refreshing) return;
		this.refreshing = true;
		this.options.requestRender();
		try {
			await this.options.refresh(force);
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
		this.prime();
		this.options.requestRender();
	}

	/** Navigation shared by both sections. */
	private navigate(data: string): void {
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

	/** Settings keys: change, scope, navigation. `←`/`→` stay on sections. */
	private handleSettingsInput(data: string): void {
		this.clampSelection(this.activeEntries());
		if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
			this.changeSetting();
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.switchScope();
			return;
		}
		this.navigate(data);
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
		if (this.section === "settings") {
			this.handleSettingsInput(data);
			return;
		}
		// An input can arrive before the first render; put the focus on a row.
		this.clampSelection(this.activeEntries());
		if (matchesKey(data, Key.space)) {
			this.toggle();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.toggleDetail();
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.switchScope();
			return;
		}
		if (matchesKey(data, "r")) {
			void this.refresh(true);
			return;
		}
		this.navigate(data);
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

	/** Key hints for the active section; whole hints drop as the width runs out. */
	private hint(width: number, expanded = false): string {
		const common = ["Esc close", "←/→"];
		const hints =
			this.section === "settings"
				? [...common, "Space change", "Tab scope", "↑/↓ select"]
				: [
						...common,
						"Space toggle",
						expanded ? "Enter collapse" : "Enter detail",
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
		const badge = rowBadge(row);
		return listRow(this.theme, width, {
			selected,
			// A reported-only row has no enable pattern, but still reserves the box
			// column so the list stays aligned.
			leading: row.item ? checkbox(this.theme, row.item.enabled) : " ",
			glyph: badge.glyph ?? " ",
			glyphRole: badge.role,
			label: sanitizeLine(row.label),
			labelRole: selected ? "accent" : row.item && !row.item.enabled ? "faint" : "label",
			trailing: badge.text,
			// The glyph carries the status colour; the word stays quiet unless it is a
			// problem, so a clean row does not shout.
			trailingRole: badge.role === "bad" || badge.role === "warn" ? badge.role : "faint",
		});
	}

	/** One setting row: a checkbox for booleans, the value right-aligned. */
	private settingLine(view: SettingView, selected: boolean, width: number): string {
		return listRow(this.theme, width, {
			selected,
			leading: view.kind === "boolean" ? checkbox(this.theme, view.value === "true") : " ",
			label: sanitizeLine(view.label),
			labelRole: selected ? "accent" : "label",
			trailing: sanitizeLine(view.valueLabel),
			trailingRole: "meta",
		});
	}

	/** The project note: app rows are absent because Pi has no project setter. */
	private noteLine(width: number): string {
		return clip(`${INDENT}${paint(this.theme, "faint", "App settings are Global only.")}`, width);
	}

	/** The saved-then-reload marker, shared by both sections. */
	private dirtyLine(width: number): string[] {
		if (!this.options.runtime.isDirty() && !this.options.settings.isDirty()) return [];
		return [clip(`${INDENT}${paint(this.theme, "warn", "Saved · reload to apply")}`, width)];
	}

	/** The origin and target file for a setting, shown in its detail pane. */
	private originLine(view: SettingView): string {
		const scope = this.options.runtime.scope();
		const path =
			view.source === "app"
				? join(this.options.agentDir, PI_SETTINGS_FILE)
				: configPath(scope, this.options.cwd, this.options.agentDir);
		const file = sanitizeLine(path);
		switch (view.origin) {
			case "inherited":
				return `Inherited from Global · ${file}`;
			case "project":
				return `Project · ${file}`;
			case "global":
				return `Global · ${file}`;
			default:
				return `Default · ${file}`;
		}
	}

	/** The focused setting's source, description, origin, and pending changes. */
	private settingDetail(view: SettingView | undefined, width: number, budget: number): string[] {
		if (!view) return this.dirtyLine(width);
		const source = view.source === "app" ? "Pi setting" : "bytefly.json";
		const head = `${paint(this.theme, "meta", sanitizeLine(view.label))} ${paint(this.theme, "faint", "—")} ${paint(this.theme, "faint", source)}`;
		const headLine = clip(`${INDENT}${head}`, width);
		if (budget === 0) return [headLine];

		const lines = [headLine];
		const dirty = this.dirtyLine(width);
		const descriptionWidth = Math.max(1, width - BODY_INDENT * 2);
		const description = wrapTextWithAnsi(sanitizeLine(view.description), descriptionWidth).slice(
			0,
			Math.max(0, Math.min(2, budget - 2 - dirty.length)),
		);
		for (const line of description) {
			lines.push(clip(`${INDENT}${paint(this.theme, "meta", line)}`, width));
		}
		lines.push(clip(`${INDENT}${paint(this.theme, "faint", this.originLine(view))}`, width));
		lines.push(...dirty);
		return lines;
	}

	/** The focused extension's label, findings, and the pending-changes note. */
	private detail(row: PanelRow | undefined, width: number, budget: number, expanded: boolean): string[] {
		const lines: string[] = [];
		const badge = row ? rowBadge(row) : undefined;
		if (row && badge?.text !== undefined) {
			const head = `${paint(this.theme, "meta", sanitizeLine(row.label))} ${paint(this.theme, "faint", "—")} ${paint(this.theme, badge.role, badge.text)}`;
			lines.push(clip(`  ${head}`, width));
		} else if (row?.item) {
			lines.push(clip(`  ${paint(this.theme, "meta", sanitizeLine(row.item.path))}`, width));
		}
		if (row?.report && budget > 0) {
			lines.push(...reportDetailLines(row.report, this.theme, width, budget, expanded));
		}
		lines.push(...this.dirtyLine(width));
		return lines;
	}

	/**
	 * Detail rows the focused row gets: the fixed pane when collapsed, the free
	 * height when expanded. Zero when the terminal cannot hold one body row next to
	 * the pane, so the hint row is never pushed off the screen.
	 */
	private detailRows(expanded: boolean): number {
		const total = totalRows(this.options.viewportRows);
		if (total === undefined) return expanded ? EXPANDED_DETAIL_FALLBACK : DETAIL_ROWS;
		const available = total - FRAME_ROWS - MIN_BODY_ROWS;
		if (available < DETAIL_ROWS + 1) return 0;
		return expanded ? Math.max(DETAIL_ROWS, available) : DETAIL_ROWS;
	}

	/** Expand or collapse the focused row's findings. */
	private toggleDetail(): void {
		const key = entryKey(this.activeEntries()[this.cursor.selected]);
		if (key === undefined) return;
		if (this.expanded.has(key)) this.expanded.delete(key);
		else this.expanded.add(key);
		this.options.requestRender();
	}

	/** The Settings body: scope counts, the project note, rows, and detail. */
	private renderSettings(width: number, header: string): string[] {
		const scope = this.options.runtime.scope();
		const views = this.options.settings.views(scope);
		const summary = this.sectionBar(
			width,
			this.counts(settingsSummarySegments(scope, this.options.settings.count(scope)), width),
		);
		const entries = settingEntries(views);
		const note = scope === "project" ? this.noteLine(width) : undefined;

		if (entries.length === 0) {
			return dockListFrame({
				header,
				summary,
				body: emptyState(this.theme, width, { label: "No settings found." }),
				hint: this.hint(width),
			});
		}

		this.retainFocus(entries);
		this.clampSelection(entries);

		const focusedEntry = entries[this.cursor.selected];
		const focused = focusedEntry?.kind === "setting" ? focusedEntry.setting : undefined;
		const detail = this.settingDetail(focused, width, this.detailRows(false));

		this.cursor.visible = fitRows(
			this.options.viewportRows,
			entries.length,
			FRAME_ROWS + detail.length + (note ? 1 : 0),
			SCREEN_DEFAULT_ROWS,
		);
		this.cursor.sync(entries.length);
		const { start, end } = this.cursor.window(entries.length);

		const body: string[] = [];
		if (note) body.push(note);
		for (let index = start; index < end; index += 1) {
			const entry = entries[index];
			if (entry.kind === "group") body.push(this.groupLine(entry, width));
			else if (entry.kind === "setting")
				body.push(this.settingLine(entry.setting, index === this.cursor.selected, width));
		}

		return dockListFrame({
			header,
			summary,
			body,
			range: this.cursor.clipped(entries.length)
				? formatRange(this.theme, width, { start, end, total: entries.length })
				: undefined,
			detail: detail.length > 0 ? detail : undefined,
			hint: this.hint(width),
		});
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
		const expanded = focused !== undefined && this.expanded.has(focused.key);
		const detail = this.detail(focused, w, this.detailRows(expanded), expanded);

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
			else if (entry.kind === "row") body.push(this.rowLine(entry.row, index === this.cursor.selected, w));
		}

		return dockListFrame({
			header,
			summary,
			body,
			range: this.cursor.clipped(entries.length)
				? formatRange(this.theme, w, { start, end, total: entries.length })
				: undefined,
			detail: detail.length > 0 ? detail : undefined,
			hint: this.hint(w, expanded),
		});
	}
}
