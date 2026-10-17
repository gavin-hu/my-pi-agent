/**
 * Non-TUI text for the unified panel.
 *
 * Every mode other than `tui` gets the same facts the screen shows, as plain
 * text: a headline with the scope and the counts, then the picker's grouped
 * listing with a health suffix on each row. The Settings listing uses the same
 * headline and groups with `Label: Value` rows. A single named extension prints
 * its full findings instead. Nothing here touches the host, and every string
 * from a probe or a settings file is sanitized before it is printed.
 */

import { sanitizeLine } from "../../../lib/format.ts";
import type { TuiRole } from "../../../lib/tui/tokens.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { reportSeverity, reportSummary } from "../doctor/format.ts";
import { groupViews, type SettingView } from "./settings.ts";
import type { PanelModel, PanelRow, PanelSection } from "./types.ts";

/** The settings scope the screen shows. */
export type PanelScope = "global" | "project";

/** One segment of the headline, with its design role for the TUI. */
export interface SummarySegment {
	text: string;
	color: TuiRole;
}

/** Row and problem counts over a model. */
export interface PanelCounts {
	extensions: number;
	disabled: number;
	missing: number;
	degraded: number;
}

/** Options for the plain-text headline and listing. */
export interface PanelTextOptions {
	/** Abbreviate counts (`15 ext · 3 off`) for a narrow terminal. */
	compact?: boolean;
}

/** Options for the TUI headline, which can also name a narrowed extension. */
export interface SummaryOptions extends PanelTextOptions {
	/** Name the narrowed extension instead of counting the list. */
	filter?: string;
}

/** Count the rows and their problems, once per unique report. */
export function panelCounts(model: PanelModel): PanelCounts {
	let disabled = 0;
	let missing = 0;
	let degraded = 0;
	const seen = new Set<string>();
	for (const row of model.rows) {
		if (row.item && !row.item.enabled) disabled += 1;
		const report = row.report;
		if (!report || seen.has(report.extension)) continue;
		seen.add(report.extension);
		missing += report.findings.filter((finding) => finding.severity === "missing").length;
		degraded += report.findings.filter((finding) => finding.severity === "degraded").length;
	}
	return { extensions: model.rows.length, disabled, missing, degraded };
}

/**
 * The headline segments, e.g. `Global · 15 extensions · 3 disabled · 1 missing`.
 * A narrowed model names the extension instead of counting.
 */
export function summarySegments(model: PanelModel, scope: PanelScope, options: SummaryOptions = {}): SummarySegment[] {
	const counts = panelCounts(model);
	const segments: SummarySegment[] = [{ text: scope === "global" ? "Global" : "Project", color: "accent" }];
	if (options.filter !== undefined) {
		segments.push({ text: `${options.filter} only`, color: "meta" });
	} else {
		const noun = options.compact ? "ext" : counts.extensions === 1 ? "extension" : "extensions";
		segments.push({ text: `${counts.extensions} ${noun}`, color: "meta" });
		if (counts.disabled > 0) {
			segments.push({ text: `${counts.disabled} ${options.compact ? "off" : "disabled"}`, color: "meta" });
		}
	}
	const problems: string[] = [];
	if (counts.missing > 0) problems.push(`${counts.missing} missing`);
	if (counts.degraded > 0) problems.push(`${counts.degraded} degraded`);
	if (problems.length > 0) {
		segments.push({ text: problems.join(", "), color: counts.missing > 0 ? "bad" : "warn" });
	}
	return segments;
}

/**
 * The section bar's two segments, in screen order. The active section takes the
 * accent and the other recedes, so the bar reads as a two-way switch.
 */
export function sectionSegments(active: PanelSection): SummarySegment[] {
	return [
		{ text: "Extensions", color: active === "extensions" ? "accent" : "faint" },
		{ text: "Settings", color: active === "settings" ? "accent" : "faint" },
	];
}

/** The Settings section's counts: the scope and how many rows it shows. */
export function settingsSummarySegments(scope: PanelScope, count: number): SummarySegment[] {
	return [
		{ text: scope === "global" ? "Global" : "Project", color: "accent" },
		{ text: `${count} ${count === 1 ? "setting" : "settings"}`, color: "meta" },
	];
}

/** The Settings headline for non-TUI modes, e.g. `bytefly: Settings · Global · 5 settings`. */
export function formatSettingsHeadline(scope: PanelScope, count: number): string {
	return `bytefly: Settings · ${settingsSummarySegments(scope, count)
		.map((segment) => segment.text)
		.join(" · ")}`;
}

/**
 * The grouped Settings listing for non-TUI modes. The project form names the
 * missing app rows rather than leaving their absence unexplained.
 */
export function formatSettingsListing(views: readonly SettingView[], scope: PanelScope): string {
	const lines = [formatSettingsHeadline(scope, views.length)];
	if (scope === "project") lines.push("", "  App settings are Global only.");
	if (views.length === 0) {
		lines.push("", "No settings found.");
		return lines.join("\n");
	}
	for (const group of groupViews(views)) {
		lines.push("", `${group.label} (${group.views.length})`);
		for (const view of group.views) {
			lines.push(`  ${sanitizeLine(view.label)}: ${sanitizeLine(view.valueLabel)}`);
		}
	}
	return lines.join("\n");
}

/** The headline as one plain line, e.g. `bytefly: Global · 15 extensions · 1 missing`. */
export function formatHeadline(model: PanelModel, scope: PanelScope, options: PanelTextOptions = {}): string {
	return `bytefly: ${summarySegments(model, scope, options)
		.map((segment) => segment.text)
		.join(" · ")}`;
}

/** Plain severity glyph for a row, or `undefined` when it has no report. */
function rowGlyph(row: PanelRow): string | undefined {
	if (!row.report) return undefined;
	switch (reportSeverity(row.report)) {
		case "missing":
			return GLYPHS.cross;
		case "degraded":
			return GLYPHS.warn;
		case "info":
			return GLYPHS.disabled;
		default:
			return GLYPHS.check;
	}
}

/** One listing row: `[x] ✓ label — summary`, with the suffix only when reported. */
export function formatRow(row: PanelRow): string {
	const glyph = rowGlyph(row);
	const summary = row.report ? ` — ${reportSummary(row.report)}` : "";
	if (!row.item) {
		// Reported-only: there is no enable pattern to show, so no checkbox column.
		return `  ${glyph ? `${glyph} ` : ""}${row.label}${summary}`;
	}
	const checkbox = row.item.enabled ? "[x]" : "[ ]";
	return `  ${checkbox} ${glyph ? `${glyph} ` : ""}${row.label}${summary}`;
}

/** The grouped text listing, headline first, for RPC/JSON/print modes. */
export function formatListing(model: PanelModel, scope: PanelScope, options: PanelTextOptions = {}): string {
	const lines = [formatHeadline(model, scope, options)];
	if (model.rows.length === 0) {
		lines.push("", "No extensions found.");
		return lines.join("\n");
	}
	for (const group of model.groups) {
		lines.push("", `${group.label} (${group.count})`);
		for (const row of model.rows) {
			if (row.group === group.key) lines.push(formatRow(row));
		}
	}
	return lines.join("\n");
}
