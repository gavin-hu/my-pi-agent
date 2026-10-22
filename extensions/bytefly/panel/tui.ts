/**
 * The unified bytefly panel: three sections around one docked list.
 *
 * Extensions lists every resolved extension with its enable checkbox and its
 * health; Skills lists every resolved skill the same way, with what its
 * `SKILL.md` declares; Settings lists the curated preferences with their values.
 * The component owns the section switch, the cursors, the focused row key per
 * section, the expanded set, the pending toggle chain, and the notice; the
 * section modules own their rows and detail panes, and the Settings section also
 * owns its editor and JSON-pane state. It is derived: every render rebuilds the
 * model from the picker runtime, the reports, the skill index, or the settings
 * surface, and keeps the focused row's key across rebuilds. The screen is drawn
 * from the design system — a label-first `titleRule`, one `listRow` grammar, one
 * `checkbox` — and its scroll math from `lib/tui/cursor.ts`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ScreenHint, ViewportRowsSource } from "../../../lib/tui/chrome.ts";
import { isCloseKey, ListCursor, wheelDelta } from "../../../lib/tui/cursor.ts";
import { titleRule } from "../../../lib/tui/rules.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import type { PickerRuntime } from "../picker/runtime.ts";
import type { ResourceKind } from "../picker/types.ts";
import { SECTION_ORDER, SKILL_NOUN } from "./format.ts";
import { buildPanelModel, buildSkillModel } from "./join.ts";
import { UNTRUSTED_SETTINGS_NOTE } from "./settings.ts";
import type { SettingsSurface } from "./settings-runtime.ts";
import type { PanelModel, PanelRow, PanelSection, SkillInfo } from "./types.ts";
import { entriesOf, entryKey, isSelectable, settingEntries, type PanelEntry } from "./tui/entries.ts";
import { extensionDetail } from "./tui/extensions-view.ts";
import { BODY_START, detailRows, groupLine, hintLine, noticeLine, panelFrame, sectionBar } from "./tui/frame.ts";
import { resourceRow, resourceSummary, sectionHints } from "./tui/list-view.ts";
import { clampSelection, moveRows, navigateEntries, retainFocus } from "./tui/nav.ts";
import { editHints, settingsHints } from "./tui/settings-view.ts";
import { SettingsSection } from "./tui/settings-section.ts";
import { skillDetail } from "./tui/skills-view.ts";

/** A section that draws a resource list rather than the settings table. */
type ListSection = ResourceKind;

/** Host seams for the panel screen, injected by the command runner. */
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
	/** The session working directory, for the config-file path in the detail pane. */
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
	onClose: () => void;
}

/** What a list section's detail pane receives; each section reads what it needs. */
interface DetailInput {
	theme: Theme;
	width: number;
	row: PanelRow | undefined;
	budget: number;
	expanded: boolean;
	dirty: boolean;
}

/** What a list section's hint row receives. */
interface HintInput {
	expanded: boolean;
	refreshing: boolean;
	projectScope: boolean;
}

/** One list section's own vocabulary: what it calls empty, its pane, and its hints. */
interface ListView {
	emptyLabel: string;
	detail(input: DetailInput): string[];
	hints(input: HintInput): ScreenHint[];
}

/**
 * The two list sections. Everything else — the frame, the rows, the cursor, the
 * keys, the scope — is shared, so a section only supplies what it alone can say.
 */
const LIST_VIEWS: Record<ListSection, ListView> = {
	extensions: {
		emptyLabel: "No extensions found.",
		detail: (input) => extensionDetail(input.theme, input.width, input.row, input.budget, input.expanded, input.dirty),
		hints: (input) =>
			sectionHints({ expanded: input.expanded, projectScope: input.projectScope, refreshing: input.refreshing }),
	},
	skills: {
		emptyLabel: "No skills found.",
		detail: (input) => skillDetail(input),
		// A skill has no probe to re-run, so the section never offers the refresh key.
		hints: (input) => sectionHints({ expanded: input.expanded, projectScope: input.projectScope }),
	},
};

/** The resource kind a list section toggles, or `undefined` for Settings. */
function kindOf(section: PanelSection): ResourceKind | undefined {
	return section === "settings" ? undefined : section;
}

