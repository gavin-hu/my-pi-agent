/**
 * The Settings section's own state: the text editor, the JSON pane, and the
 * writes. Everything it draws comes from `tui.ts` and `side-pane.ts`, because all
 * three sections draw one frame.
 *
 * The component owns the section switch, the write scope, the cursor, the filter
 * and the keys the three sections share; this class owns what only Settings has.
 */

import type { ListCursor } from "../../../../lib/tui/cursor.ts";
import type { WriteScope } from "../../picker/types.ts";
import { settingMatches, type PanelFilter } from "../filter.ts";
import type { SettingsSurface } from "../settings-runtime.ts";
import { SETTING_ROWS, type SettingView } from "../settings.ts";
import { applyEditKey, type EditingState } from "./editing.ts";
import { settingEntries, type PanelEntry } from "./entries.ts";
import { clampSelection } from "./nav.ts";

/** What the Settings section needs from the component that hosts it. */
export interface SettingsSectionDeps {
	/** The rows, values, and writes the section reads and calls. */
	surface: SettingsSurface;
	/** The write scope the component owns. */
	scope(): WriteScope;
	/** The filter the component owns. */
	filter(): PanelFilter;
	cursor: ListCursor;
	/** Keep the focused row across a rebuild and return it. */
	retain(entries: PanelEntry[]): PanelEntry | undefined;
	/** Panel navigation, for the keys this section does not own. */
	navigate(data: string): void;
	/** Flip the Global/Project scope. */
	switchScope(): void;
	notify(message: string): void;
	requestRender(): void;
}

/** The Settings section's state. */
export class SettingsSection {
	private chain: Promise<void> = Promise.resolve();
	private editing: EditingState | undefined;
	private json = false;

	constructor(private readonly deps: SettingsSectionDeps) {}

	/** Whether a text row is open in the editor, so the hint row and keys defer. */
	get isEditing(): boolean {
		return this.editing !== undefined;
	}

	/** Whether the focused row's section is shown as JSON. */
	get jsonOpen(): boolean {
		return this.json;
	}

	/** The editor's buffer and caret, for the row that is being typed into. */
	get editingState(): EditingState | undefined {
		return this.editing;
	}

	/** Run `task` after the previous write, then repaint once. */
	private write(task: () => Promise<unknown>, onSettled?: (result: unknown) => void): void {
		this.chain = this.chain
			.then(task)
			.then(onSettled)
			.catch((error: unknown) => this.deps.notify(error instanceof Error ? error.message : String(error)))
			.then(() => this.deps.requestRender());
	}

	/** The rows the active scope shows, after the filter. */
	views(): SettingView[] {
		const filter = this.deps.filter();
		return this.deps.surface.views(this.deps.scope()).filter((view) => settingMatches(view, filter));
	}

	/** Those rows as display entries, grouped under their headings. */
	entries(): PanelEntry[] {
		return settingEntries(this.views());
	}

	/** The focused setting, after clamping the cursor onto a row. */
	focused(): SettingView | undefined {
		const entries = this.entries();
		clampSelection(entries, this.deps.cursor);
		const entry = entries[this.deps.cursor.selected];
		return entry?.kind === "setting" ? entry.setting : undefined;
	}

	/** The stored document behind the focused row, when the JSON pane is open. */
	jsonFor(view: SettingView | undefined): { section: string; document: unknown } | undefined {
		if (!this.json || view?.config === undefined) return undefined;
		const { section } = view.config;
		return { section, document: this.deps.surface.sectionDocument(this.deps.scope(), section) };
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
	changeSetting(): void {
		const view = this.focused();
		if (view === undefined) return;
		if (view.kind === "text") {
			this.editing = { id: view.id, buffer: view.value, caret: view.value.length };
			this.deps.requestRender();
			return;
		}
		const scope = this.deps.scope();
		this.write(() => this.deps.surface.change(scope, view.id));
	}

	/** Delete the focused setting's leaf, so its default applies again. */
	resetSetting(): void {
		const view = this.focused();
		if (view === undefined) return;
		const scope = this.deps.scope();
		this.write(() => this.deps.surface.reset(scope, view.id));
	}

	/** Toggle the focused row between its value and the whole section as stored. */
	toggleJson(): void {
		const view = this.focused();
		if (view === undefined) return;
		if (!view.config) {
			// There is no section to show, so leave the mode off rather than keeping a
			// hidden toggle that would reopen the pane on another row.
			this.json = false;
			this.deps.notify(`${view.label} is a Pi setting; bytefly.json has no section for it.`);
			return;
		}
		this.json = !this.json;
		this.deps.requestRender();
	}

	/** Store the editor's buffer; a refusal keeps it open with the reason shown. */
	commitEdit(): void {
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
	handleEditingInput(data: string): void {
		const editing = this.editing;
		if (!editing) return;
		const max = SETTING_ROWS.find((row) => row.id === editing.id)?.text?.maxLength;
		const action = applyEditKey(data, editing, max);
		if (action.kind === "commit") {
			this.commitEdit();
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
}
