/**
 * The Skills section: the focused skill's path and description, and the
 * section's key hints.
 *
 * Rows and the summary come from the shared list view, and the row verdict is
 * already `rowBadge`'s. The pane therefore starts with what the row cannot say:
 * the resolved file and what its frontmatter declares, or why Pi refused it.
 * Pure functions over the merged row; the component owns the cursor, the scope,
 * and the expansion.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ScreenHint } from "../../../../lib/tui/chrome.ts";
import { sanitizeLine } from "../../../../lib/format.ts";
import { clip } from "../../../../lib/tui/columns.ts";
import { BODY_INDENT } from "../../../../lib/tui/indent.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import type { PanelRow } from "../types.ts";
import { INDENT, savedLine } from "./frame.ts";

/** The focused skill's file, description (or refusal), and pending changes. */
export function skillDetail(options: {
	theme: Theme;
	width: number;
	row: PanelRow | undefined;
	budget: number;
	expanded: boolean;
	dirty: boolean;
}): string[] {
	const { theme, width, row, budget, expanded, dirty } = options;
	// The focused row above already carries the name and verdict, so the pane
	// starts with the file it resolves to.
	const lines: string[] = [];
	if (row?.item) lines.push(clip(`${INDENT}${paint(theme, "meta", sanitizeLine(row.item.path))}`, width));
	const saved = savedLine(theme, width, dirty);
	const skill = row?.skill;
	const text = skill?.problem !== undefined ? `Not loaded: ${skill.problem}` : skill?.description;
	if (text && budget > 1) {
		// One line while collapsed, the whole wrapped description when expanded,
		// minus the file line already pushed and the saved marker below it.
		const available = Math.max(0, budget - lines.length - saved.length);
		const room = expanded ? available : Math.min(1, available);
		const bodyWidth = Math.max(1, width - BODY_INDENT);
		const role = skill?.problem !== undefined ? "warn" : "meta";
		for (const line of wrapTextWithAnsi(sanitizeLine(text), bodyWidth).slice(0, room)) {
			lines.push(clip(`${INDENT}${paint(theme, role, line)}`, width));
		}
	}
	lines.push(...saved);
	return lines;
}

/** The section's key hints, in the order they drop as the width runs out. */
export function skillHints(options: { expanded: boolean; projectScope: boolean }): ScreenHint[] {
	return [
		"Esc close",
		"←/→",
		{ text: "Space toggle", color: "accent" },
		{ text: options.expanded ? "Enter collapse" : "Enter detail", color: "accent" },
		"Tab scope",
		// Only Project scope can hold an override, so the key is not offered elsewhere.
		...(options.projectScope ? ["x inherit"] : []),
		"↑/↓ select",
	];
}
