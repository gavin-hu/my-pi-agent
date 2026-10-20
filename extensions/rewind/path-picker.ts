/**
 * The path checklist a partial rewind opens: every changed path, grouped by
 * directory, each one togglable.
 *
 * The screen is the timeline's sibling — same dock frame, same cursor, same
 * width-safe row grammar — so a partial restore reads as one more step in
 * `/rewind` rather than a second product. Rows are selected by default, which
 * makes `Enter` here reproduce the whole-tree restore exactly.
 *
 * The component owns only the selection: paths in, a chosen subset out through
 * `onClose`, and the restore itself stays behind the confirmation that follows.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { fitRows, formatRange, isCloseKey, ListCursor, navigateList, scrollList } from "../../lib/tui/cursor.ts";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { checkbox, listRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
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

/** Rows the screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;
/** Header, summary, blanks, and footer rows around the list. */
const SCREEN_CHROME_ROWS = 6;

/** One rendered row: a directory header or a file under one. */
type Row = { kind: "group"; group: PathGroup } | { kind: "file"; path: ChangedPath; dir: string };

/** The checklist of changed paths. */
export class PathPickerComponent implements Component {
	private readonly cursor: ListCursor;
	private readonly groups: PathGroup[];
	private readonly rows: Row[];
	private readonly chosen = new Set<string>();

	constructor(private readonly options: PathPickerOptions) {
		this.cursor = new ListCursor(options.requestRender);
		this.groups = groupPaths(options.paths);
		// Every path starts selected, so confirming without touching anything means
		// "restore it all" — the behavior `/rewind` had before the checklist existed.
		for (const group of this.groups) for (const path of expandGroup(group)) this.chosen.add(path);
		this.rows = this.groups.flatMap((group): Row[] => [
			{ kind: "group", group },
			...group.paths.map((path): Row => ({ kind: "file", path, dir: group.dir })),
		]);
	}

	/** Whether every file under `group` is selected. */
	private groupOn(group: PathGroup): boolean {
		return group.paths.every((path) => this.chosen.has(path.path));
	}

	/** Toggle every file under `group` to `on`. */
	private setGroup(group: PathGroup, on: boolean): void {
		for (const path of expandGroup(group)) {
			if (on) this.chosen.add(path);
			else this.chosen.delete(path);
		}
	}

	/** Apply a key press. Exposed for the tests that drive the screen directly. */
	handleInput(data: string): void {
		if (isCloseKey(data)) {
			this.options.onClose(undefined);
			return;
		}
		if (navigateList(data, this.cursor, this.rows.length)) return;
		if (data === " ") {
			const row = this.rows[this.cursor.selected];
			if (row?.kind === "group") this.setGroup(row.group, !this.groupOn(row.group));
			else if (row) {
				if (this.chosen.has(row.path.path)) this.chosen.delete(row.path.path);
				else this.chosen.add(row.path.path);
			}
			this.options.requestRender();
			return;
		}
		if (data === "a") {
			for (const path of this.options.paths) this.chosen.add(path.path);
			this.options.requestRender();
			return;
		}
		if (data === "n") {
			this.chosen.clear();
			this.options.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) this.options.onClose([...this.chosen]);
	}

	/** Wheel scrolling in fullscreen moves the cursor; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return scrollList(event, this.cursor, this.rows.length);
	}

	dispose(): void {}

	invalidate(): void {}

	// The shared dock frame, like every other list screen.
	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "Restore paths");
		const cursor = this.cursor;
		cursor.visible = fitRows(this.options.viewportRows, this.rows.length, SCREEN_CHROME_ROWS, SCREEN_DEFAULT_ITEMS);
		const { start, end } = cursor.window(this.rows.length);

		const body: string[] = [];
		for (let i = start; i < end; i++) body.push(this.rowLine(w, this.rows[i], i === cursor.selected));

		const total = this.options.paths.length;
		const selected = this.chosen.size;
		return dockListFrame({
			header,
			summary: clip(
				`  ${paint(this.theme, "meta", `${selected} of ${total} selected${SEPARATORS.item}Space toggles a file or a directory`)}`,
				w,
			),
			body,
			range: cursor.clipped(this.rows.length)
				? formatRange(this.theme, w, { start, end, total: this.rows.length })
				: undefined,
			detail: this.detail(w),
			hint: this.hint(w),
		});
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	/** One row: a directory header with its count, or a file with its change mark. */
	private rowLine(width: number, row: Row, selected: boolean): string {
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

	/** What the focused row will do, in words. */
	private detail(width: number): string[] | undefined {
		const row = this.rows[this.cursor.selected];
		if (!row) return undefined;
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
	private hint(width: number): string {
		return screenHint(this.theme, width, [
			"Esc cancel",
			{ text: "Enter restore", color: "accent" },
			"Space toggle",
			"a all",
			"n none",
		]);
	}
}
