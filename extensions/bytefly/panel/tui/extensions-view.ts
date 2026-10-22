/**
 * The Extensions section's focused-row pane and key hints.
 *
 * The row and the summary are the shared list grammar; what is specific here is
 * the doctor's findings, including the resource path when a row has no verdict,
 * and the probe state in the hint row.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ScreenHint } from "../../../../lib/tui/chrome.ts";
import { sanitizeLine } from "../../../../lib/format.ts";
import { clip } from "../../../../lib/tui/columns.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import { detailLines as reportDetailLines } from "../../doctor/format.ts";
import { rowBadge } from "../format.ts";
import type { PanelRow } from "../types.ts";
import { savedLine } from "./frame.ts";

/** The focused extension's findings and the pending-changes note. */
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
	// The focused row directly above already carries the entry's name and verdict,
	// so the pane starts with what the row cannot say: the findings, or the
	// resource path when nothing was reported.
	if (badge?.text === undefined && row?.item) {
		lines.push(clip(`  ${paint(theme, "meta", sanitizeLine(row.item.path))}`, width));
	}
	if (row?.report && budget > 0) {
		lines.push(...reportDetailLines(row.report, theme, width, budget, expanded));
	}
	lines.push(...savedLine(theme, width, dirty));
	return lines;
}

/** The section's key hints, in the order they drop as the width runs out. */
export function extensionHints(options: {
	expanded: boolean;
	refreshing: boolean;
	projectScope: boolean;
}): ScreenHint[] {
	return [
		"Esc close",
		"←/→",
		{ text: "Space toggle", color: "accent" },
		{ text: options.expanded ? "Enter collapse" : "Enter detail", color: "accent" },
		"Tab scope",
		// Only Project scope can hold an override, so the key is not offered elsewhere.
		...(options.projectScope ? ["x inherit"] : []),
		options.refreshing ? "refreshing…" : "r refresh",
		"↑/↓ select",
	];
}
