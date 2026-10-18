/**
 * The transcript notice block, drawn from the shared `NoticeDetails`.
 *
 * Pure `noticeLines` shapes the body and hangs the rows from the transcript
 * rail; `NoticeComponent` is the `Component` Pi mounts in place of its default
 * custom-message box. Every field is untrusted — a job label, a matched log line
 * — so it goes through `sanitizeLine` before it reaches the terminal, and every
 * line is clipped to the width it is given. The rail is painted by the notice's
 * worst severity, so a failure reads red at the edge like an errored tool
 * result; the `source · title` headline stays at the margin.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../lib/format.ts";
import type { NoticeDetails, NoticeItem, NoticeSeverity } from "../../../lib/notice.ts";
import { GLYPH_GAP, SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { BODY_INDENT, indentBlockLines } from "../../../lib/tui/indent.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { RenderCache } from "../../../lib/tui/render-cache.ts";
import { DEFAULT_RAIL_GLYPH, railGlyph } from "../chrome.ts";
import { NOTICE_CONFIG } from "./config.ts";

/** Severity order, so the rail can carry the worst one. */
const SEVERITY_RANK: Readonly<Record<NoticeSeverity, number>> = { info: 0, ok: 1, warn: 2, bad: 3 };

/** The severity a row draws with, falling back to the notice's own. */
function severityOf(item: NoticeItem, fallback: NoticeSeverity): NoticeSeverity {
	return item.severity ?? fallback;
}

/** The worst severity across the headline and its rows; the rail's role. */
function worstSeverity(details: NoticeDetails): NoticeSeverity {
	const fallback = details.severity ?? "info";
	let worst: NoticeSeverity = fallback;
	for (const item of details.items ?? []) {
		const severity = severityOf(item, fallback);
		if (SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) worst = severity;
	}
	return worst;
}

/** One severity glyph, painted in its role. */
function severityGlyph(theme: Theme, severity: NoticeSeverity): string {
	return paint(theme, NOTICE_CONFIG.glyphRoles[severity], NOTICE_CONFIG.glyphs[severity]);
}

/**
 * The notice: a `source · title` headline at the margin and body-indented rows
 * of `glyph label · detail` behind the rail, then a `… N more` line when the
 * rows were capped. The rail is painted by the notice's worst severity. Every
 * line is clipped to the width it is given; `pad` is Pi's output pad, the
 * block's own left margin.
 */
export function noticeLines(
	details: NoticeDetails,
	theme: Theme,
	width: number,
	pad = 0,
	glyph = DEFAULT_RAIL_GLYPH,
): string[] {
	const w = Math.max(1, width);
	const sep = paint(theme, NOTICE_CONFIG.detailRole, SEPARATORS.item);
	const source = paint(theme, NOTICE_CONFIG.sourceRole, sanitizeLine(details.source));
	const title = paint(theme, NOTICE_CONFIG.titleRole, sanitizeLine(details.title));
	const items = details.items ?? [];
	const shown = items.slice(0, NOTICE_CONFIG.maxItems);
	const fallback = details.severity ?? "info";
	const gap = " ".repeat(GLYPH_GAP);

	const rows = shown.map((item) => {
		const label = paint(theme, NOTICE_CONFIG.titleRole, sanitizeLine(item.label));
		const detail = item.detail ? `${sep}${paint(theme, NOTICE_CONFIG.detailRole, sanitizeLine(item.detail))}` : "";
		return `${severityGlyph(theme, severityOf(item, fallback))}${gap}${label}${detail}`;
	});
	const more = items.length - shown.length;
	if (more > 0) {
		rows.push(`${" ".repeat(1 + GLYPH_GAP)}${paint(theme, NOTICE_CONFIG.detailRole, `… ${more} more`)}`);
	}

	// The shared indent owns the column math: the headline at the margin, every
	// row behind the rail, and each row clipped with the notice's ellipsis.
	return indentBlockLines([`${source}${sep}${title}`, ...rows], w, {
		indent: Math.max(0, Math.floor(pad)) + BODY_INDENT,
		rail: railGlyph(theme, NOTICE_CONFIG.railRoles[worstSeverity(details)], glyph),
		headline: true,
		trimTrailing: false,
		bodyClip: "…",
	});
}

/**
 * The notice block Pi mounts for a custom message carrying `NoticeDetails`.
 *
 * `render` runs on every frame Pi draws and the lines are a pure function of the
 * fixed fields, so they are memoized on the width (`RenderCache`); a theme change
 * rebuilds the component (`CustomMessageComponent.invalidate` re-runs the
 * renderer), and `invalidate` drops the memo in case it does not.
 */
export class NoticeComponent implements Component {
	private readonly cache = new RenderCache();

	constructor(
		private readonly details: NoticeDetails,
		private readonly theme: Theme,
		private readonly pad = 0,
		private readonly glyph = DEFAULT_RAIL_GLYPH,
	) {}

	invalidate(): void {
		this.cache.invalidate();
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.cache.lines(w, undefined, () => noticeLines(this.details, this.theme, w, this.pad, this.glyph));
	}
}
