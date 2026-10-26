/**
 * The control center: three sections around one frame.
 *
 * Extensions lists every resolved extension with its enable checkbox and its
 * health, Skills the same with what its `SKILL.md` declares, and Settings the
 * curated preferences with their values. All three are drawn by one frame —
 * header, tabs, a shared body height, one focused-row block — so the screen does
 * not change shape when the section does.
 *
 * The component owns the section switch, the cursors, the focused row key per
 * section, the filter, the help block, the pending toggle chain and the notice.
 * It is derived: every render rebuilds from the picker runtime, the reports, the
 * skill index, or the settings surface, and keeps the focused row's key across
 * rebuilds.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ViewportRowsSource } from "../../../lib/tui/chrome.ts";
import { ListCursor, wheelDelta } from "../../../lib/tui/cursor.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import type { PickerRuntime } from "../picker/runtime.ts";
import type { ResourceKind } from "../picker/types.ts";
import { NO_FILTER, type PanelFilter } from "./filter.ts";
import { SECTION_ORDER } from "./format.ts";
import { UNTRUSTED_SETTINGS_NOTE } from "./settings.ts";
import type { SettingsSurface } from "./settings-runtime.ts";
import type { PanelModel, PanelSection, SkillInfo } from "./types.ts";
import { applyEditKey, type EditingState } from "./tui/editing.ts";
import { entriesOf, entryKey, isSelectable, type PanelEntry } from "./tui/entries.ts";
import { BODY_START, detailRows, groupLine, headerLine, panelFrame, tabsLine } from "./tui/frame.ts";
import { hintRow, keyFor } from "./tui/keys.ts";
import { resourceRow, verdictColumn } from "./tui/list-view.ts";
import { clampSelection, moveRows, navigateEntries, retainFocus } from "./tui/nav.ts";
import { clipRows, isWide, sideWidth } from "./tui/panes.ts";
import {
	attentionFor,
	chipsFor,
	emptyLabelFor,
	groupLabelFor,
	modelFor,
	sectionCounts,
	tallestBody,
	type ViewSource,
} from "./tui/section-view.ts";
import { sideRows } from "./tui/side-pane.ts";
import { SettingsSection } from "./tui/settings-section.ts";
import { projectNote, settingLabelColumn, settingRow } from "./tui/settings-view.ts";

/** A section that draws a resource list rather than the settings table. */
type ListSection = ResourceKind;

/** The filter editor's identity, so it can share the settings editor's key map. */
const FILTER_EDIT_ID = "filter";

/** The longest filter query the editor accepts. */
const FILTER_MAX = 60;

/** Host seams for the control center, injected by the command runner. */
export interface PanelComponentOptions {
	/** The session's picker runtime: items, scope, toggles, dirty flag. */
	runtime: PickerRuntime;
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
	/** The session working directory, for the config-file path in the block. */
	cwd: string;
	/** Live terminal height, for the row budget. */
	viewportRows?: ViewportRowsSource;
	requestRender: () => void;
	/** Read every resolved skill's metadata; called once, when Skills first needs it. */
	skills: () => ReadonlyMap<string, SkillInfo>;
	/** The Extensions view probes on first show (no session cache, or the command asked to refresh). */
	needsProbe?: boolean;
	/** Force that first probe (`/bytefly … refresh`). */
	initialRefresh?: boolean;
	/** Re-probe; `force` ignores the session cache. Awaited before the busy state clears. */
	refresh: (force?: boolean) => void | Promise<void>;
	/** Confirm and reload, so the changes on screen take effect. */
	reload: () => void | Promise<void>;
	onClose: () => void;
}

