/**
 * Transcript text sharing for `web_search` and `web_fetch`.
 *
 * Titles, answers, fetched page titles, and error strings all come from the web.
 * They are untrusted: a page can carry ANSI/OSC escapes and control characters
 * that would restyle or corrupt the terminal. `oneLine` collapses one such
 * string to a single sanitized line before a theme colour is applied, optionally
 * clipped to a display width.
 */

import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { sanitize, stripControlChars } from "../../lib/format.ts";

/** Collapse untrusted web text to one sanitized line, optionally clipped to `width` columns. */
export function oneLine(text: string, width?: number): string {
	const safe = sanitize(stripControlChars(text));
	if (width === undefined) return safe;
	// `truncateToWidth` emits ANSI resets; strip them since the caller colourises afterwards.
	return stripTerminalSequences(truncateToWidth(safe, width, "…"));
}
