/**
 * The transcript notice block, drawn from the shared `NoticeDetails`.
 *
 * Pure `noticeLines` shapes the body — a `source · title` headline and
 * body-indented rows of `glyph label · detail` — and `NoticeComponent` is the
 * `Component` Pi mounts in place of its default custom-message box. Every field
 * is untrusted — a job label, a matched log line — so it goes through
 * `sanitizeLine` before it reaches the terminal, and every line is clipped to the
 * width it is given. Each row is led by its own severity glyph, so a check reads
 * green and a cross red.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../lib/format.ts";
import type { NoticeDetails, NoticeItem, NoticeSeverity } from "../../../lib/notice.ts";
import { GLYPH_GAP, SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { BODY_INDENT } from "../../../lib/tui/indent.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { NOTICE_CONFIG } from "./config.ts";

/** The severity a row draws with, falling back to the notice's own. */
function severityOf(item: NoticeItem, fallback: NoticeSeverity): NoticeSeverity {
	return item.severity ?? fallback;
}

/** One severity glyph, painted in its role. */
function severityGlyph(theme: Theme, severity: NoticeSeverity): string {
	return paint(theme, NOTICE_CONFIG.glyphRoles[severity], NOTICE_CONFIG.glyphs[severity]);
}

/**
 * The notice: a `source · title` headline and body-indented rows of
 * `glyph label · detail`, then a `… N more` line when the rows were capped.
 * Every line is clipped to the width it is given.
 */
export function noticeLines(details: NoticeDetails, theme: Theme, width: number): string[] {
	const w = Math.max(1, width);
	const sep = paint(theme, NOTICE_CONFIG.detailRole, SEPARATORS.item);
	const source = paint(theme, NOTICE_CONFIG.sourceRole, sanitizeLine(details.source));
	const title = paint(theme, NOTICE_CONFIG.titleRole, sanitizeLine(details.title));
	const lines = [truncateToWidth(`${source}${sep}${title}`, w, "…")];

	const items = details.items ?? [];
	const shown = items.slice(0, NOTICE_CONFIG.maxItems);
	const fallback = details.severity ?? "info";
	const pad = " ".repeat(BODY_INDENT);
	const gap = " ".repeat(GLYPH_GAP);
	for (const item of shown) {
		const label = paint(theme, NOTICE_CONFIG.titleRole, sanitizeLine(item.label));
		const detail = item.detail ? `${sep}${paint(theme, NOTICE_CONFIG.detailRole, sanitizeLine(item.detail))}` : "";
		const row = `${pad}${severityGlyph(theme, severityOf(item, fallback))}${gap}${label}${detail}`;
		lines.push(truncateToWidth(row, w, "…"));
	}

	const more = items.length - shown.length;
	if (more > 0) {
		const continuation = " ".repeat(BODY_INDENT + 1 + GLYPH_GAP);
		const rest = `${continuation}${paint(theme, NOTICE_CONFIG.detailRole, `… ${more} more`)}`;
		lines.push(truncateToWidth(rest, w, "…"));
	}
	return lines;
}

/** The notice block Pi mounts for a custom message carrying `NoticeDetails`. */
export class NoticeComponent implements Component {
	constructor(
		private readonly details: NoticeDetails,
		private readonly theme: Theme,
	) {}

	invalidate(): void {
		// The rows are rebuilt from the live theme on every render.
	}

	render(width: number): string[] {
		return noticeLines(this.details, this.theme, Math.max(1, width));
	}
}
