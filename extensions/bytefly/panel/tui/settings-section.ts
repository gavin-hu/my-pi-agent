/**
 * The Settings section: its own state (the editor and the JSON pane), its key
 * handling, and the screen it draws.
 *
 * The component owns the section switch, the write scope, and the cursor. This
 * class owns what only Settings has, so `tui.ts` stays the switch and the shared
 * list keys, and the section reads and writes through the same surface.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { ViewportRowsSource } from "../../../../lib/tui/chrome.ts";
import type { ListCursor } from "../../../../lib/tui/cursor.ts";
import type { WriteScope } from "../../picker/types.ts";
import type { SettingsSurface } from "../settings-runtime.ts";
import { SETTING_ROWS } from "../settings.ts";
import { applyEditKey, type EditingState } from "./editing.ts";
import { settingEntries, type PanelEntry } from "./entries.ts";
import { detailRows, groupLine, panelFrame, sectionBar } from "./frame.ts";
import { clampSelection } from "./nav.ts";
import { projectNote, sectionJsonPane, settingDetail, settingRow, settingsSummary } from "./settings-view.ts";

/** What the Settings section needs from the component that hosts it. */
export interface SettingsSectionDeps {
	/** The rows, values, and writes the section reads and calls. */
	surface: SettingsSurface;
	theme: Theme;
	scope(): WriteScope;
	cursor: ListCursor;
	viewportRows: ViewportRowsSource | undefined;
	cwd: string;
	agentDir: string;
	/** Keep the focused row across a rebuild and return it. */
	retain(entries: PanelEntry[]): PanelEntry | undefined;
	/** Panel navigation, for the keys this section does not own. */
	navigate(data: string): void;
	/** Flip the Global/Project scope. */
	switchScope(): void;
	notify(message: string): void;
	requestRender(): void;
	/** Keep the frame's project-note marker in step for the mouse mapping. */
	setNoteShown(shown: boolean): void;
	/** The hint row, already assembled (or the notice that replaces it). */
	hint(width: number): string;
}

/** The Settings section's state and screen. */
export class SettingsSection {
	private chain: Promise<void> = Promise.resolve();
	private editing: EditingState | undefined;
	private json = false;

	constructor(private readonly deps: SettingsSectionDeps) {}

	/** Whether a text row is open in the editor, so the hint row and mouse defer. */
	get isEditing(): boolean {
		return this.editing !== undefined;
	}

	/** Whether the detail pane shows the focused row's section as JSON. */
	get jsonOpen(): boolean {
		return this.json;
	}

	/** Run `task` after the previous write, then repaint once. */
	private write(task: () => Promise<unknown>, onSettled?: (result: unknown) => void): void {
		this.chain = this.chain
			.then(task)
			.then(onSettled)
			.catch((error: unknown) => this.deps.notify(error instanceof Error ? error.message : String(error)))
			.then(() => this.deps.requestRender());
	}

	/** The rows for the active scope, as display entries. */
	private entries(): PanelEntry[] {
		return settingEntries(this.deps.surface.views(this.deps.scope()));
	}

	/** The focused entry, after clamping the cursor onto a row. */
	private focused(): PanelEntry | undefined {
		const entries = this.entries();
		clampSelection(entries, this.deps.cursor);
		return entries[this.deps.cursor.selected];
	}

	/** Drop the editor and the JSON pane when another section takes over. */
	reset(): void {
		this.editing = undefined;
		this.json = false;
	}

	/** A click leaves the editor the way `Esc` does: nothing is written. */
	cancelEdit(): void {
		this.reset();
		this.deps.requestRender();
	}

	/** Change the focused setting: cycle it, or open the editor for a text row. */
	private changeSetting(): void {
		const entry = this.focused();
		if (entry?.kind !== "setting") return;
		const view = entry.setting;
		if (view.kind === "text") {
			this.editing = { id: view.id, buffer: view.value, caret: view.value.length };
			this.deps.requestRender();
			return;
		}
		const scope = this.deps.scope();
		this.write(() => this.deps.surface.change(scope, view.id));
	}