/** The control center's screen. */
export class PanelComponent implements Component {
	private readonly cursors: Record<PanelSection, ListCursor>;
	/** Serialises toggles so a rapid double press applies twice, not once. */
	private chain: Promise<void> = Promise.resolve();
	/** Focused row key per section, so it survives a rebuild that reorders rows. */
	private readonly focusedKeys: Record<PanelSection, string | undefined> = {
		extensions: undefined,
		skills: undefined,
		settings: undefined,
	};
	/** Row keys whose findings are expanded; Enter toggles only the focused row. */
	private readonly expanded = new Set<string>();
	/** True while a re-probe is in flight, so `r` does not stack probes. */
	private refreshing = false;
	/** True once the Extensions view has asked for its first probe. */
	private probed = false;
	/** Skill metadata, read once when the Skills section first needs it. */
	private skillIndex: ReadonlyMap<string, SkillInfo> | undefined;
	/** Transient feedback (a refusal or a failed write), shown in the hint row. */
	private notice: string | undefined;
	/** What the reader narrowed the rows to. */
	private filter: PanelFilter = NO_FILTER;
	/** The filter editor, while `/` is open. */
	private filterEditing: EditingState | undefined;
	/** Whether the key table has taken the focused-row block. */
	private helpOpen = false;
	/** Whether the last render kept the project note; the click mapping needs it. */
	private noteShown = false;
	/** The label column the last Settings render used, in columns. */
	private labelColumn = 0;
	/** The Settings section's editor and JSON-pane state. */
	private readonly settingsSection: SettingsSection;
	/** The visible section. */
	private section: PanelSection;

	constructor(private readonly options: PanelComponentOptions) {
		const requestRender = (): void => this.options.requestRender();
		this.cursors = {
			extensions: new ListCursor(requestRender),
			skills: new ListCursor(requestRender),
			settings: new ListCursor(requestRender),
		};
		this.section = options.section ?? "extensions";
		this.settingsSection = new SettingsSection({
			surface: options.settings,
			scope: () => this.options.runtime.scope(),
			filter: () => this.filter,
			cursor: this.cursors.settings,
			retain: (entries) => this.retain(entries),
			navigate: (data) => this.navigate(data),
			switchScope: () => this.switchScope(),
			notify: (message) => this.notify(message),
			requestRender,
		});
	}

	/** The active section's cursor. */
	private get cursor(): ListCursor {
		return this.cursors[this.section];
	}

	/** The active theme, read live on every render. */
	private get theme(): Theme {
		return this.options.theme;
	}

	/** Whether anything has been written this session, in any section. */
	private get dirty(): boolean {
		return this.options.runtime.isDirty() || this.options.settings.isDirty();
	}

	invalidate(): void {
		// Everything is rebuilt from live state on each render.
	}

	/** The sources the screen's content is derived from. */
	private source(): ViewSource {
		return {
			scope: this.options.runtime.scope(),
			items: (kind) => this.options.runtime.items(kind),
			reports: () => this.options.reports(),
			settings: this.options.settings,
			agentDir: this.options.agentDir,
			filter: this.filter,
			commandFilter: this.options.filter,
			dirty: this.dirty,
		};
	}

	/** The merged model for a list section, filtered unless `filtered` is off. */
	private model(kind: ListSection, filtered = true): PanelModel {
		return modelFor(this.source(), kind, () => this.skills(), filtered);
	}

	/** Skill metadata, loaded on first use and kept for the screen's lifetime. */
	private skills(): ReadonlyMap<string, SkillInfo> {
		this.skillIndex ??= this.options.skills();
		return this.skillIndex;
	}

	/** The entries of the visible section. */
	private activeEntries(): PanelEntry[] {
		if (this.section === "settings") return this.settingsSection.entries();
		return entriesOf(this.model(this.section));
	}

