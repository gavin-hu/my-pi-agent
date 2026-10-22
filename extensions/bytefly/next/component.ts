/**
 * The next-steps aside: a label at the margin and wrapped rows behind the rail.
 *
 * Drawn below the turn rule, so it shares the grammar of every other block under
 * that rule — the notice's `source · title` headline, the transcript rail, and a
 * glyph-led row. Three decisions are visible here:
 *
 * - No numbers. The model writes `1.`/`2.`/`3.`, but a numbered row in a terminal
 *   reads as a key to press, and nothing handles one; the marker is `›` instead,
 *   so the rows read as options rather than as a menu.
 * - No count in the headline. The rows say how many there are.
 * - Rows wrap with a hanging indent rather than clipping. A clipped action
 *   ("Recapture assets/chrome.p…") cannot be acted on, and the instruction asks
 *   for one line per item precisely so wrapping stays rare.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { BODY_INDENT, indentBlockLines } from "../../../lib/tui/indent.ts";
import { RenderCache } from "../../../lib/tui/render-cache.ts";
import { paint, type TuiRole } from "../../../lib/tui/tokens.ts";
import { DEFAULT_RAIL_GLYPH, RAIL_ROLES, railGlyph } from "../chrome.ts";
import type { NextStepsData } from "./types.ts";

/** The headline label, matching the marker the model writes. */
export const NEXT_STEPS_LABEL = "Next";

/** Design roles for the three parts of a row. */
const LABEL_ROLE: TuiRole = "accent";
const MARKER_ROLE: TuiRole = "meta";
const ITEM_ROLE: TuiRole = "label";

/** Columns between the row marker and its text. */
const MARKER_GAP = 1;

/** Greedy word wrap of one plain line; a word wider than the row is clipped. */
function wrapPlain(text: string, width: number): string[] {
	const w = Math.max(1, width);
	if (visibleWidth(text) <= w) return [text];
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		const candidate = line === "" ? word : `${line} ${word}`;
		if (visibleWidth(candidate) <= w) {
			line = candidate;
			continue;
		}
		if (line !== "") lines.push(line);
		line = visibleWidth(word) > w ? truncateToWidth(word, w, "…") : word;
	}
	if (line !== "") lines.push(line);
	return lines;
}

/**
 * The aside for one entry: the label, then one wrapped row per item. `pad` is the
 * transcript's own left margin, and `glyph` the configured rail, so the block
 * lines up with the notices and tool blocks around it.
 */
export function nextStepsLines(
	items: readonly string[],
	theme: Theme,
	width: number,
	glyph = DEFAULT_RAIL_GLYPH,
	pad = 0,
): string[] {
	const w = Math.max(1, width);
	const indent = Math.max(0, Math.floor(pad)) + BODY_INDENT;
	const marker = `${paint(theme, MARKER_ROLE, GLYPHS.next)}${" ".repeat(MARKER_GAP)}`;
	const markerWidth = visibleWidth(GLYPHS.next) + MARKER_GAP;
	const textWidth = Math.max(1, w - indent - markerWidth);

	const rows: string[] = [];
	for (const item of items) {
		const [first = "", ...rest] = wrapPlain(item, textWidth);
		rows.push(`${marker}${paint(theme, ITEM_ROLE, first)}`);
		for (const line of rest) rows.push(`${" ".repeat(markerWidth)}${paint(theme, ITEM_ROLE, line)}`);
	}

	return indentBlockLines([paint(theme, LABEL_ROLE, NEXT_STEPS_LABEL), ...rows], w, {
		indent,
		rail: railGlyph(theme, RAIL_ROLES.info, glyph),
		headline: true,
		trimTrailing: false,
	});
}

/**
 * The block Pi mounts for a `bytefly-next-steps` entry.
 *
 * An entry renderer runs per frame, and the lines are a pure function of the
 * stored items, so they are memoized on the width with `RenderCache`; a theme
 * change rebuilds the component and `invalidate` drops the memo in case it does
 * not.
 */
export class NextStepsComponent implements Component {
	private readonly cache = new RenderCache();

	constructor(
		private readonly data: NextStepsData,
		private readonly theme: Theme,
		private readonly pad = 0,
		private readonly glyph = DEFAULT_RAIL_GLYPH,
	) {}

	invalidate(): void {
		this.cache.invalidate();
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.cache.lines(w, undefined, () => nextStepsLines(this.data.items, this.theme, w, this.glyph, this.pad));
	}
}
