/**
 * Pure text helpers for the watch extension.
 *
 * No host APIs and no theme logic beyond `Theme` colour helpers: these turn
 * watcher state and matched lines into short, terminal-safe strings for the
 * status chip, the `/watch` screen, the transcript, and the model.
 *
 * File and command output is untrusted, so every line that reaches a widget or
 * the model goes through `sanitizeLine` at the boundary.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../lib/format.ts";
import { GLYPHS } from "../../lib/ui.ts";
import type { PendingMatch, WatchRecord, WatchStatus } from "./types.ts";

/** Longest label shown in the transcript or `/watch` screen. */
const MAX_DISPLAY_LABEL = 48;

/** Longest sanitized watched line kept for display; longer lines are clipped. */
const MAX_WATCH_LINE = 200;

/** ESC-introduced sequences: OSC, CSI, and single-character escapes. */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OTHER_ESC = /\u001b[@-Z\\-_]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Make one line of untrusted file/command output safe to render.
 *
 * Resolves carriage returns the way a terminal would (keep the text after the
 * last `\r`, so progress rewrites collapse to their final state), strips ANSI
 * escapes and control characters, collapses whitespace, and clips the result.
 * `sanitizeLine` alone would leave the printable tail of an ANSI sequence.
 */
export function sanitizeWatchLine(raw: string): string {
	const withoutAnsi = raw.replace(OSC, "").replace(CSI, "").replace(OTHER_ESC, "");
	const afterCr = withoutAnsi.slice(withoutAnsi.lastIndexOf("\r") + 1);
	const cleaned = afterCr.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
	return cleaned.length > MAX_WATCH_LINE ? `${cleaned.slice(0, MAX_WATCH_LINE - 1)}…` : cleaned;
}

/** Compile a pattern; case-insensitive unless `caseSensitive`. */
export function compileRegex(pattern: string, caseSensitive: boolean): RegExp {
	return new RegExp(pattern, caseSensitive ? "" : "i");
}

/** A label clipped to one safe display line. */
export function clipLabel(text: string): string {
	return truncateToWidth(sanitizeWatchLine(text), MAX_DISPLAY_LABEL, "…");
}

/** What a watcher reads: a path or a command, clipped for display. */
export function sourceLabel(watch: WatchRecord): string {
	if (watch.source.kind === "file") return clipLabel(watch.source.path ?? "");
	return clipLabel(`$ ${watch.source.command ?? ""}`);
}

/** A watcher's label, falling back to its source. */
export function shortLabel(watch: WatchRecord): string {
	return clipLabel(watch.label || sourceLabel(watch));
}

/** Width-1 themed glyph for a watcher status. */
export function statusGlyph(status: WatchStatus, theme: Theme): string {
	switch (status) {
		case "exited":
			return theme.fg("success", GLYPHS.check);
		case "error":
			return theme.fg("error", GLYPHS.warn);
		case "stopped":
			return theme.fg("muted", GLYPHS.stopped);
		default:
			return theme.fg("accent", GLYPHS.target);
	}
}

/** Short status word, including an exit code or error when present. */
export function statusWord(watch: WatchRecord): string {
	if (watch.status === "error" && watch.error) return `error (${watch.error})`;
	if (watch.status === "exited" && watch.exitCode !== undefined && watch.exitCode !== null) {
		return `exited (${watch.exitCode})`;
	}
	return watch.status;
}

/** Order watchers for display: running first, then by most recent start. */
export function compareWatches(a: WatchRecord, b: WatchRecord): number {
	const rank = (watch: WatchRecord): number => (watch.status === "running" ? 0 : 1);
	return rank(a) - rank(b) || b.startedAt - a.startedAt;
}

/** One-line watcher summary shared by model output and the `/watch` screen. */
function watchSummary(watch: WatchRecord, now: number): string {
	const parts = [watch.id, statusWord(watch), `${watch.matchCount} match${watch.matchCount === 1 ? "" : "es"}`];
	if (watch.status === "running" && watch.pid) parts.push(`pid ${watch.pid}`);
	const age = Math.max(0, (watch.endedAt ?? now) - watch.startedAt);
	parts.push(`${Math.round(age / 1000)}s`);
	parts.push(shortLabel(watch));
	return parts.join("  ");
}

/** Model-facing list of watchers, or a note when there are none. */
export function formatWatchList(watches: WatchRecord[], now = Date.now()): string {
	if (watches.length === 0) return "No watchers.";
	const lines = watches.map((watch) => `  ${watchSummary(watch, now)}`);
	return `Watchers (${watches.length}):\n${lines.join("\n")}`;
}

