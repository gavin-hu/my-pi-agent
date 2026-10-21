/**
 * Non-TUI text for the unified panel.
 *
 * Every mode other than `tui` gets the same facts the screen shows, as plain
 * text: a headline with the scope and the counts, then the picker's grouped
 * listing with a health suffix on each row. The Settings listing uses the same
 * headline and groups with `Label: Value` rows. A single named extension prints
 * its full findings instead. Nothing here touches the host, and every string
 * from a probe or a settings file is sanitized before it is printed.
 *
 * A row has two enablement axes: the picker's settings (`◼`/`◻`) and this
 * session's `PI_DISABLED_EXTENSIONS`. `rowBadge` is the one place that decides
 * how they read, so the screen, the text listing, and the counts cannot
 * contradict each other.
 */

import { sanitizeLine } from "../../../lib/format.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { TuiRole } from "../../../lib/tui/tokens.ts";
import { reportSeverity, reportSummary, severityGlyphChar, severityRole } from "../doctor/format.ts";
import type { SettingView } from "./settings.ts";
import type { PanelModel, PanelRow, PanelSection } from "./types.ts";

/** The settings scope the screen shows. */
export type PanelScope = "global" | "project";

/** One segment of the headline, with its design role for the TUI. */
export interface SummarySegment {
	text: string;
	color: TuiRole;
}

/** Row and problem counts over a model. */
interface PanelCounts {
	extensions: number;
	/** Rows switched off in settings (the picker's checkbox), not the env flag. */
	off: number;
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

/**
 * Count the rows and their problems, once per unique report. An extension that
 * is off in settings will not load, so its prerequisites are not counted as
 * problems — the row was already counted as `off`.
 */
export function panelCounts(model: PanelModel): PanelCounts {
	let off = 0;
	let missing = 0;
	let degraded = 0;
	const seen = new Set<string>();
	for (const row of model.rows) {
		if (row.item && !row.item.enabled) {
			off += 1;
			continue;
		}
		const report = row.report;
		if (!report || seen.has(report.extension)) continue;
		seen.add(report.extension);
		missing += report.findings.filter((finding) => finding.severity === "missing").length;
		degraded += report.findings.filter((finding) => finding.severity === "degraded").length;
	}
	return { extensions: model.rows.length, off, missing, degraded };
}

/**
 * The headline segments, e.g. `Global · 15 extensions · 3 off · 1 missing`.
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
		if (counts.off > 0) segments.push({ text: `${counts.off} off`, color: "meta" });
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
		{ text: `${count} settings`, color: "meta" },
	];
}

/**
 * The Settings headline for non-TUI modes, e.g. `bytefly: Settings · Global · 16 settings`.
 * The listing only ever reads the personal document, so the scope is not a parameter.
 */
export function formatSettingsHeadline(count: number): string {
	return `bytefly: Settings · Global · ${count} settings`;
}

/** The Settings listing for non-TUI modes, one row per line, in screen order. */
export function formatSettingsListing(views: readonly SettingView[]): string {
	const lines = [formatSettingsHeadline(views.length)];
	for (const view of views) lines.push(`  ${sanitizeLine(view.label)}: ${sanitizeLine(view.valueLabel)}`);
	return lines.join("\n");
}

/** The headline as one plain line, e.g. `bytefly: Global · 15 extensions · 1 missing`. */
export function formatHeadline(model: PanelModel, scope: PanelScope, options: PanelTextOptions = {}): string {
	return `bytefly: ${summarySegments(model, scope, options)
		.map((segment) => segment.text)
		.join(" · ")}`;
}

/** A row's glyph and verdict, drawn from its enablement and health axes. */
interface RowBadge {
	/** The status glyph, or `undefined` when the row has nothing to say. */
	glyph?: string;
	/** The role the glyph is painted in. */
	role: TuiRole;
	/** The right-hand word, or `undefined` when the row has no verdict. */
	text?: string;
}

/**
 * The row's badge. Settings is the enablement axis the checkbox already shows,
 * so an off extension gets one verdict (`off`) instead of a health word that
 * contradicts it. `PI_DISABLED_EXTENSIONS` is a different axis, so it is named
 * rather than sharing the word: `env disabled`. The glyph marks what needs
 * attention — a warning, a miss, a disable — so a row with nothing to report
 * carries no glyph at all, and the column reads as one shape instead of a
 * checkmark that comes and goes.
 */
export function rowBadge(row: PanelRow): RowBadge {
	if (row.item && !row.item.enabled) return { glyph: GLYPHS.disabled, role: "faint", text: "off" };
	const report = row.report;
	if (!report) return { role: "faint" };
	if (!report.enabled) return { glyph: GLYPHS.disabled, role: "faint", text: "env disabled" };
	const severity = reportSeverity(report);
	if (severity === "ok") return { role: "faint", text: reportSummary(report) };
	return { glyph: severityGlyphChar(severity), role: severityRole(severity), text: reportSummary(report) };
}

/** One listing row: `[x] ✓ label — summary`, with the suffix only when the row has one. */
export function formatRow(row: PanelRow): string {
	const badge = rowBadge(row);
	const glyph = badge.glyph ? `${badge.glyph} ` : "";
	const summary = badge.text ? ` — ${badge.text}` : "";
	if (!row.item) {
		// Reported-only: there is no enable pattern to show, so no checkbox column.
		return `  ${glyph}${row.label}${summary}`;
	}
	const checkbox = row.item.enabled ? "[x]" : "[ ]";
	return `  ${checkbox} ${glyph}${row.label}${summary}`;
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
