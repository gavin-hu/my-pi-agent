/**
 * The hunk checklist `/review` opens from a modified file's diff.
 *
 * One row per textual hunk, all selected by default, so `Enter` twice reproduces
 * the whole-file revert. The screen owns only the selection: hunks in, chosen
 * indices out through `onClose`, and the reverse apply stays behind the
 * confirmation that follows. The frame, the cursor, and the toggle keys come
 * from {@link ChecklistScreen}.
 *
 * Pure UI: no git, no filesystem.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import { screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { checkbox, listRow } from "../../lib/tui/rows.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { ChecklistScreen } from "./checklist.ts";
import { formatReviewEntryCounts } from "./format.ts";
import type { Hunk } from "./patch.ts";

export interface HunkPickerOptions {
	/** The file the hunks belong to. */
	path: string;
	hunks: readonly Hunk[];
	theme: Theme;
	/** Called once when the screen closes: chosen hunk indices, or undefined when cancelled. */
	onClose: (selection?: number[]) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** One rendered row: a hunk and the index the screen returns. */
interface HunkRow {
	index: number;
	hunk: Hunk;
}

/** The first removed and first added line, for the focused hunk's detail. */
function previewOf(hunk: Hunk): string[] {
	const removed = hunk.lines.find((line) => line.startsWith("-"));
	const added = hunk.lines.find((line) => line.startsWith("+"));
	return [removed, added].filter((line): line is string => line !== undefined).slice(0, 2);
}

/** The checklist of a file's hunks. */
export class HunkPickerComponent extends ChecklistScreen<HunkRow> {
	private readonly hunkRows: readonly HunkRow[];

	constructor(private readonly view: HunkPickerOptions) {
		super({
			title: "Revert hunks",
			theme: view.theme,
			requestRender: view.requestRender,
			viewportRows: view.viewportRows,
			emptyLabel: "No hunks to select.",
		});
		this.hunkRows = view.hunks.map((hunk, index) => ({ index, hunk }));
	}

	protected rows(): readonly HunkRow[] {
		return this.hunkRows;
	}

	protected keyOf(row: HunkRow): string {
		return String(row.index);
	}

	protected onEnter(selection: string[]): void {
		this.view.onClose(selection.map(Number).sort((a, b) => a - b));
	}

	protected onCancel(): void {
		this.view.onClose(undefined);
	}

	protected rowLine(row: HunkRow, width: number, selected: boolean): string {
		return listRow(this.theme, width, {
			selected,
			leading: checkbox(this.theme, this.chosen.has(String(row.index))),
			label: sanitizeLine(row.hunk.header),
			labelRole: selected ? "accent" : "label",
			trailing: formatReviewEntryCounts(row.hunk),
			trailingRole: "meta",
		});
	}

	protected summaryText(): string {
		const selected = `${this.chosen.size} of ${this.view.hunks.length} hunks selected`;
		return `${selected}${SEPARATORS.item}${sanitizeLine(this.view.path)}`;
	}

	/** The focused hunk's first removed and added line. */
	protected detailLines(width: number): string[] {
		const focused = this.focusedRow;
		if (!focused) return [];
		return previewOf(focused.hunk).map((line) => {
			const role = line.startsWith("+") ? "ok" : line.startsWith("-") ? "bad" : "meta";
			return clip(`  ${paint(this.theme, role, sanitizeLine(line))}`, width);
		});
	}

	protected hint(width: number): string {
		return screenHint(this.theme, width, [
			"Esc cancel",
			{ text: "Enter revert", color: "accent" },
			"Space toggle",
			"a all",
			"n none",
		]);
	}
}