/** The docked bytefly panel. */
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
	/** Whether the last Settings render kept the project note; the click mapping needs it. */
	private noteShown = false;
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
			theme: options.theme,
			scope: () => this.options.runtime.scope(),
			cursor: this.cursors.settings,
			viewportRows: options.viewportRows,
			cwd: options.cwd,
			agentDir: options.agentDir,
			retain: (entries) => this.retain(entries),
			navigate: (data) => this.navigate(data),
			switchScope: () => this.switchScope(),
			notify: (message) => this.notify(message),
			requestRender,
			setNoteShown: (shown) => {
				this.noteShown = shown;
			},
			hint: (width) => this.hintRow(width, { jsonOpen: this.settingsSection.jsonOpen }),
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

	/** The merged model for the current items of one list section. */
	private model(kind: ListSection): PanelModel {
		if (kind === "skills") {
			return buildSkillModel({
				items: this.options.runtime.items("skills"),
				index: this.skills(),
				agentDir: this.options.agentDir,
			});
		}
		return buildPanelModel({
			items: this.options.runtime.items("extensions"),
			reports: this.options.reports(),
			agentDir: this.options.agentDir,
			filter: this.options.filter,
		});
	}

	/** Skill metadata, loaded on first use and kept for the screen's lifetime. */
	private skills(): ReadonlyMap<string, SkillInfo> {
		this.skillIndex ??= this.options.skills();
		return this.skillIndex;
	}

	/** The entries of the visible section. */
	private activeEntries(): PanelEntry[] {
		const section = this.section;
		if (section === "settings") {
			return settingEntries(this.options.settings.views(this.options.runtime.scope()));
		}
		return entriesOf(this.model(section));
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
		const kind = kindOf(this.section);
		if (kind === undefined) return;
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
			.then(() => this.options.runtime.toggle(kind, item))
			.catch(() => undefined)
			.then(() => this.options.requestRender());
	}

	/** Drop the focused resource's project override, restoring the inherited row. */
	private clearOverride(): void {
		const kind = kindOf(this.section);
		if (kind === undefined) return;
		const entry = this.activeEntries()[this.cursor.selected];
		if (entry?.kind !== "row") return;
		const item = entry.row.item;
		if (!item) {
			this.notify(`${entry.row.label} is not resolved; there is no override to clear.`);
			return;
		}
		this.chain = this.chain
			.then(() => this.options.runtime.clearOverride(kind, item))
			.catch(() => undefined)
			.then(() => this.options.requestRender());
	}

	/**
	 * Ask for the work the newly visible section needs. The Extensions view probes
	 * when the session had no cache — doing it at mount would delay `/bytefly
	 * settings`, which never reads the reports — and the Skills view reads its
	 * metadata in the same one-shot way, so a scope switch repaints with names.
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

	/**
	 * Step one section left or right. The ends stop instead of wrapping, so the
	 * bar reads as the screen's order rather than a loop.
	 */
	private stepSection(direction: -1 | 1): void {
		const next = SECTION_ORDER[SECTION_ORDER.indexOf(this.section) + direction];
		if (next === undefined || next === this.section) return;
		this.section = next;
		this.settingsSection.reset();
		this.prime();
		this.options.requestRender();
	}

	/** Read one navigation key against the visible section. */
	private navigate(data: string): void {
		navigateEntries(this.activeEntries(), this.cursor, data, { grouped: this.section !== "settings" });
	}

	/** Drop the hint row's notice; any key dismisses it and still acts. */
	private dismissNotice(): void {
		if (this.notice === undefined) return;
		this.notice = undefined;
		this.options.requestRender();
	}

	handleInput(data: string): void {
		const section = this.section;
		if (section === "settings") {
			// The editor takes every key, `Esc` included: it cancels the edit rather
			// than closing the screen.
			if (this.settingsSection.isEditing) {
				this.settingsSection.handleInput(data);
				return;
			}
			if (isCloseKey(data)) {
				this.options.onClose();
				return;
			}
			this.dismissNotice();
			if (matchesKey(data, Key.left)) {
				this.stepSection(-1);
				return;
			}
			if (matchesKey(data, Key.right)) {
				this.stepSection(1);
				return;
			}
			this.settingsSection.handleInput(data);
			return;
		}
		if (isCloseKey(data)) {
			this.options.onClose();
			return;
		}
		this.dismissNotice();
		if (matchesKey(data, Key.left)) {
			this.stepSection(-1);
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.stepSection(1);
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
		// Re-probing is the Extensions view's job; a skill has nothing to probe.
		if (section === "extensions" && matchesKey(data, "r")) {
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
		// The Settings section prints the "Global only" note first in Project scope,
		// so the rows start one line lower there.
		const note = this.section === "settings" && this.noteShown ? 1 : 0;
		const line = event.y - (BODY_START + note);
		const window = this.cursor.window(entries.length);
		if (line < 0 || line >= window.end - window.start) return undefined;
		const index = window.start + line;
		if (!isSelectable(entries[index])) return undefined;
		this.cursor.set(index, entries.length);
		return { handled: true };
	}

	/** Key hints for the active section; whole hints drop as the width runs out. */
	private hint(width: number, options: { expanded?: boolean; jsonOpen?: boolean } = {}): string {
		if (this.settingsSection.isEditing) return hintLine(this.theme, width, editHints());
		if (this.section === "settings") {
			return hintLine(this.theme, width, settingsHints(options.jsonOpen === true));
		}
		const hints = LIST_VIEWS[this.section].hints({
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

	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "Bytefly");
		const section = this.section;
		if (section === "settings") return this.settingsSection.render(w, header);

		const model = this.model(section);
		const entries = entriesOf(model);
		const summary = sectionBar(
			this.theme,
			w,
			section,
			resourceSummary(
				this.theme,
				w,
				model,
				this.options.runtime.scope(),
				section === "skills" ? { noun: SKILL_NOUN } : { filter: this.options.filter },
			),
		);

		const focusedEntry = this.retain(entries);
		const focused = focusedEntry?.kind === "row" ? focusedEntry.row : undefined;
		const expanded = focused !== undefined && this.expanded.has(focused.key);
		const detail = LIST_VIEWS[section].detail({
			theme: this.theme,
			width: w,
			row: focused,
			budget: detailRows(expanded, this.options.viewportRows),
			expanded,
			dirty: this.dirty,
		});

		const { lines, noteShown } = panelFrame({
			theme: this.theme,
			viewportRows: this.options.viewportRows,
			cursor: this.cursor,
			width: w,
			header,
			summary,
			entries,
			emptyLabel: LIST_VIEWS[section].emptyLabel,
			detail,
			hint: this.hintRow(w, { expanded }),
			draw: (entry, index) => {
				if (entry.kind === "group") return groupLine(this.theme, w, entry);
				if (entry.kind !== "row") return undefined;
				return resourceRow(this.theme, w, entry.row, index === this.cursor.selected);
			},
		});
		this.noteShown = noteShown;
		return lines;
	}
}
