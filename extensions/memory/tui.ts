/**
 * Terminal UI for the memory extension: the `/memory` picker.
 *
 * `MemoryPickerComponent` is a derived dock screen. It reads the live notes on
 * every render (`entries()` refreshes from disk first) and asks for a repaint
 * after an action settles, so an external edit or a mutation is reflected
 * without the component owning any authoritative state. Navigation and scroll
 * math come from `lib/tui/cursor.ts` and the screen chrome from `lib/tui/chrome.ts`;
 * the inline note editor is the shared `Editor` from `@earendil-works/pi-tui`.
 *
 * `m` marks one note as a merge source and `m` on a second note in the same
 * scope opens the editor, pre-filled with both notes so the user writes the
 * merged wording. The merge is one write: the store replaces the first note and
 * drops the second. `p` moves the focused note to the other scope, which is two
 * writes ordered target-first so a failure leaves a duplicate, never a loss.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	Key,
	matchesKey,
	type Component,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../lib/format.ts";
import { ConfirmState } from "../../lib/tui/confirm.ts";
import { fitRows, formatRange, isCloseKey, ListCursor, navigateList, scrollList } from "../../lib/tui/cursor.ts";
import { dockListFrame, editorTheme, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { emptyState, listRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { messageOf } from "./errors.ts";
import { scopeLabel, type MemoryEntries } from "./format.ts";
import type { MemoryScope } from "./types.ts";

/** Note limit enforced by the `memory` tool; the picker mirrors it so a save is never rejected late. */
const MAX_NOTE_CHARS = 500;

/** Rows the screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 14;

/** Fixed rows around the list: header, summary, blank, blank, hint, closing rule. */
const CHROME = 6;

/** Which scopes the list shows. */
export type MemoryFilter = "all" | MemoryScope;

/** The live store and the mutations the picker drives. */
export interface MemoryPickerCallbacks {
	/** Current notes, refreshed from disk first. */
	entries(): MemoryEntries;
	/** Whether the project store may be read and written. */
	trusted(): boolean;
	/** Re-read any changed store; returns whether either changed. */
	refresh(): boolean;
	add(scope: MemoryScope, text: string): Promise<{ changed: boolean; existing?: string }>;
	update(scope: MemoryScope, from: string, to: string): Promise<boolean>;
	forget(scope: MemoryScope, entry: string): Promise<boolean>;
	/** Merge two notes in `scope` into one, in a single write. */
	merge(scope: MemoryScope, first: string, second: string, merged: string): Promise<boolean>;
	/** Move a note to the other scope: written there first, then removed here. */
	move(from: MemoryScope, to: MemoryScope, entry: string): Promise<{ moved: boolean; existing?: string }>;
}

/** One note in the flat, filtered list. */
interface Note {
	scope: MemoryScope;
	text: string;
}

/** Identity of a note: its scope and exact text (unique within a scope). */
function noteKey(note: Note): string {
	return `${note.scope}\u0000${note.text}`;
}

/** Dismissible `/memory` screen: a scope-filtered note list with inline actions. */
export class MemoryPickerComponent implements Component {
	private readonly cursor: ListCursor;
	private readonly editor: Editor;

	private filter: MemoryFilter = "all";
	private mode: "list" | "edit" | "add" | "merge" = "list";
	/** Scope the inline editor writes to. */
	private editorScope: MemoryScope = "project";
	/** Note being edited, or undefined while adding. */
	private editing: Note | undefined;
	/** The two notes a merge editor will combine. */
	private mergePair: { first: Note; second: Note } | undefined;
	/** The note marked with `m`, awaiting a second `m` to merge into it. */
	private mergeSource: Note | undefined;
	/** The y/N forget confirmation, shared with the other destructive screens. */
	private readonly confirm = new ConfirmState();
	/** Transient feedback shown in place of the hint. */
	private notice: string | undefined;
	private componentFocused = false;
	/** Stable selection identity, re-derived when the filtered list changes. */
	private selectedKey: string | undefined;
	/** Serialises mutations so a rapid double press cannot interleave writes. */
	private chain: Promise<void> = Promise.resolve();

	constructor(
		tui: TUI,
		private readonly theme: Theme,
		private readonly callbacks: MemoryPickerCallbacks,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
		private readonly viewportRowsSource?: ViewportRowsSource,
	) {
		this.cursor = new ListCursor(() => this.requestRender());
		this.editor = new Editor(tui, editorTheme(theme));
		this.editor.onSubmit = (value) => this.submitEditor(value);
	}

	/** The filter, downgraded to `global` when the project is untrusted. */
	private effectiveFilter(): MemoryFilter {
		return this.filter === "project" && !this.callbacks.trusted() ? "global" : this.filter;
	}

