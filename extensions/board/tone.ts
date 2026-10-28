/**
 * The terminal's word for a board tone.
 *
 * The tone table (`lib/board/tone.ts`) says what a lane, a reason, and a decision row mean;
 * the page wears those words as CSS properties directly. The terminal has its own vocabulary —
 * `lib/tui/tokens.ts`'s roles are `ok`, `warn`, `bad`, `meta`, `faint`, and deliberately not
 * `success`, `danger`, or `muted` — so this is the one place the two are bridged, in the
 * extension, because only the transcript speaks the terminal's words.
 */

import type { BoardTone } from "../../lib/board/tone.ts";
import type { TuiRole } from "../../lib/tui/tokens.ts";

/** The role each board tone is painted as, closest first. */
export const TONE_ROLE: Record<BoardTone, TuiRole> = {
	muted: "meta",
	dim: "faint",
	warn: "warn",
	accent: "accent",
	danger: "bad",
	success: "ok",
};
