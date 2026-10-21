/**
 * Tuning for the transcript notice block.
 *
 * The notice sits at the transcript's margin — a `source · title` headline and
 * rows behind the shared transcript rail, each row led by its own severity
 * glyph. The glyphs come from the shared vocabulary, the roles from the shared
 * rail map, and the rail glyph from the `chrome` config, so a notice reads like
 * the tool results around it.
 *
 * Severity reaches two surfaces: the rail (the block's worst severity) and the
 * headline's title (the notice's own). A row carries no colour of its own, so a
 * notice reporting one success and one failure stays readable as a list.
 */

import type { NoticeSeverity } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { TuiRole } from "../../../lib/tui/tokens.ts";
import { RAIL_ROLES } from "../chrome.ts";

export const NOTICE_CONFIG = {
	/** Role for the source name at the head of the block. */
	sourceRole: "accent" as TuiRole,
	/**
	 * Role for the headline's title, keyed by the notice's own severity: an alert
	 * reads in colour where the sentence is, a routine notice stays body text.
	 */
	titleRoles: {
		info: "label",
		ok: "label",
		warn: "warn",
		bad: "bad",
	} as Record<NoticeSeverity, TuiRole>,
	/** Role for each row's label; a row states its severity with its glyph. */
	rowRole: "label" as TuiRole,
	/** Role for the `·` separators and each row's trailing detail. */
	detailRole: "faint" as TuiRole,
	/** Width-1 glyph per severity, from the shared vocabulary. */
	glyphs: {
		info: GLYPHS.pending,
		ok: GLYPHS.check,
		warn: GLYPHS.warn,
		bad: GLYPHS.cross,
	} as Record<NoticeSeverity, string>,
	/** Design role per severity for a row's glyph: a check is green, a cross red. */
	glyphRoles: {
		info: "info",
		ok: "ok",
		warn: "warn",
		bad: "bad",
	} as Record<NoticeSeverity, TuiRole>,
	/** The rail's neutral-by-default role per severity, shared with every rail. */
	railRoles: RAIL_ROLES,
	/** Rows drawn before the rest collapse into a `… N more` line. */
	maxItems: 8,
} as const;
