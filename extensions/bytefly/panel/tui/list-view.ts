/**
 * The grouped list sections' shared pieces: the headline counts and one row.
 *
 * Extensions and Skills draw the same row grammar — a checkbox, a verdict, and
 * the resource's name — so the row and the summary live here and each section
 * supplies only what it can say about the focused row.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../../lib/format.ts";
import { checkbox, listRow } from "../../../../lib/tui/rows.ts";
import { rowBadge, type PanelScope, summarySegments, type SummaryOptions } from "../format.ts";
import type { PanelModel, PanelRow } from "../types.ts";
import { countsLine } from "./frame.ts";

/** The section's headline: the scope, the row count, and what is off. */
export function resourceSummary(
	theme: Theme,
	width: number,
	model: PanelModel,
	scope: PanelScope,
	options: SummaryOptions = {},
): string {
	return countsLine(theme, width, summarySegments(model, scope, { ...options, compact: width < 72 }));
}

/** One resource row: its checkbox, verdict, and name. */
export function resourceRow(theme: Theme, width: number, row: PanelRow, selected: boolean): string {
	const badge = rowBadge(row);
	return listRow(theme, width, {
		selected,
		// A reported-only row has no enable pattern, but still reserves the box
		// column so the list stays aligned.
		leading: row.item ? checkbox(theme, row.item.enabled) : " ",
		glyph: badge.glyph ?? " ",
		glyphRole: badge.role,
		label: sanitizeLine(row.label),
		labelRole: selected ? "accent" : row.item && !row.item.enabled ? "faint" : "label",
		trailing: badge.text,
		// The glyph carries the status colour; the word stays quiet unless it is a
		// problem, so a clean row does not shout.
		trailingRole: badge.role === "bad" || badge.role === "warn" ? badge.role : "faint",
		// The verdict sits beside the name instead of at the far edge of a wide
		// terminal, where a two-word verdict would be unreadable.
		align: "inline",
	});
}
