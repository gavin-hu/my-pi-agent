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
 * An integer grouped with thousands separators (`999`, `8,000`, `42,478`).
 * Hand-rolled rather than `toLocaleString`, so a count is identical under any
 * locale and ICU build.
 */
export function formatCount(count: number): string {
	if (!Number.isFinite(count)) return "0";
	const sign = count < 0 ? "-" : "";
	const digits = Math.abs(Math.trunc(count)).toString();
	let out = "";
	for (let i = 0; i < digits.length; i++) {
		if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
		out += digits[i];
	}
	return sign + out;
}

/**
 * Compact duration: `450ms`, `3.2s`, `1m05s`, `2h03m`. Non-finite or
 * negative input reads `0ms`, so a missing timestamp never prints `NaN`.
 */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "0ms";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** `1 tool`, `3 tools`: a tool count with the right word. */
export function formatToolCount(count: number): string {
	const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
	return `${formatCount(n)} ${n === 1 ? "tool" : "tools"}`;
}

/**
 * A tail bounded to `maxChars`: the end of the joined lines, with the truncation
 * flag. The header and the truncation suffix belong to the caller, because each
 * surface says something different about where the rest of the output lives.
 */
export function boundedTail(lines: readonly string[], maxChars: number): { text: string; truncated: boolean } {
	const body = lines.join("\n");
	if (body.length <= maxChars) return { text: body, truncated: false };
	return { text: body.slice(body.length - maxChars), truncated: true };
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

/** A string read as one sanitized line; any other value reads empty. */
export function lineOf(value: unknown): string {
	return typeof value === "string" ? sanitizeLine(value) : "";
}

/** Longest untrusted line kept for display; longer lines are clipped. */
export const MAX_OUTPUT_LINE = 200;

/** ESC-introduced sequences: OSC, CSI, and single-character escapes. */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OTHER_ESC = /\u001b[@-Z\\-_]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * The boundary for one line of **program output**: a log file, a child's
 * stdout, a tailed file.
 *
 * Stronger than {@link sanitizeLine}, which strips control characters but leaves
 * the printable tail of an ANSI sequence behind. This removes whole OSC, CSI,
 * and single-character escapes first, then resolves carriage returns the way a
 * terminal would (keep the text after the last `\r`, so progress rewrites
 * collapse to their final state), squeezes whitespace, and clips the result.
 *
 * The escape-stripping has to happen before the control-character pass: once
 * ESC has become a space, the rest of the sequence is ordinary text.
 */
export function sanitizeUntrustedLine(raw: string, maxLength: number = MAX_OUTPUT_LINE): string {
	const withoutAnsi = raw.replace(OSC, "").replace(CSI, "").replace(OTHER_ESC, "");
	const afterCr = withoutAnsi.slice(withoutAnsi.lastIndexOf("\r") + 1);
	const cleaned = afterCr.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
	return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/** {@link sanitizeUntrustedLine} for a block of output, one entry per line. */
export function sanitizeUntrustedText(raw: string, maxLength: number = MAX_OUTPUT_LINE): string[] {
	return raw.split("\n").map((line) => sanitizeUntrustedLine(line, maxLength));
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
