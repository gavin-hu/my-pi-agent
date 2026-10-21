/**
 * The path checklist a partial rewind opens: every changed path, grouped by
 * directory, each one togglable.
 *
 * The screen is the timeline's sibling — same dock frame, same cursor, same
 * width-safe row grammar — so a partial restore reads as one more step in
 * `/rewind` rather than a second product. Rows are selected by default, which
 * makes `Enter` here reproduce the whole-tree restore exactly. The frame, the
 * cursor, and the toggle keys come from {@link ChecklistScreen}.
 *
 * The component owns only the selection: paths in, a chosen subset out through
 * `onClose`, and the restore itself stays behind the confirmation that follows.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import { screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { checkbox, listRow } from "../../lib/tui/rows.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { ChecklistScreen } from "./checklist.ts";
import { baseName, expandGroup, groupPaths, SELECTION_MARKS, type ChangedPath, type PathGroup } from "./paths.ts";

export interface PathPickerOptions {
	/** The changed paths the snapshot differs on. */
	paths: readonly ChangedPath[];
	theme: Theme;
	/** Called once when the screen closes: the selected paths, or undefined when cancelled. */
	onClose: (paths?: string[]) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** One rendered row: a directory header or a file under one. */
type Row = { kind: "group"; group: PathGroup } | { kind: "file"; path: ChangedPath; dir: string };

/** The checklist of changed paths. */
export class PathPickerComponent extends ChecklistScreen<Row> {
	private readonly view: PathPickerOptions;
	private readonly groups: PathGroup[];
	private readonly flat: readonly Row[];

	constructor(view: PathPickerOptions) {
		super({
			title: "Restore paths",
			theme: view.theme,
			requestRender: view.requestRender,
			viewportRows: view.viewportRows,
		});
		this.view = view;
		this.groups = groupPaths(view.paths);
		this.flat = this.groups.flatMap((group): Row[] => [
			{ kind: "group", group },
			...group.paths.map((path): Row => ({ kind: "file", path, dir: group.dir })),
		]);
	}

	protected rows(): readonly Row[] {
		return this.flat;
	}

	/** A group header's key is never selected: it toggles its files instead. */
	protected keyOf(row: Row): string {
		return row.kind === "group" ? row.group.dir : row.path.path;
	}

	/**
	 * Every path starts selected, so confirming without touching anything means
	 * "restore it all" — the behavior `/rewind` had before the checklist existed.
	 */
	protected initialSelection(): readonly string[] {
		return this.groups.flatMap(expandGroup);
	}

	protected selectableKeys(): readonly string[] {
		return this.view.paths.map((path) => path.path);
	}

	protected onEnter(selection: string[]): void {
		this.view.onClose(selection);
	}

	protected onCancel(): void {
		this.view.onClose(undefined);
	}

	/** Space on a directory header toggles every file under it. */
	protected override toggle(row: Row): void {
		if (row.kind === "file") {
			super.toggle(row);
			return;
		}
		const on = !this.groupOn(row.group);
		for (const path of expandGroup(row.group)) {
			if (on) this.chosen.add(path);
			else this.chosen.delete(path);
		}
	}

	/** Whether every file under `group` is selected. */
	private groupOn(group: PathGroup): boolean {
		return group.paths.every((path) => this.chosen.has(path.path));
	}

	/** One row: a directory header with its count, or a file with its change mark. */
	protected rowLine(row: Row, width: number, selected: boolean): string {
		const tone = selected ? "accent" : row.kind === "group" ? "meta" : "label";
		if (row.kind === "group") {
			const count = row.group.paths.length;
			return listRow(this.theme, width, {
				selected,
				leading: checkbox(this.theme, this.groupOn(row.group)),
				label: `${row.group.dir === "" ? "./" : `${row.group.dir}/`}`,
				labelRole: tone,
				trailing: `${count} file${count === 1 ? "" : "s"}`,
				trailingRole: "meta",
			});
		}
		return listRow(this.theme, width, {
			selected,
			indent: 2,
			// The header already carries the directory's checkbox, so the file rows
			// keep the column with a blank rather than repeating it.
			leading: " ",
			label: baseName(row.path.path),
			labelRole: tone,
			trailing: SELECTION_MARKS[row.path.change],
			trailingRole: row.path.change === "added" ? "warn" : "meta",
		});
	}

	protected summaryText(): string {
		const total = this.view.paths.length;
		return `${this.chosen.size} of ${total} selected${SEPARATORS.item}Space toggles a file or a directory`;
	}

	/** What the focused row will do, in words. */
	protected detailLines(width: number): string[] {
		const row = this.focusedRow;
		if (!row) return [];
		const text =
			row.kind === "group"
				? `Space selects or clears all ${row.group.paths.length} file${row.group.paths.length === 1 ? "" : "s"} in this directory.`
				: row.path.change === "added"
					? "A — created after the snapshot; restoring removes it."
					: row.path.change === "deleted"
						? "D — deleted since the snapshot; restoring brings it back."
						: row.path.change === "renamed"
							? `R — renamed from ${sanitizeLine(row.path.from)}; restoring brings the old path back and removes this one.`
							: "M — modified since the snapshot; restoring rewrites it.";
		return [clip(`  ${paint(this.theme, "meta", text)}`, width)];
	}

	/** The key-hint row, with the primary action in the accent role. */
	protected hint(width: number): string {
		return screenHint(this.theme, width, [
			"Esc cancel",
			{ text: "Enter restore", color: "accent" },
			"Space toggle",
			"a all",
			"n none",
		]);
	}
}
