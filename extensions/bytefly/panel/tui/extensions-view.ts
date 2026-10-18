/**
 * The Extensions section: its summary line, one row per resolved extension, and
 * the detail pane for the focused row.
 *
 * Pure functions over the merged model — the component owns the cursor, the
 * filter, and the probe state, and passes them in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../../lib/format.ts";
import { clip } from "../../../../lib/tui/columns.ts";
import { checkbox, listRow } from "../../../../lib/tui/rows.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import { detailLines as reportDetailLines } from "../../doctor/format.ts";
import { rowBadge, summarySegments, type PanelScope } from "../format.ts";
import type { PanelModel, PanelRow } from "../types.ts";
import { countsLine, savedLine } from "./frame.ts";

/** The section's hits, its scope, and how many need attention. */
export function extensionSummary(
	theme: Theme,
	width: number,
	model: PanelModel,
	scope: PanelScope,
	filter: string | undefined,
): string {
	return countsLine(theme, width, summarySegments(model, scope, { filter, compact: width < 72 }));
}

/** One extension row: its checkbox, health glyph, name, and verdict. */
export function extensionRow(theme: Theme, width: number, row: PanelRow, selected: boolean): string {
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
	});
}

/** The focused extension's label, findings, and the pending-changes note. */
export function extensionDetail(
	theme: Theme,
	width: number,
	row: PanelRow | undefined,
	budget: number,
	expanded: boolean,
	dirty: boolean,
): string[] {
	const lines: string[] = [];
	const badge = row ? rowBadge(row) : undefined;
	if (row && badge?.text !== undefined) {
		const head = `${paint(theme, "meta", sanitizeLine(row.label))} ${paint(theme, "faint", "—")} ${paint(theme, badge.role, badge.text)}`;
		lines.push(clip(`  ${head}`, width));
	} else if (row?.item) {
		lines.push(clip(`  ${paint(theme, "meta", sanitizeLine(row.item.path))}`, width));
	}
	if (row?.report && budget > 0) {
		lines.push(...reportDetailLines(row.report, theme, width, budget, expanded));
	}
	lines.push(...savedLine(theme, width, dirty));
	return lines;
}

/** The section's key hints, in the order they drop as the width runs out. */
export function extensionHints(options: { expanded: boolean; refreshing: boolean; projectScope: boolean }): string[] {
	return [
		"Esc close",
		"←/→",
		"Space toggle",
		options.expanded ? "Enter collapse" : "Enter detail",
		"Tab scope",
		// Only Project scope can hold an override, so the key is not offered elsewhere.
		...(options.projectScope ? ["x inherit"] : []),
		options.refreshing ? "refreshing…" : "r refresh",
		"↑/↓ select",
	];
}
