/**
 * Pure text/number formatting shared across extensions.
 *
 * No terminal access and no theme: these turn numbers and text into the short
 * strings a renderer shows.
 */

import { homedir } from "node:os";

/** Compact token count: `999`, `1.0k`, `12k`, `1.5M`, `12M`. `?` when not a number. */
export function formatTokens(count: number): string {
	if (!Number.isFinite(count)) return "?";
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/**
 * Replace terminal control characters (including ESC and the C1 block) with
 * spaces, keeping `\n` and `\t` for callers that render multi-line text.
 *
 * On its own this is not the boundary for a one-line surface: it leaves the
 * newlines, tabs, and space runs a caller meant to remove. Use
 * {@link sanitizeLine} for text that must not escape a single line.
 */
export function stripControlChars(text: string): string {
	return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ");
}

/**
 * Collapse newlines, tabs, and runs of spaces so text stays on one line.
 *
 * Layout only — this is deliberately *not* the terminal boundary: it leaves
 * control characters (ESC, BEL, the C1 block) untouched. That makes it the
 * right helper for trusted text and for text whose ANSI styling the caller
 * wants to keep, such as a themed status chip. For model-, file-, or
 * network-authored text, use {@link sanitizeLine}.
 */
export function sanitize(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * The boundary for untrusted, single-line text: neutralize control characters
 * (so an ANSI/OSC escape from a page title, a filename, a stored note, or a
 * prompt can never reach a widget or the terminal), then collapse the result to
 * one line.
 *
 * Call this *before* applying a theme colour, so the styled string is what the
 * renderer sees and nothing has to re-sanitize it.
 */
export function sanitizeLine(text: string): string {
	return sanitize(stripControlChars(text));
}

/**
 * Replace a home-directory prefix with `~`, matching at a path boundary so
 * `/home/bob` does not shorten `/home/bobby`. Separators are normalized to `/`
 * so a Windows home (`C:\Users\x`) still matches a forward-slash path and the
 * result reads uniformly in the UI.
 *
 * `home` defaults to the real home directory; pass one explicitly to keep a
 * renderer deterministic (and testable) against an injected home.
 */
export function shortenPath(path: string, home: string = homedir()): string {
	const normalized = path.replace(/\\/g, "/");
	const root = home.replace(/\\/g, "/").replace(/\/+$/, "");
	if (!root) return normalized;
	if (normalized === root) return "~";
	return normalized.startsWith(`${root}/`) ? `~${normalized.slice(root.length)}` : normalized;
}