	/** The flat, filtered note list, in project-then-global order. */
	private notes(): Note[] {
		const entries = this.callbacks.entries();
		const filter = this.effectiveFilter();
		const scopes: MemoryScope[] =
			filter === "all" ? (this.callbacks.trusted() ? ["project", "global"] : ["global"]) : [filter];
		const notes: Note[] = [];
		for (const scope of scopes) {
			for (const text of entries[scope]) notes.push({ scope, text });
		}
		return notes;
	}

	/** The scope an action targets: the filter's scope, or the best default. */
	private activeScope(): MemoryScope {
		if (this.filter === "global") return "global";
		if (this.filter === "project" && this.callbacks.trusted()) return "project";
		return this.callbacks.trusted() ? "project" : "global";
	}

	/** Index of the selected note in `notes`, re-derived from its key. */
	private focusIndex(notes: Note[]): number {
		if (notes.length === 0) return 0;
		const found = this.selectedKey ? notes.findIndex((note) => noteKey(note) === this.selectedKey) : -1;
		return found >= 0 ? found : 0;
	}

	/** Move the focus to `index`, recording the note's key. Never repaints. */
	private focusIndexNow(index: number, notes: Note[]): void {
		if (notes.length === 0) {
			this.selectedKey = undefined;
			return;
		}
		const clamped = Math.min(Math.max(0, index), notes.length - 1);
		this.selectedKey = noteKey(notes[clamped]);
		this.cursor.selected = clamped;
		this.cursor.sync(notes.length);
	}

	private cycleFilter(): void {
		const order: MemoryFilter[] = this.callbacks.trusted() ? ["all", "project", "global"] : ["all", "global"];
		const at = order.indexOf(this.effectiveFilter());
		this.filter = order[(at + 1) % order.length];
		this.selectedKey = undefined;
		this.requestRender();
	}

	private startEdit(note: Note | undefined): void {
		if (!note) return;
		if (note.scope === "project" && !this.callbacks.trusted()) {
			this.notice = "Project memory is unavailable for an untrusted project.";
			this.requestRender();
			return;
		}
		this.mode = "edit";
		this.editing = note;
		this.mergePair = undefined;
		this.editorScope = note.scope;
		this.editor.setText(note.text);
		this.syncEditorFocus();
		this.requestRender();
	}

	/**
	 * `m`: mark the focused note, unmark it, or open the merge editor for a marked
	 * pair. The mark survives navigation so the second note can be found.
	 */
	private toggleMerge(note: Note | undefined): void {
		if (!note) return;
		const source = this.mergeSource;
		if (source && noteKey(source) === noteKey(note)) {
			this.mergeSource = undefined;
			this.requestRender();
			return;
		}
		if (source) {
			this.startMerge(source, note);
			return;
		}
		this.mergeSource = note;
		this.notice = undefined;
		this.requestRender();
	}

	/** Open the editor for a marked pair, pre-filled with both notes to rewrite. */
	private startMerge(first: Note, second: Note): void {
		if (first.scope !== second.scope) {
			this.notice = "A merge combines two notes in the same scope.";
			this.requestRender();
			return;
		}
		this.mode = "merge";
		this.editing = undefined;
		this.mergePair = { first, second };
		this.editorScope = first.scope;
		// The user writes the merged wording; the seed only saves retyping both notes.
		this.editor.setText(`${first.text}; ${second.text}`.slice(0, MAX_NOTE_CHARS));
		this.syncEditorFocus();
		this.requestRender();
	}

	private startAdd(): void {
		this.mode = "add";
		this.editing = undefined;
		this.mergePair = undefined;
		this.editorScope = this.activeScope();
		this.editor.setText("");
		this.syncEditorFocus();
		this.requestRender();
	}

	private cancelEditor(): void {
		this.mode = "list";
		this.editing = undefined;
		this.mergePair = undefined;
		this.mergeSource = undefined;
		this.syncEditorFocus();
		this.notice = undefined;
		this.requestRender();
	}

	private submitEditor(value: string): void {
		const text = sanitizeLine(value).trim();
		const editing = this.editing;
		const scope = this.editorScope;
		const pair = this.mergePair;
		this.mode = "list";
		this.editing = undefined;
		this.mergePair = undefined;
		this.mergeSource = undefined;
		this.syncEditorFocus();

		if (text.length === 0) {
			this.notice = "A note cannot be blank.";
			this.requestRender();
			return;
		}
		if (text.length > MAX_NOTE_CHARS) {
			this.notice = `A note must be at most ${MAX_NOTE_CHARS} characters.`;
			this.requestRender();
			return;
		}

		this.run(async () => {
			if (pair) {
				await this.callbacks.merge(pair.first.scope, pair.first.text, pair.second.text, text);
				this.notice = `Merged 2 ${scopeLabel(pair.first.scope)} notes.`;
				this.selectedKey = noteKey({ scope: pair.first.scope, text });
				return;
			}
			if (editing) {
				if (text === editing.text) {
					this.notice = "Unchanged.";
					return;
				}
				await this.callbacks.update(scope, editing.text, text);
				this.notice = `Updated ${scopeLabel(scope)} note.`;
				this.selectedKey = noteKey({ scope, text });
				return;
			}
			const result = await this.callbacks.add(scope, text);
			if (result.changed) {
				this.notice = `Added ${scopeLabel(scope)} note.`;
				this.selectedKey = noteKey({ scope, text });
			} else {
				this.notice = `Already remembered: ${result.existing ?? text}`;
			}
		});
	}

