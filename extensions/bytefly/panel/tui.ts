/**
 * The unified bytefly panel: two sections around one docked list.
 *
 * Extensions lists every resolved extension with its enable checkbox and its
 * health; Settings lists the curated preferences with their values. The
 * component owns the state — the cursors, the focused row key per section, the
 * expanded set, the pending write chain, and the active section — and the two
 * section modules own how their rows and detail panes are drawn. It is derived:
 * it rebuilds the model from the picker runtime, the reports, or the settings
 * surface on every render, keeps the focused row's key across rebuilds, and
 * requests a repaint only after an input changes state. The screen is drawn from
 * the design system — a label-first `titleRule`, one `listRow` grammar, one
 * `checkbox` — and its scroll math from `lib/tui/cursor.ts`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ViewportRowsSource } from "../../../lib/tui/chrome.ts";
import { dockListFrame } from "../../../lib/tui/chrome.ts";
import { fitRows, formatRange, isCloseKey, ListCursor, navIntent, wheelDelta } from "../../../lib/tui/cursor.ts";
import { emptyState } from "../../../lib/tui/rows.ts";
import { titleRule } from "../../../lib/tui/rules.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import type { ExtensionsPickerRuntime } from "../picker/runtime.ts";
import { buildPanelModel } from "./join.ts";
import type { SettingsSurface } from "./settings-runtime.ts";
import type { PanelModel, PanelSection } from "./types.ts";
import { entriesOf, entryKey, isSelectable, settingEntries, type PanelEntry } from "./tui/entries.ts";
import { clampSelection, firstRow, lastRow, moveRows, retainFocus } from "./tui/nav.ts";
import { extensionDetail, extensionHints, extensionRow, extensionSummary } from "./tui/extensions-view.ts";
import {
	BODY_START,
	DETAIL_ROWS,
	EXPANDED_DETAIL_FALLBACK,
	FRAME_ROWS,
	groupLine,
	hintLine,
	MIN_BODY_ROWS,
	noticeLine,
	SCREEN_DEFAULT_ROWS,
	sectionBar,
} from "./tui/frame.ts";
import { projectNote, settingDetail, settingRow, settingsHints, settingsSummary } from "./tui/settings-view.ts";

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
	/** Transient feedback (a refusal or a failed write), shown in the hint row. */
	private notice: string | undefined;
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

	/** Whether anything has been written this session, either section. */
	private get dirty(): boolean {
		return this.options.runtime.isDirty() || this.options.settings.isDirty();
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
		const before = entryKey(entries[this.cursor.selected]);
		retainFocus(entries, this.cursor, this.focusedKeys[this.section]);
		const after = entryKey(entries[this.cursor.selected]);
		if (after !== undefined) this.focusedKeys[this.section] = after;
		else if (before !== undefined) this.focusedKeys[this.section] = before;
	}

	/** Move onto the nearest selectable row when the focus is not already on one. */
	private clampSelection(entries: PanelEntry[]): void {
		clampSelection(entries, this.cursor);
	}

	private select(index: number | undefined): void {
		if (index === undefined) return;
		this.cursor.set(index, this.activeEntries().length);
	}

	/** Move `delta` rows, skipping group headers. */
	private move(delta: number): void {
		moveRows(this.activeEntries(), this.cursor, delta);
	}

	private switchScope(): void {
		const next = this.options.runtime.scope() === "global" ? "project" : "global";
		if (next === "project" && !this.options.runtime.projectAvailable()) {
			this.notify(
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
		if (entry?.kind !== "row") return;
		const item = entry.row.item;
		if (!item) {
			// A `Not resolved` row has no settings pattern to write, so say why the
			// key did nothing instead of swallowing it.
			this.notify(`${entry.row.label} is not resolved; manage it with pi config.`);
			return;
		}
		this.chain = this.chain
			.then(() => this.options.runtime.toggle(item))
			.catch(() => undefined)
			.then(() => this.options.requestRender());
	}

	/** Drop the focused extension's project override, restoring the inherited row. */
	private clearOverride(): void {
		const entry = this.activeEntries()[this.cursor.selected];
		if (entry?.kind !== "row") return;
		const item = entry.row.item;
		if (!item) {
			this.notify(`${entry.row.label} is not resolved; there is no override to clear.`);
			return;
		}
		this.chain = this.chain
			.then(() => this.options.runtime.clearOverride(item))
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
			.catch((error: unknown) => this.notify(error instanceof Error ? error.message : String(error)))
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

	/**
	 * Show a message in the screen's hint row until the next key. The panel is the
	 * only place a refusal or a failed write can be seen, so these messages stay
	 * in the frame instead of landing behind it in the transcript.
	 */
	notify(message: string): void {
		this.notice = message;
		this.options.requestRender();
	}

	/** Re-probe once; a second request while one is in flight is ignored. */
	async refresh(force = false): Promise<void> {
		if (this.refreshing) return;
		this.refreshing = true;
		this.options.requestRender();
		try {
			await this.options.refresh(force);
		} catch (error) {
			this.notify(`Could not refresh: ${error instanceof Error ? error.message : String(error)}`);
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
			this.select(firstRow(this.activeEntries()));
			return;
		}
		if (data === "G") {
			this.select(lastRow(this.activeEntries()));
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
				this.select(firstRow(this.activeEntries()));
				return;
			case "end":
				this.select(lastRow(this.activeEntries()));
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
		// A notice replaces the hint row; any key dismisses it and still acts.
		if (this.notice !== undefined) {
			this.notice = undefined;
			this.options.requestRender();
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
		// Only Project scope can hold an override, so the key does not exist in
		// Global scope and the hint row does not offer it there.
		if (matchesKey(data, "x") && this.options.runtime.scope() === "project") {
			this.clearOverride();
			return;
		}
		this.navigate(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta !== undefined) {
			this.move(delta);
			return { handled: true };
		}
		if ((event.type !== "click" && event.type !== "press") || event.button !== "left") return undefined;
		const entries = this.activeEntries();
		if (entries.length === 0) return undefined;
		// The Settings section prints the "Global only" note first in Project scope,
		// so the rows start one line lower there.
		const note = this.section === "settings" && this.options.runtime.scope() === "project" ? 1 : 0;
		const line = event.y - (BODY_START + note);
		if (line < 0) return undefined;
		const index = this.cursor.window(entries.length).start + line;
		if (!isSelectable(entries[index])) return undefined;
		this.select(index);
		return { handled: true };
	}

	/** Key hints for the active section; whole hints drop as the width runs out. */
	private hint(width: number, expanded = false): string {
		const hints =
			this.section === "settings"
				? settingsHints()
				: extensionHints({
						expanded,
						refreshing: this.refreshing,
						projectScope: this.options.runtime.scope() === "project",
					});
		return hintLine(this.theme, width, hints);
	}

	/** The key-hint row, or the notice that temporarily replaces it. */
	private hintRow(width: number, expanded = false): string {
		return this.notice !== undefined ? noticeLine(this.theme, width, this.notice) : this.hint(width, expanded);
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
		const summary = sectionBar(
			this.theme,
			width,
			this.section,
			settingsSummary(this.theme, width, scope, this.options.settings.count(scope)),
		);
		const entries = settingEntries(views);
		const note = scope === "project" ? projectNote(this.theme, width) : undefined;

		if (entries.length === 0) {
			return dockListFrame({
				header,
				summary,
				body: emptyState(this.theme, width, { label: "No settings found." }),
				hint: this.hintRow(width),
			});
		}

		this.retainFocus(entries);
		this.clampSelection(entries);

		const focusedEntry = entries[this.cursor.selected];
		const focused = focusedEntry?.kind === "setting" ? focusedEntry.setting : undefined;
		const detail = settingDetail({
			theme: this.theme,
			width,
			view: focused,
			budget: this.detailRows(false),
			dirty: this.dirty,
			paths: { scope, cwd: this.options.cwd, agentDir: this.options.agentDir },
		});

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
			if (entry.kind === "group") body.push(groupLine(this.theme, width, entry));
			else if (entry.kind === "setting") {
				body.push(settingRow(this.theme, width, entry.setting, index === this.cursor.selected));
			}
		}

		return dockListFrame({
			header,
			summary,
			body,
			range: this.cursor.clipped(entries.length)
				? formatRange(this.theme, width, { start, end, total: entries.length })
				: undefined,
			detail: detail.length > 0 ? detail : undefined,
			hint: this.hintRow(width),
		});
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "bytefly");
		if (this.section === "settings") return this.renderSettings(w, header);

		const model = this.model();
		const entries = entriesOf(model);
		const summary = sectionBar(
			this.theme,
			w,
			this.section,
			extensionSummary(this.theme, w, model, this.options.runtime.scope(), this.options.filter),
		);

		if (entries.length === 0) {
			return dockListFrame({
				header,
				summary,
				body: emptyState(this.theme, w, { label: "No extensions found." }),
				hint: this.hintRow(w),
			});
		}

		this.retainFocus(entries);
		this.clampSelection(entries);

		const focusedEntry = entries[this.cursor.selected];
		const focused = focusedEntry?.kind === "row" ? focusedEntry.row : undefined;
		const expanded = focused !== undefined && this.expanded.has(focused.key);
		const detail = extensionDetail(this.theme, w, focused, this.detailRows(expanded), expanded, this.dirty);

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
			if (entry.kind === "group") body.push(groupLine(this.theme, w, entry));
			else if (entry.kind === "row") body.push(extensionRow(this.theme, w, entry.row, index === this.cursor.selected));
		}

		return dockListFrame({
			header,
			summary,
			body,
			range: this.cursor.clipped(entries.length)
				? formatRange(this.theme, w, { start, end, total: entries.length })
				: undefined,
			detail: detail.length > 0 ? detail : undefined,
			hint: this.hintRow(w, expanded),
		});
	}
}