	/** Delete the focused setting's leaf, so its default applies again. */
	private resetSetting(): void {
		const entry = this.focused();
		if (entry?.kind !== "setting") return;
		const scope = this.deps.scope();
		this.write(() => this.deps.surface.reset(scope, entry.setting.id));
	}

	/** Toggle the detail pane between the row and its whole section as stored. */
	private toggleJson(): void {
		const entry = this.focused();
		if (entry?.kind !== "setting") return;
		if (!entry.setting.config) {
			// There is no section to show, so leave the mode off rather than keeping a
			// hidden toggle that would reopen the pane on another row.
			this.json = false;
			this.deps.notify(`${entry.setting.label} is a Pi setting; bytefly.json has no section for it.`);
			return;
		}
		this.json = !this.json;
		this.deps.requestRender();
	}

	/** Store the editor's buffer; a refusal keeps it open with the reason shown. */
	private commitEdit(): void {
		const editing = this.editing;
		if (!editing) return;
		const scope = this.deps.scope();
		this.write(
			() => this.deps.surface.setValue(scope, editing.id, editing.buffer),
			(saved) => {
				if (saved === true) this.editing = undefined;
			},
		);
	}

	/**
	 * Editor keys. `Esc`/`Ctrl+C` cancel the edit rather than closing the screen,
	 * and everything else the section binds is inert until the editor closes.
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
			this.deps.requestRender();
			return;
		}
		if (!action.changed) return;
		this.editing = action.state;
		this.deps.requestRender();
	}

	/** One key: editor keys first, then change, scope, reset, JSON, navigation. */
	handleInput(data: string): void {
		if (this.editing) {
			this.handleEditingInput(data);
			return;
		}
		this.focused();
		if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
			this.changeSetting();
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.deps.switchScope();
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
		this.deps.navigate(data);
	}

	/** The Settings body: scope counts, the project note, rows, and detail. */
	render(width: number, header: string): string[] {
		const { theme, surface, viewportRows, cwd, agentDir } = this.deps;
		const scope = this.deps.scope();
		const views = surface.views(scope);
		const entries = settingEntries(views);
		const focusedEntry = this.deps.retain(entries);
		const focused = focusedEntry?.kind === "setting" ? focusedEntry.setting : undefined;
		// A row with no section leaves the mode off, so moving away and back cannot
		// reopen a pane the user closed.
		if (focused && !focused.config) this.json = false;
		const jsonSection = this.json ? focused?.config : undefined;
		const paths = { scope, cwd, agentDir };
		const detail = jsonSection
			? sectionJsonPane({
					theme,
					width,
					section: jsonSection.section,
					document: surface.sectionDocument(scope, jsonSection.section),
					budget: detailRows(true, viewportRows),
					dirty: surface.isDirty(),
					paths,
				})
			: settingDetail({
					theme,
					width,
					view: focused,
					budget: detailRows(false, viewportRows),
					dirty: surface.isDirty(),
					paths,
				});

		const { lines, noteShown } = panelFrame({
			theme,
			viewportRows,
			cursor: this.deps.cursor,
			width,
			header,
			summary: sectionBar(theme, width, "settings", settingsSummary(theme, width, scope, views.length)),
			entries,
			note: scope === "project" ? projectNote(theme, width) : undefined,
			detail,
			hint: this.deps.hint(width),
			draw: (entry, index) => {
				if (entry.kind === "group") return groupLine(theme, width, entry);
				if (entry.kind !== "setting") return undefined;
				const editing = this.editing?.id === entry.setting.id ? this.editing : undefined;
				return settingRow(theme, width, entry.setting, index === this.deps.cursor.selected, editing);
			},
		});
		this.deps.setNoteShown(noteShown);
		return lines;
	}
}