	private forgetNote(note: Note): void {
		// Capture the neighbour before the write so the focus lands on it after.
		const before = this.notes();
		const at = before.findIndex((item) => noteKey(item) === noteKey(note));
		const neighbour = before[at + 1] ?? before[at - 1];
		this.run(async () => {
			await this.callbacks.forget(note.scope, note.text);
			this.notice = `Forgot ${scopeLabel(note.scope)} note.`;
			this.selectedKey = neighbour ? noteKey(neighbour) : undefined;
		});
	}

	/** `p`: move the focused note to the other scope, target first. */
	private moveNote(note: Note | undefined): void {
		if (!note) return;
		const to: MemoryScope = note.scope === "project" ? "global" : "project";
		if (to === "project" && !this.callbacks.trusted()) {
			this.notice = "Project memory is unavailable for an untrusted project.";
			this.requestRender();
			return;
		}
		const from = note.scope;
		const text = note.text;
		this.run(async () => {
			const result = await this.callbacks.move(from, to, text);
			if (!result.moved) {
				this.notice = `Added to ${scopeLabel(to)}; the ${scopeLabel(from)} note was already gone.`;
			} else if (result.existing !== undefined) {
				this.notice = `Moved to ${scopeLabel(to)} (it was already there).`;
			} else {
				this.notice = `Moved to ${scopeLabel(to)}.`;
			}
			this.selectedKey = noteKey({ scope: to, text });
		});
	}

	private reload(): void {
		this.notice = this.callbacks.refresh() ? "Reloaded memory." : "Memory is already up to date.";
		this.requestRender();
	}

	/** Run a mutation off the shared chain, then repaint from the new state. */
	private run(action: () => Promise<void>): void {
		this.chain = this.chain
			.then(action)
			.catch((error: unknown) => {
				this.notice = `Memory not saved: ${messageOf(error)}`;
			})
			.then(() => {
				this.dropStaleMergeSource();
				this.requestRender();
			});
	}

	/** A merge source that a mutation removed is no longer a valid target. */
	private dropStaleMergeSource(): void {
		const source = this.mergeSource;
		if (!source) return;
		if (!this.notes().some((note) => noteKey(note) === noteKey(source))) this.mergeSource = undefined;
	}

	private syncEditorFocus(): void {
		this.editor.focused = this.componentFocused && this.mode !== "list";
	}

	private handleConfirm(data: string): void {
		if (this.confirm.resolve(data) !== undefined) this.requestRender();
	}

	handleInput(data: string): void {
		if (this.mode !== "list") {
			if (isCloseKey(data) || matchesKey(data, Key.escape)) {
				this.cancelEditor();
				return;
			}
			this.editor.handleInput(data);
			this.requestRender();
			return;
		}
		if (this.confirm.pending) {
			this.handleConfirm(data);
			return;
		}
		if (isCloseKey(data) || data === "q") {
			// With a mark set, the first Esc cancels the merge instead of closing the screen.
			if (this.mergeSource) {
				this.mergeSource = undefined;
				this.requestRender();
				return;
			}
			this.onClose();
			return;
		}
		if (this.notice !== undefined) this.notice = undefined;

		const notes = this.notes();
		this.focusIndexNow(this.focusIndex(notes), notes);
		if (navigateList(data, this.cursor, notes.length)) {
			this.selectedKey = notes[this.cursor.selected] ? noteKey(notes[this.cursor.selected]) : undefined;
			this.requestRender();
			return;
		}
		// The hint advertises `g`/`G`, so bind them to the ends.
		if (data === "g" || data === "G") {
			this.cursor.set(data === "g" ? 0 : notes.length - 1, notes.length);
			this.selectedKey = notes[this.cursor.selected] ? noteKey(notes[this.cursor.selected]) : undefined;
			this.requestRender();
			return;
		}

		const focused = notes[this.cursor.selected];
		if (matchesKey(data, Key.tab) || data === "s") this.cycleFilter();
		else if (matchesKey(data, Key.enter) || data === "e") this.startEdit(focused);
		else if (data === "a") this.startAdd();
		else if (data === "m") this.toggleMerge(focused);
		else if (data === "p") this.moveNote(focused);
		else if (data === "d") {
			if (!focused) return;
			this.confirm.ask(this.confirmPrompt(focused), () => this.forgetNote(focused));
			this.requestRender();
		} else if (data === "r") this.reload();
	}

