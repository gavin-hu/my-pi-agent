/**
 * The Extensions section's focused-row pane.
 *
 * The row, the summary, and the key hints are the shared list grammar; what is
 * specific here is the doctor's findings, including the resource path when a row
 * has no verdict.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
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
