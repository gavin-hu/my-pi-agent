/**
 * Pure formatting for doctor's reports.
 *
 * Two shapes share these helpers: the plain multi-line text every non-TUI mode
 * shows, and the per-extension summary the unified panel renders. Nothing here
 * touches the filesystem or the host, and every string that came from a probe (a
 * parse error, a captured path) goes through {@link sanitizeLine} — probe text can carry
 * control characters, a parse error quotes the file's own bytes.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../lib/format.ts";
import type { ExtensionReport, Finding, FindingSeverity } from "../../../lib/requirements.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { paint, type TuiRole } from "../../../lib/tui/tokens.ts";

/** Counts the report headline uses. */
export interface ReportCounts {
	extensions: number;
	enabled: number;
	missing: number;
	degraded: number;
}

/** Whether a finding means the extension cannot fully do its job. */
export function isProblemSeverity(severity: FindingSeverity): boolean {
	return severity === "missing" || severity === "degraded";
}

/** Tally a report set. `info` findings are notes, not problems. */
export function countFindings(reports: readonly ExtensionReport[]): ReportCounts {
	const findings = reports.flatMap((report) => report.findings);
	return {
		extensions: reports.length,
		enabled: reports.filter((report) => report.enabled).length,
		missing: findings.filter((finding) => finding.severity === "missing").length,
		degraded: findings.filter((finding) => finding.severity === "degraded").length,
	};
}

/** Whether anything in the report set needs attention. */
export function hasProblems(reports: readonly ExtensionReport[]): boolean {
	const counts = countFindings(reports);
	return counts.missing > 0 || counts.degraded > 0;
}

/** The one-line headline, e.g. `doctor: 1 missing, 2 degraded across 17 extensions`. */
export function formatHeadline(reports: readonly ExtensionReport[]): string {
	const counts = countFindings(reports);
	const parts: string[] = [];
	if (counts.missing > 0) parts.push(`${counts.missing} missing`);
	if (counts.degraded > 0) parts.push(`${counts.degraded} degraded`);
	if (parts.length === 0) return `doctor: all ${counts.enabled} enabled extensions are ready`;
	return `doctor: ${parts.join(", ")} across ${counts.extensions} extensions`;
}

/** One finding as `label: detail` plus an indented hint. */
function findingLines(finding: Finding, indent: string): string[] {
	const lines = [`${indent}${sanitizeLine(finding.check)}: ${sanitizeLine(finding.detail)}`];
	if (finding.hint) lines.push(`${indent}  → ${sanitizeLine(finding.hint)}`);
	return lines;
}

/** The full multi-line report every non-TUI mode prints. */
export function formatReport(reports: readonly ExtensionReport[]): string {
	const lines = [formatHeadline(reports)];
	const problems = reports.filter((report) => report.findings.some((finding) => isProblemSeverity(finding.severity)));

	if (problems.length === 0) {
		const notes = reports.flatMap((report) =>
			report.findings
				.filter((finding) => finding.severity === "info")
				.map((finding) => `  ${sanitizeLine(report.extension)}: ${sanitizeLine(finding.detail)}`),
		);
		if (notes.length > 0) lines.push("", "Notes:", ...notes);
		return lines.join("\n");
	}

	for (const report of problems) {
		lines.push("", `${sanitizeLine(report.extension)}${report.enabled ? "" : " (disabled)"}`);
		for (const finding of report.findings) {
			if (!isProblemSeverity(finding.severity)) continue;
			lines.push(...findingLines(finding, "  "));
		}
	}
	return lines.join("\n");
}

/** Every finding for one extension, including the checks that passed. */
export function formatExtension(report: ExtensionReport): string {
	const lines = [`${sanitizeLine(report.extension)}${report.enabled ? "" : " (disabled)"}`];
	for (const finding of report.findings) lines.push(...findingLines(finding, "  "));
	return lines.join("\n");
}

/** The single sentence the proactive session-start warning uses. */
export function formatWarning(findings: readonly Finding[]): string {
	const byExtension = new Map<string, string[]>();
	for (const finding of findings) {
		const list = byExtension.get(finding.extension) ?? [];
		list.push(sanitizeLine(finding.check));
		byExtension.set(finding.extension, list);
	}
	const parts = [...byExtension].map(([extension, checks]) => `${sanitizeLine(extension)} (${checks.join(", ")})`);
	return `doctor: missing ${parts.join("; ")} — run /bytefly doctor`;
}

/** The design role a severity is drawn in. */
export function severityRole(severity: FindingSeverity): TuiRole {
	switch (severity) {
		case "missing":
			return "bad";
		case "degraded":
			return "warn";
		case "info":
			return "faint";
		default:
			return "ok";
	}
}

/** The bare severity glyph, from the shared vocabulary. */
export function severityGlyphChar(severity: FindingSeverity): string {
	switch (severity) {
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

/** The severity glyph, themed by role. */
export function severityGlyph(severity: FindingSeverity, theme: Theme): string {
	return paint(theme, severityRole(severity), severityGlyphChar(severity));
}

/** The severity that represents an extension: worst finding wins. */
export function reportSeverity(report: ExtensionReport): FindingSeverity {
	if (!report.enabled) return "info";
	if (report.findings.some((finding) => finding.severity === "missing")) return "missing";
	if (report.findings.some((finding) => finding.severity === "degraded")) return "degraded";
	return "ok";
}

/** A short right-hand status for one extension row. */
export function reportSummary(report: ExtensionReport): string {
	if (!report.enabled) return "disabled";
	const missing = report.findings.filter((finding) => finding.severity === "missing").length;
	const degraded = report.findings.filter((finding) => finding.severity === "degraded").length;
	if (missing > 0) return `${missing} missing`;
	if (degraded > 0) return `${degraded} degraded`;
	return "ok";
}

/**
 * The focused extension's findings, wrapped to `width` and capped at `rows`
 * lines. Problems come first: `includeInfo` is the screen's expand toggle, and
 * a clean extension says so rather than padding the pane with notes.
 */
export function detailLines(
	report: ExtensionReport | undefined,
	theme: Theme,
	width: number,
	rows: number,
	includeInfo = false,
): string[] {
	if (!report) return [];
	const budget = Math.max(1, rows);
	const shown = includeInfo ? report.findings : report.findings.filter((finding) => finding.severity !== "info");
	if (shown.length === 0) {
		return [`  ${paint(theme, "faint", report.enabled ? "no problems" : "disabled")}`];
	}

	const lines: string[] = [];
	for (const finding of shown) {
		for (const line of wrapTextWithAnsi(
			`${sanitizeLine(finding.check)}: ${sanitizeLine(finding.detail)}`,
			Math.max(1, width - 2),
		)) {
			lines.push(`  ${line}`);
		}
		if (finding.hint) {
			for (const line of wrapTextWithAnsi(`→ ${sanitizeLine(finding.hint)}`, Math.max(1, width - 4))) {
				lines.push(`    ${paint(theme, "faint", line)}`);
			}
		}
	}
	if (lines.length <= budget) return lines;
	return [...lines.slice(0, budget - 1), `  ${paint(theme, "faint", "…")}`];
}
