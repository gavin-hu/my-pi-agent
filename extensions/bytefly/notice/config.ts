/**
 * Tuning for the transcript notice block.
 *
 * The notice hangs from the shared transcript rail (`lib/tui/rail.ts`): the
 * headline and each body row sit behind the rail, painted by the notice's worst
 * severity, and a row is led by its own severity glyph. The glyphs come from the
 * shared vocabulary and the roles from the shared rail map, so a notice reads
 * like a tool block or a `goal`/`todo` rail.
 */

import type { NoticeSeverity } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { RAIL_ROLES } from "../../../lib/tui/rail.ts";
import type { TuiRole } from "../../../lib/tui/tokens.ts";

export const NOTICE_CONFIG = {
	/** Role for the source name at the head of the block. */
	sourceRole: "accent" as TuiRole,
	/** Role for the headline's title text and each row's label. */
	titleRole: "label" as TuiRole,
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