/** Model-facing detail for one watcher. */
export function formatWatchStatus(watch: WatchRecord, now = Date.now()): string {
	const lines = [
		`${watch.id}: ${statusWord(watch)}`,
		`source: ${sourceLabel(watch)}`,
		`pattern: /${sanitizeLine(watch.pattern)}/${watch.caseSensitive ? "" : "i"}`,
	];
	if (watch.exclude.length > 0)
		lines.push(`exclude: ${watch.exclude.map((item) => `/${sanitizeLine(item)}/`).join(" ")}`);
	const age = Math.max(0, (watch.endedAt ?? now) - watch.startedAt);
	lines.push(`elapsed: ${Math.round(age / 1000)}s`, `lines: ${watch.linesRead}`, `matches: ${watch.matchCount}`);
	if (watch.pid) lines.push(`pid: ${watch.pid}`);
	if (watch.error) lines.push(`error: ${sanitizeLine(watch.error)}`);
	return lines.join("\n");
}

/** Model-facing render of a bounded sanitized tail. */
export function formatTail(
	label: string,
	watch: WatchRecord,
	lines: string[],
	maxChars: number,
): { text: string; truncated: boolean } {
	if (lines.length === 0) {
		return {
			text: `${watch.id}: no ${label} yet${watch.status === "running" ? "" : ` (${statusWord(watch)})`}.`,
			truncated: false,
		};
	}
	let body = lines.join("\n");
	let truncated = false;
	if (body.length > maxChars) {
		body = body.slice(body.length - maxChars);
		truncated = true;
	}
	const suffix = truncated ? `\n… truncated (${lines.length} lines total)` : "";
	return { text: `${watch.id} (${statusWord(watch)}) ${label}:\n${body}${suffix}`, truncated };
}

/** Transcript call text for the `watch` tool. */
export function formatCallText(action: string, args: Record<string, unknown>, argsComplete = true): string {
	const target = typeof args.id === "string" && args.id ? sanitizeLine(args.id) : undefined;
	switch (action) {
		case "add": {
			const path = typeof args.path === "string" ? args.path.trim() : "";
			const command = typeof args.command === "string" ? args.command.trim() : "";
			const source = path ? path : command ? `$ ${command}` : "";
			if (!source) return argsComplete ? "add" : "add …";
			const preview = truncateToWidth(sanitizeLine(source), MAX_DISPLAY_LABEL, "…");
			const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
			return pattern ? `add ${preview} /${truncateToWidth(sanitizeLine(pattern), 24, "…")}/` : `add ${preview}`;
		}
		case "status":
		case "matches":
		case "logs":
		case "stop":
			return `${action} ${target ?? ""}`.trim();
		case "clear":
			return args.all ? "clear all" : `clear ${target ?? "stopped"}`.trim();
		default:
			return action;
	}
}

/** One-line outcome for a watcher, themed for the transcript result. */
export function formatWatchOutcomeLine(watch: WatchRecord, theme: Theme, now = Date.now()): string {
	const sep = theme.fg("dim", " · ");
	const age = Math.max(0, (watch.endedAt ?? now) - watch.startedAt);
	const outcome =
		watch.status === "error"
			? theme.fg("error", statusWord(watch))
			: theme.fg("dim", `${watch.matchCount} match${watch.matchCount === 1 ? "" : "es"}`);
	return (
		statusGlyph(watch.status, theme) +
		" " +
		theme.fg("accent", watch.id) +
		" " +
		theme.fg("muted", shortLabel(watch)) +
		sep +
		outcome +
		sep +
		theme.fg("dim", `${Math.round(age / 1000)}s`)
	);
}

/** Unstyled, sanitized detail lines for the `/watch` focus pane. */
export function formatWatchDetail(watch: WatchRecord, now = Date.now()): string[] {
	const age = Math.max(0, (watch.endedAt ?? now) - watch.startedAt);
	const flags = `${watch.caseSensitive ? "" : "i"}${watch.wake ? " · wake" : ""}`;
	return [
		sanitizeLine(`${sourceLabel(watch)} · /${watch.pattern}/${flags}`),
		sanitizeLine(
			`${statusWord(watch)} · ${watch.linesRead} lines · ${watch.matchCount} matches · ${Math.round(age / 1000)}s`,
		),
	];
}

/** One injected-context line per pending match. */
export function formatPendingMatch(match: PendingMatch): string {
	return `${match.watcherId} (${clipLabel(match.label)}): ${sanitizeLine(match.line)}`;
}
