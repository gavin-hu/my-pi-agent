/**
 * The plain-text form of a report, for RPC, JSON, and print sessions.
 *
 * The screen draws its own colour and width-aware rows; this module keeps the
 * same facts in the order the screen uses, so a reader in a non-TUI mode sees
 * the same sentence the terminal would. No theme, no terminal width.
 */

import { formatTokens } from "../../lib/format.ts";
import type { ContextBucket, ContextReport } from "./types.ts";

/** `Context · 124k / 200k (62%)`, or why one of the numbers is missing. */
export function formatHeadline(report: ContextReport): string {
	if (report.window <= 0) return "Context · model context window unknown";
	if (report.tokens === null) {
		return `Context · ${formatTokens(report.window)} window · tokens unknown until the next reply`;
	}
	const percent = report.percent === null ? "?" : `${Math.round(report.percent)}%`;
	return `Context · ${formatTokens(report.tokens)} / ${formatTokens(report.window)} (${percent})`;
}

/** The free space, the auto-compaction threshold, and what it keeps. */
export function formatBudget(report: ContextReport): string {
	if (report.window <= 0) {
		return "No model window, so no threshold: Pi's compaction needs a model with a known context window.";
	}
	const parts: string[] = [];
	if (report.free !== null) parts.push(`${formatTokens(report.free)} free`);
	parts.push(report.enabled ? `auto-compact at ${formatTokens(report.autoCompactAt)}` : "auto-compaction off");
	if (report.headroom !== null) {
		parts.push(
			report.headroom >= 0
				? `${formatTokens(report.headroom)} headroom`
				: `past the threshold by ${formatTokens(-report.headroom)}`,
		);
	}
	parts.push(`keeps newest ${formatTokens(report.keepRecentTokens)}`);
	return parts.join(" · ");
}

/** The branch's compaction history in one line. */
export function formatCompaction(report: ContextReport): string {
	const { count, last } = report.compaction;
	if (!last) return "none yet";
	const times = `${count} so far`;
	return `${times} · last ${last.at} cut ${formatTokens(last.tokensBefore)} → ${formatTokens(last.summaryTokens)} summary (freed ${formatTokens(last.freed)})`;
}

/** The difference between the host's total and the composition estimate, when it is not zero. */
export function formatDrift(report: ContextReport): string | undefined {
	if (report.drift === null || report.drift === 0) return undefined;
	if (report.drift > 0) {
		return `Provider overhead · +${formatTokens(report.drift)} not attributed to a row`;
	}
	return `Estimate drift · the rows are ${formatTokens(-report.drift)} above the host's total; both are estimates`;
}

/** One composition row, as plain text. */
export function formatBucket(bucket: ContextBucket): string {
	const indent = bucket.depth > 0 ? "    " : "  ";
	const label = bucket.label.padEnd(bucket.depth > 0 ? 22 : 24);
	const tokens = formatTokens(bucket.tokens).padStart(6);
	const share = `${bucket.share.toFixed(1)}%`.padStart(6);
	const note = bucket.note ? `  ${bucket.note}` : "";
	return `${indent}${label}${tokens}${share}${note}`;
}

/** The report as a notification body: headline, budget, rows, then what happened. */
export function formatReport(report: ContextReport): string {
	const lines = [formatHeadline(report), formatBudget(report)];
	if (report.buckets.length > 0) lines.push("", ...report.buckets.map(formatBucket));
	const drift = formatDrift(report);
	if (drift) lines.push("", drift);
	lines.push("", `Compaction · ${formatCompaction(report)}`);
	if (report.largest.length > 0) {
		const blocks = report.largest
			.map((block) => `${formatTokens(block.tokens)} ${block.role} ${block.label}`)
			.join(" · ");
		lines.push(`Largest · ${blocks}`);
	}
	return lines.join("\n");
}