	/** Wheel scrolling moves the selection, matching the other list screens. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.mode !== "list" || this.confirm.pending) return undefined;
		const notes = this.notes();
		const handled = scrollList(event, this.cursor, notes.length);
		if (handled) this.selectedKey = notes[this.cursor.selected] ? noteKey(notes[this.cursor.selected]) : undefined;
		return handled;
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	dispose(): void {
		this.editor.focused = false;
	}

	get focused(): boolean {
		return this.componentFocused;
	}

	set focused(value: boolean) {
		if (this.componentFocused === value) return;
		this.componentFocused = value;
		this.syncEditorFocus();
		this.requestRender();
	}

	private summary(width: number): string {
		const entries = this.callbacks.entries();
		const filter = this.effectiveFilter();
		let text = paint(this.theme, "accent", filter === "all" ? "All" : scopeLabel(filter));
		text += paint(this.theme, "meta", ` · ${entries.project.length} project, ${entries.global.length} global`);
		if (!this.callbacks.trusted()) text += paint(this.theme, "warn", " · project untrusted");
		return clip(`  ${text}`, width);
	}

	/** One note row: selection marker, scope tag, and the sanitized note text. */
	private noteRow(note: Note, selected: boolean, width: number): string {
		const tag = `${paint(this.theme, "meta", scopeLabel(note.scope))} ${paint(this.theme, "faint", "·")}`;
		const source = this.mergeSource;
		const marked = source !== undefined && noteKey(source) === noteKey(note);
		return listRow(this.theme, width, {
			selected,
			leading: marked ? `${tag} ${paint(this.theme, "warn", "merge")}` : tag,
			label: sanitizeLine(note.text),
			labelRole: selected ? "accent" : "label",
		});
	}

	private confirmPrompt(note: Note): string {
		const label = sanitizeLine(note.text);
		const clipped = label.length > 40 ? `${label.slice(0, 39)}…` : label;
		return `Forget ${scopeLabel(note.scope)} note "${clipped}"? y/N`;
	}

	private renderEditor(width: number): string[] {
		const verb = this.mode === "edit" ? "Edit" : this.mode === "merge" ? "Merge" : "Add";
		const scope = scopeLabel(this.editorScope);
		const pad = width > 1 ? " " : "";
		const summary =
			this.mode === "edit"
				? "Editing the focused note"
				: this.mode === "merge"
					? `Merging 2 ${scope} notes into one`
					: `New ${scope} note`;
		const body: string[] = [];
		for (const line of this.editor.render(Math.max(1, width - 2))) body.push(`${pad}${line}`);
		return dockListFrame({
			theme: this.theme,
			width,
			header: titleRule(this.theme, width, `Memory · ${verb} ${scope}`),
			summary: clip(`  ${paint(this.theme, "meta", summary)}`, width),
			body,
			hint: screenHint(this.theme, width, ["Enter save", "Esc cancel"]),
		});
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		this.syncEditorFocus();
		if (this.mode !== "list") return this.renderEditor(w);

		const notes = this.notes();
		this.cursor.visible = fitRows(this.viewportRowsSource, notes.length, CHROME, SCREEN_DEFAULT_ROWS);
		this.focusIndexNow(this.focusIndex(notes), notes);

		const body: string[] = [];
		if (notes.length === 0) {
			body.push(...emptyState(this.theme, w, { label: "No notes yet. Press a to add one." }));
		} else {
			const { start, end } = this.cursor.window(notes.length);
			for (let index = start; index < end; index++) {
				body.push(this.noteRow(notes[index], index === this.cursor.selected, w));
			}
		}

		const pending = this.confirm.pending;
		const hint = pending
			? clip(`  ${paint(this.theme, "warn", pending.prompt)}`, w)
			: this.notice !== undefined
				? clip(`  ${paint(this.theme, "meta", this.notice)}`, w)
				: this.mergeSource
					? screenHint(this.theme, w, ["m merge into the focused note", "Esc cancel merge", "↑/↓"])
					: screenHint(this.theme, w, [
							"Esc close",
							{ text: "Enter/e edit", color: "accent" },
							{ text: "a add", color: "accent" },
							{ text: "d forget", color: "warning" },
							"m merge",
							"p move",
							"s/Tab scope",
							"↑/↓",
							"g/G",
						]);

		return dockListFrame({
			theme: this.theme,
			width: w,
			header: titleRule(this.theme, w, "Memory"),
			summary: this.summary(w),
			body,
			range: this.cursor.clipped(notes.length)
				? formatRange(this.theme, w, { ...this.cursor.window(notes.length), total: notes.length })
				: undefined,
			hint,
		});
	}
}