	private switchScope(): void {
		const next = this.options.runtime.scope() === "global" ? "project" : "global";
		if (next === "project" && !this.options.runtime.projectAvailable()) {
			this.notify(
				this.section === "settings"
					? UNTRUSTED_SETTINGS_NOTE
					: `Project is not trusted; manage ${this.section} in Global scope only.`,
			);
			return;
		}
		// The JSON pane names a file, so a scope switch has to close it.
		this.settingsSection.reset();
		const focused = entryKey(this.activeEntries()[this.cursor.selected]);
		this.options.runtime.setScope(next);
		// Keep the row under the cursor across the layer switch; the two scopes do
		// not share entry indices because Project drops the app rows, so the render's
		// focus retention and clamp land on the nearest row when it cannot.
		if (focused !== undefined) {
			const index = this.activeEntries().findIndex((entry) => entryKey(entry) === focused);
			if (index >= 0) this.cursor.selected = index;
		}
		this.options.requestRender();
	}

	private toggle(): void {
		const entry = this.focusedEntry();
		if (entry?.kind !== "row") return;
		const item = entry.row.item;
		if (!item) {
			// A `Not resolved` row has no settings pattern to write, so say why the
			// key did nothing instead of swallowing it.
			this.notify(`${entry.row.label} is not resolved; manage it with pi config.`);
			return;
		}
		const kind = this.section === "skills" ? "skills" : "extensions";
		this.chain = this.chain
			.then(() => this.options.runtime.toggle(kind, item))
			.catch(() => undefined)
			.then(() => this.options.requestRender());
	}

	/** Drop the focused resource's project override, restoring the inherited row. */
	private clearOverride(): void {
		const entry = this.focusedEntry();
		if (entry?.kind !== "row") return;
		const item = entry.row.item;
		if (!item) {
			this.notify(`${entry.row.label} is not resolved; there is no override to clear.`);
			return;
		}
		const kind = this.section === "skills" ? "skills" : "extensions";
		this.chain = this.chain
			.then(() => this.options.runtime.clearOverride(kind, item))
			.catch(() => undefined)
			.then(() => this.options.requestRender());
	}

