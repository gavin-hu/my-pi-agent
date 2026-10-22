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
import { isCloseKey, ListCursor, navIntent, wheelDelta } from "../../../lib/tui/cursor.ts";
import { titleRule } from "../../../lib/tui/rules.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import type { ExtensionsPickerRuntime } from "../picker/runtime.ts";
import { buildPanelModel } from "./join.ts";
import { SETTING_ROWS, UNTRUSTED_SETTINGS_NOTE } from "./settings.ts";
import type { SettingsSurface } from "./settings-runtime.ts";
import type { PanelModel, PanelSection } from "./types.ts";
import { entriesOf, entryKey, isSelectable, settingEntries, type PanelEntry } from "./tui/entries.ts";
import { applyEditKey, type EditingState } from "./tui/editing.ts";
import { clampSelection, firstRow, lastRow, moveRows, retainFocus } from "./tui/nav.ts";
import { extensionDetail, extensionHints, extensionRow, extensionSummary } from "./tui/extensions-view.ts";
import { BODY_START, detailRows, groupLine, hintLine, noticeLine, panelFrame, sectionBar } from "./tui/frame.ts";
import {
	editHints,
	projectNote,
	sectionJsonPane,
	settingDetail,
	settingRow,
	settingsHints,
	settingsSummary,
} from "./tui/settings-view.ts";

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
	/** The text row being edited, if any. */
	private editing: EditingState | undefined;
	/** True while the Settings detail pane shows the focused row's section as JSON. */
	private json = false;
	/** Whether the last Settings render kept the project note; the click mapping needs it. */
	private noteShown = false;
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
					? UNTRUSTED_SETTINGS_NOTE
					: "Project is not trusted; manage extensions in Global scope only.",
			);
			return;
		}
		// The JSON pane names a file, so a scope switch has to close it.
		this.json = false;
		const focused = entryKey(this.activeEntries()[this.cursor.selected]);
		this.options.runtime.setScope(next);
		// Keep the setting under the cursor across the layer switch; the two scopes
		// do not share entry indices because Project drops the app rows, so the
		// render's focus retention and clamp land on the nearest row when it cannot.
		if (focused !== undefined) {
			const index = this.activeEntries().findIndex((entry) => entryKey(entry) === focused);
			if (index >= 0) this.cursor.selected = index;
		}
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

	/** Change the focused setting: cycle it, or open the editor for a text row. */
	private changeSetting(): void {
		const entry = this.activeEntries()[this.cursor.selected];
		if (entry?.kind !== "setting") return;
		const view = entry.setting;
		if (view.kind === "text") {
			this.editing = { id: view.id, buffer: view.value, caret: view.value.length };
			this.options.requestRender();
			return;
		}
		const scope = this.options.runtime.scope();
		this.chain = this.chain
			.then(() => this.options.settings.change(scope, view.id))
			.catch((error: unknown) => this.notify(error instanceof Error ? error.message : String(error)))
			.then(() => this.options.requestRender());
	}

	/** Delete the focused setting's leaf, so its default applies again. */
	private resetSetting(): void {
		const entry = this.activeEntries()[this.cursor.selected];
		if (entry?.kind !== "setting") return;
		const scope = this.options.runtime.scope();
		this.chain = this.chain
			.then(() => this.options.settings.reset(scope, entry.setting.id))
			.catch((error: unknown) => this.notify(error instanceof Error ? error.message : String(error)))
			.then(() => this.options.requestRender());
	}

	/** Toggle the detail pane between the row and its whole section as stored. */
	private toggleJson(): void {
		const entry = this.activeEntries()[this.cursor.selected];
		if (entry?.kind !== "setting") return;
		if (!entry.setting.config) {
			// There is no section to show, so leave the mode off rather than keeping a
			// hidden toggle that would reopen the pane on another row.
			this.json = false;
			this.notify(`${entry.setting.label} is a Pi setting; bytefly.json has no section for it.`);
			return;
		}
		this.json = !this.json;
		this.options.requestRender();
	}

	/** Store the editor's buffer; a refusal keeps it open with the reason shown. */
	private commitEdit(): void {
		const editing = this.editing;
		if (!editing) return;
		const scope = this.options.runtime.scope();
		this.chain = this.chain
			.then(() => this.options.settings.setValue(scope, editing.id, editing.buffer))
			.then((saved) => {
				if (saved) this.editing = undefined;
			})
			.catch((error: unknown) => this.notify(error instanceof Error ? error.message : String(error)))
			.then(() => this.options.requestRender());
	}

	/**
	 * Editor keys. `Esc`/`Ctrl+C` cancel the edit rather than closing the screen,
	 * and everything else the screen binds is inert until the editor closes.
	 */
	private handleEditingInput(data: string): void {
		const editing = this.editing;
		if (!editing) return;
		const max = SETTING_ROWS.find((row) => row.id === editing.id)?.text?.maxLength;
		const action = applyEditKey(data, editing, max);
		if (action.kind === "commit") {
			void this.commitEdit();
			return;
		}
		if (action.kind === "cancel") {
			this.editing = undefined;
			this.options.requestRender();
			return;
		}
		if (!action.changed) return;
		this.editing = action.state;
		this.options.requestRender();
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
		this.json = false;
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
		// Only Extensions carries group headings; the Settings list is flat, so the
		// keys would move the cursor nowhere there.
		if (this.section === "extensions" && (data === "[" || data === "]")) {
			this.jumpGroup(data === "[" ? -1 : 1);
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

	/** Move to the first row of the next (or previous) group. */
	private jumpGroup(direction: -1 | 1): void {
		const entries = this.activeEntries();
		const headers = entries.flatMap((entry, index) => (entry.kind === "group" ? [index] : []));
		const selected = this.cursor.selected;
		// Step past the focused row's own header: landing on it would not move.
		const own = headers.filter((index) => index < selected).at(-1);
		const target =
			direction === 1
				? headers.find((index) => index > selected)
				: headers.filter((index) => index < (own ?? 0)).at(-1);
		if (target === undefined) return;
		for (let index = target + 1; index < entries.length; index += 1) {
			if (isSelectable(entries[index])) {
				this.select(index);
				return;
			}
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
		if (data === "u") {
			this.resetSetting();
			return;
		}
		if (data === "J") {
			this.toggleJson();
			return;
		}
		this.navigate(data);
	}

	handleInput(data: string): void {
		if (this.editing) {
			this.handleEditingInput(data);
			return;
		}
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
		// A click while editing leaves the editor the way `Esc` does: nothing is
		// written behind the screen.
		if (this.editing) {
			this.editing = undefined;
			this.options.requestRender();
			return { handled: true };
		}
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
		const note = this.section === "settings" && this.noteShown ? 1 : 0;
		const line = event.y - (BODY_START + note);
		const window = this.cursor.window(entries.length);
		if (line < 0 || line >= window.end - window.start) return undefined;
		const index = window.start + line;
		if (!isSelectable(entries[index])) return undefined;
		this.select(index);
		return { handled: true };
	}

	/** Key hints for the active section; whole hints drop as the width runs out. */
	private hint(width: number, options: { expanded?: boolean; jsonOpen?: boolean } = {}): string {
		if (this.editing) return hintLine(this.theme, width, editHints());
		const hints =
			this.section === "settings"
				? settingsHints(options.jsonOpen === true)
				: extensionHints({
						expanded: options.expanded === true,
						refreshing: this.refreshing,
						projectScope: this.options.runtime.scope() === "project",
					});
		return hintLine(this.theme, width, hints);
	}

	/** The key-hint row, or the notice that temporarily replaces it. */
	private hintRow(width: number, options: { expanded?: boolean; jsonOpen?: boolean } = {}): string {
		return this.notice !== undefined ? noticeLine(this.theme, width, this.notice) : this.hint(width, options);
	}

	/** Expand or collapse the focused row's findings. */
	private toggleDetail(): void {
		const key = entryKey(this.activeEntries()[this.cursor.selected]);
		if (key === undefined) return;
		if (this.expanded.has(key)) this.expanded.delete(key);
		else this.expanded.add(key);
		this.options.requestRender();
	}

	/** Retain the focus across a rebuild and return the entry it landed on. */
	private retain(entries: PanelEntry[]): PanelEntry | undefined {
		this.retainFocus(entries);
		this.clampSelection(entries);
		return entries[this.cursor.selected];
	}

	/** The Settings body: scope counts, the project note, rows, and detail. */
	private renderSettings(width: number, header: string): string[] {
		const scope = this.options.runtime.scope();
		const views = this.options.settings.views(scope);
		const summary = sectionBar(
			this.theme,
			width,
			this.section,
			settingsSummary(this.theme, width, scope, views.length),
		);
		const entries = settingEntries(views);
		const note = scope === "project" ? projectNote(this.theme, width) : undefined;

		const focusedEntry = this.retain(entries);
		const focused = focusedEntry?.kind === "setting" ? focusedEntry.setting : undefined;
		// A row with no section leaves the mode off, so moving away and back cannot
		// reopen a pane the user closed.
		if (focused && !focused.config) this.json = false;
		const jsonConfig = this.json ? focused?.config : undefined;
		const detail =
			jsonConfig && focused
				? sectionJsonPane({
						theme: this.theme,
						width,
						section: jsonConfig.section,
						document: this.options.settings.sectionDocument(scope, jsonConfig.section),
						budget: detailRows(true, this.options.viewportRows),
						dirty: this.dirty,
						paths: { scope, cwd: this.options.cwd, agentDir: this.options.agentDir },
					})
				: settingDetail({
						theme: this.theme,
						width,
						view: focused,
						budget: detailRows(false, this.options.viewportRows),
						dirty: this.dirty,
						paths: { scope, cwd: this.options.cwd, agentDir: this.options.agentDir },
					});

		const { lines, noteShown } = panelFrame({
			theme: this.theme,
			viewportRows: this.options.viewportRows,
			cursor: this.cursor,
			width,
			header,
			summary,
			entries,
			note,
			detail,
			hint: this.hintRow(width, { jsonOpen: jsonConfig !== undefined }),
			draw: (entry, index) => {
				if (entry.kind === "group") return groupLine(this.theme, width, entry);
				if (entry.kind !== "setting") return undefined;
				const editing = this.editing?.id === entry.setting.id ? this.editing : undefined;
				return settingRow(this.theme, width, entry.setting, index === this.cursor.selected, editing);
			},
		});
		this.noteShown = noteShown;
		return lines;
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "Bytefly");
		if (this.section === "settings") return this.renderSettings(w, header);

		const model = this.model();
		const entries = entriesOf(model);
		const summary = sectionBar(
			this.theme,
			w,
			this.section,
			extensionSummary(this.theme, w, model, this.options.runtime.scope(), this.options.filter),
		);

		const focusedEntry = this.retain(entries);
		const focused = focusedEntry?.kind === "row" ? focusedEntry.row : undefined;
		const expanded = focused !== undefined && this.expanded.has(focused.key);
		const detail = extensionDetail(
			this.theme,
			w,
			focused,
			detailRows(expanded, this.options.viewportRows),
			expanded,
			this.dirty,
		);

		const { lines, noteShown } = panelFrame({
			theme: this.theme,
			viewportRows: this.options.viewportRows,
			cursor: this.cursor,
			width: w,
			header,
			summary,
			entries,
			emptyLabel: "No extensions found.",
			detail,
			hint: this.hintRow(w, { expanded }),
			draw: (entry, index) => {
				if (entry.kind === "group") return groupLine(this.theme, w, entry);
				if (entry.kind !== "row") return undefined;
				return extensionRow(this.theme, w, entry.row, index === this.cursor.selected);
			},
		});
		this.noteShown = noteShown;
		return lines;
	}
}
