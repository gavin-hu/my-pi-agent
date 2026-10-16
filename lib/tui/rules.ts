/**
 * The rule grammar: how a surface draws a horizontal divider.
 *
 * Two shapes, built from one idea — a run of a single-column glyph, with an
 * optional label — so a screen title and a centered rule read as one family:
 *
 *   title     Extensions ──────────────────   (label first, accent)
 *   centered       ╌╌╌╌╌╌ turn 3 ╌╌╌╌╌╌       (label centered)
 *
 * A rule degrades to a plain fill rather than truncating a label into an
 * ellipsis, matching Pi's built-in header.
 *
 * Value-only: pure functions, theme passed in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { paint, type TuiRole } from "./tokens.ts";

/** The glyph and colors a rule is drawn with. */
export interface RuleStyle {
	/** Single-column fill glyph. Default `─` (a centered rule defaults to `─` too). */
	glyph?: string;
	/** The label's role. */
	labelRole?: TuiRole;
	/** The fill's role. */
	fillRole?: TuiRole;
}

/** A centered rule's style adds the padding around the label. */
export interface CenteredRuleStyle extends RuleStyle {
	/** Spaces on each side of the label. Default 1. */
	pad?: number;
}

/** A usable origin: terminal arithmetic starts from one column, never zero. */
function widthOf(width: number): number {
	return Math.max(1, Math.floor(width));
}

/** A full-width divider in one color. */
export function plainRule(theme: Theme, width: number, style: RuleStyle = {}): string {
	const w = widthOf(width);
	return paint(theme, style.fillRole ?? "rule", (style.glyph ?? "─").repeat(w));
}

/** The label-first shape a screen or panel title uses. */
export function titleRule(theme: Theme, width: number, label: string, style: RuleStyle = {}): string {
	return labelRule(theme, width, label, "title", "rule", style);
}

/** A label-first rule: the label at the margin, a fill to the edge. */
function labelRule(
	theme: Theme,
	width: number,
	label: string,
	labelRole: TuiRole,
	fillRole: TuiRole,
	style: RuleStyle,
): string {
	const w = widthOf(width);
	const text = label.trim();
	if (!text) return plainRule(theme, w, style);
	const labelWidth = visibleWidth(text);
	if (labelWidth + 1 >= w) return plainRule(theme, w, style);
	const fill = (style.glyph ?? "─").repeat(w - labelWidth - 1);
	return paint(theme, style.labelRole ?? labelRole, text) + " " + paint(theme, style.fillRole ?? fillRole, fill);
}

/** A centered rule: fill, label, and the rest of the fill. */
export function centeredRule(theme: Theme, width: number, label: string, style: CenteredRuleStyle = {}): string {
	const w = widthOf(width);
	const glyph = style.glyph ?? "─";
	const fillRole = style.fillRole ?? "ruleStrong";
	if (!label.trim()) return paint(theme, fillRole, glyph.repeat(w));
	const pad = " ".repeat(Math.max(0, Math.floor(style.pad ?? 1)));
	const text = `${pad}${label}${pad}`;
	const labelWidth = visibleWidth(text);
	if (labelWidth >= w) return paint(theme, fillRole, glyph.repeat(w));
	const remaining = w - labelWidth;
	const left = Math.floor(remaining / 2);
	const right = remaining - left;
	return (
		paint(theme, fillRole, glyph.repeat(left)) +
		paint(theme, style.labelRole ?? "meta", text) +
		paint(theme, fillRole, glyph.repeat(right))
	);
}