	/**
	 * Ask for the work the newly visible section needs. The Extensions view probes
	 * when the session had no cache — doing it at mount would delay `/bytefly
	 * settings`, which never reads the reports — and the Skills view reads its
	 * metadata in the same one-shot way.
	 */
	prime(): void {
		const section = this.section;
		if (section === "skills") {
			this.skills();
			return;
		}
		if (this.probed || this.options.needsProbe !== true || section !== "extensions") return;
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

	/** Hand the reload to the command, which confirms before it takes the session. */
	private async reload(): Promise<void> {
		if (!this.dirty) {
			this.notify("Nothing to apply; change something first.");
			return;
		}
		await this.options.reload();
	}

	/**
	 * Step one section left or right, wrapping. The tabs read as a ring, so the last
	 * one continues to the first instead of stopping with no explanation.
	 */
	private stepSection(direction: -1 | 1): void {
		const index = SECTION_ORDER.indexOf(this.section);
		const next = SECTION_ORDER[(index + direction + SECTION_ORDER.length) % SECTION_ORDER.length];
		if (next === undefined || next === this.section) return;
		this.section = next;
		this.helpOpen = false;
		this.settingsSection.reset();
		this.prime();
		this.options.requestRender();
	}

	/** Read one navigation key against the visible section. */
	private navigate(data: string): void {
		navigateEntries(this.activeEntries(), this.cursor, data, { grouped: true });
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

	/**
	 * The focused entry, with the cursor clamped onto a row first: a key can arrive
	 * before the first render, when the cursor still sits on a group heading.
	 */
	private focusedEntry(): PanelEntry | undefined {
		const entries = this.activeEntries();
		this.clampSelection(entries);
		return entries[this.cursor.selected];
	}

	/** Retain the focus across a rebuild and return the entry it landed on. */
	private retain(entries: PanelEntry[]): PanelEntry | undefined {
		this.retainFocus(entries);
		this.clampSelection(entries);
		return entries[this.cursor.selected];
	}

	/** Expand or collapse the focused row's findings. */
	private toggleDetail(): void {
		const key = entryKey(this.focusedEntry());
		if (key === undefined) return;
		if (this.expanded.has(key)) this.expanded.delete(key);
		else this.expanded.add(key);
		this.options.requestRender();
	}

	/** Open the filter editor, seeded with what is already applied. */
	private openFilter(): void {
		this.filterEditing = { id: FILTER_EDIT_ID, buffer: this.filter.query, caret: this.filter.query.length };
		this.options.requestRender();
	}

	/**
	 * The filter editor's keys. The query applies as it is typed — a filter that
	 * only takes effect on `Enter` would make the reader wait to see it work — and
	 * `Esc` clears it rather than leaving a hidden narrowing behind.
	 */
	private handleFilterInput(data: string): void {
		const editing = this.filterEditing;
		if (editing === undefined) return;
		const action = applyEditKey(data, editing, FILTER_MAX);
		if (action.kind === "commit") {
			this.filterEditing = undefined;
			this.options.requestRender();
			return;
		}
		if (action.kind === "cancel") {
			this.filterEditing = undefined;
			this.filter = { ...this.filter, query: "" };
			this.options.requestRender();
			return;
		}
		if (!action.changed) return;
		this.filterEditing = action.state;
		this.filter = { ...this.filter, query: action.state.buffer };
		this.options.requestRender();
	}

	/** One key, read against the section's table, with navigation as the fallback. */
	handleInput(data: string): void {
		const section = this.section;
		// The editor takes every key, `Esc` included: it cancels the edit rather than
		// closing the screen. The filter editor does the same with the query.
		if (section === "settings" && this.settingsSection.isEditing) {
			this.settingsSection.handleEditingInput(data);
			return;
		}
		if (this.filterEditing !== undefined) {
			this.handleFilterInput(data);
			return;
		}
		// Any key dismisses the last notice and still does its own work.
		if (this.notice !== undefined) {
			this.notice = undefined;
			this.options.requestRender();
		}
		const key = keyFor(data, section);
		if (key !== undefined) {
			this.act(key);
			return;
		}
		// An input can arrive before the first render; put the focus on a row.
		this.clampSelection(this.activeEntries());
		this.navigate(data);
	}

	/** Run the action a key table row names. */
	private act(key: ReturnType<typeof keyFor>): void {
		switch (key) {
			case "close":
				this.options.onClose();
				return;
			case "previousSection":
				this.stepSection(-1);
				return;
			case "nextSection":
				this.stepSection(1);
				return;
			case "scope":
				this.switchScope();
				return;
			case "filter":
				this.openFilter();
				return;
			case "attention":
				this.filter = { ...this.filter, attentionOnly: !this.filter.attentionOnly };
				this.options.requestRender();
				return;
			case "help":
				this.helpOpen = !this.helpOpen;
				this.options.requestRender();
				return;
			case "reload":
				void this.reload();
				return;
			case "toggle":
				if (this.section === "settings") this.settingsSection.changeSetting();
				else this.toggle();
				return;
			case "change":
				this.settingsSection.changeSetting();
				return;
			case "reset":
				this.settingsSection.resetSetting();
				return;
			case "json":
				this.settingsSection.toggleJson();
				return;
			case "detail":
				this.toggleDetail();
				return;
			case "refresh":
				void this.refresh(true);
				return;
			case "inherit":
				// Only Project scope can hold an override, so the key does nothing
				// elsewhere and the hint row does not offer it there.
				if (this.options.runtime.scope() === "project") this.clearOverride();
				return;
			default:
				return;
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		// A click while editing leaves the editor the way `Esc` does: nothing is
		// written behind the screen.
		if (this.settingsSection.isEditing) {
			this.settingsSection.cancelEdit();
			return { handled: true };
		}
		const delta = wheelDelta(event);
		if (delta !== undefined) {
			moveRows(this.activeEntries(), this.cursor, delta);
			return { handled: true };
		}
		if ((event.type !== "click" && event.type !== "press") || event.button !== "left") return undefined;
		const entries = this.activeEntries();
		if (entries.length === 0) return undefined;
		const line = event.y - (BODY_START + (this.noteShown ? 1 : 0));
		const window = this.cursor.window(entries.length);
		if (line < 0 || line >= window.end - window.start) return undefined;
		const index = window.start + line;
		if (!isSelectable(entries[index])) return undefined;
		this.cursor.set(index, entries.length);
		return { handled: true };
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const section = this.section;
		const scope = this.options.runtime.scope();
		const source = this.source();
		const model = section === "settings" ? undefined : this.model(section);
		const entries = model === undefined ? this.settingsSection.entries() : entriesOf(model);
		const focusedEntry = this.retain(entries);
		const row = focusedEntry?.kind === "row" ? focusedEntry.row : undefined;
		const setting = focusedEntry?.kind === "setting" ? focusedEntry.setting : undefined;
		// The help block takes the focused row's place, and the block gets the whole
		// free height while it is open: a key table clipped to three rows is no help.
		const expanded = this.helpOpen || (row !== undefined && this.expanded.has(row.key));
		const wide = isWide(w);
		const blockWidth = wide ? sideWidth(w) : w;
		const block = sideRows({
			theme: this.theme,
			width: blockWidth,
			section,
			row,
			groupLabel: groupLabelFor(model, row),
			setting,
			help: this.helpOpen,
			expanded,
			// Below the pane breakpoint the block shares the rows with a table, so it
			// leaves out what the row above already says.
			compact: !wide,
			dirty: this.dirty,
			paths: { scope, cwd: this.options.cwd, agentDir: this.options.agentDir },
			json: this.settingsSection.jsonFor(setting),
		});

		if (section === "settings") this.labelColumn = settingLabelColumn(this.settingsSection.views(), w);
		const { lines, noteShown } = panelFrame({
			theme: this.theme,
			viewportRows: this.options.viewportRows,
			cursor: this.cursor,
			width: w,
			header: headerLine(this.theme, w, "Bytefly", attentionFor(source)),
			tabs: tabsLine(this.theme, w, section, sectionCounts(source), {
				chips: chipsFor(source, section, this.filterEditing),
				scope: scope === "global" ? "Global" : "Project",
			}),
			entries,
			note: section === "settings" && scope === "project" ? projectNote(this.theme, w) : undefined,
			detail: wide ? [] : clipRows(block, detailRows(expanded, this.options.viewportRows), w),
			hint: hintRow({
				theme: this.theme,
				width: w,
				section,
				editing: this.settingsSection.isEditing || this.filterEditing !== undefined,
				notice: this.notice,
				state: {
					expanded,
					refreshing: this.refreshing,
					projectScope: scope === "project",
					dirty: this.dirty,
					help: this.helpOpen,
				},
			}),
			emptyLabel: emptyLabelFor(this.filter, section),
			tallest: tallestBody(source),
			side: wide ? (rows) => clipRows(block, rows, blockWidth) : undefined,
			draw: (entry, index) => this.drawRow(entry, index, w, section, model),
		});
		this.noteShown = noteShown;
		return lines;
	}

	/** One body line, in the section's own row grammar. */
	private drawRow(
		entry: PanelEntry,
		index: number,
		width: number,
		section: PanelSection,
		model: PanelModel | undefined,
	): string | undefined {
		const selected = index === this.cursor.selected;
		if (entry.kind === "group") return groupLine(this.theme, width, entry);
		if (entry.kind === "row") {
			return resourceRow(this.theme, width, entry.row, selected, model === undefined ? 0 : verdictColumn(model.rows));
		}
		if (section !== "settings") return undefined;
		const editing =
			this.settingsSection.editingState?.id === entry.setting.id ? this.settingsSection.editingState : undefined;
		return settingRow(this.theme, width, entry.setting, selected, editing, this.labelColumn);
	}
}
