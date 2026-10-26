/**
 * The two filters the screen offers: a text query, and a switch that keeps only
 * the rows worth acting on.
 *
 * A filter is part of the model build, not a post-pass over a rendered list, so a
 * group's count and the range row stay truthful about what is on screen. The chips
 * the tab row prints come from the same object, so the screen cannot say it is
 * filtered without saying by what.
 *
 * Value-only: pure predicates over rows and views.
 */

import type { SummarySegment } from "./format.ts";
import { rowBadge } from "./format.ts";
import type { PanelRow } from "./types.ts";
import type { SettingView } from "./settings.ts";

/** What the reader narrowed the list to. */
export interface PanelFilter {
	/** Case-insensitive text matched against a row's name, path and source. */
	query: string;
	/** Keep only rows that need attention (settings: values changed from default). */
	attentionOnly: boolean;
}

/** The unfiltered state. */
export const NO_FILTER: PanelFilter = { query: "", attentionOnly: false };

/** Whether anything is narrowed, so the chrome can say so. */
export function isFiltering(filter: PanelFilter): boolean {
	return filter.query.trim() !== "" || filter.attentionOnly;
}

/** Whether the row's own text mentions `query`. */
function mentions(text: readonly (string | undefined)[], query: string): boolean {
	const needle = query.toLowerCase();
	return text.some((value) => value !== undefined && value.toLowerCase().includes(needle));
}

/**
 * Whether a resource row survives the filter. The query reaches the picker's path
 * and source as well as the name, because "which file is this" is the question a
 * reader asks of a row they cannot place.
 */
export function rowMatches(row: PanelRow, filter: PanelFilter): boolean {
	if (filter.attentionOnly && rowBadge(row).glyph === undefined) return false;
	if (!mentions([row.label, row.key, row.item?.path, row.report?.extension, row.skill?.description], filter.query)) {
		return false;
	}
	return true;
}

/** Whether a settings row survives the filter; "changed" means not at its default. */
export function settingMatches(view: SettingView, filter: PanelFilter): boolean {
	if (filter.attentionOnly && view.origin === "default") return false;
	return mentions([view.label, view.id, view.description, view.valueLabel], filter.query);
}

/** The chips the tab row shows while a filter is on. */
export function filterChips(filter: PanelFilter, kind: "rows" | "settings"): SummarySegment[] {
	const chips: SummarySegment[] = [];
	const query = filter.query.trim();
	if (query !== "") chips.push({ text: `/${query}`, color: "meta" });
	if (filter.attentionOnly) {
		chips.push({ text: kind === "settings" ? "changed only" : "needs attention", color: "warn" });
	}
	return chips;
}
