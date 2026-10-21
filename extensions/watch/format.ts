/**
 * Pure text helpers for the watch extension.
 *
 * No host APIs and no theme logic beyond `Theme` colour helpers: these turn
 * watcher state and matched lines into short, terminal-safe strings for the
 * status chip, the `/watch` screen, the transcript, and the model.
 *
 * File and command output is untrusted, so every line that reaches a widget or
 * the model goes through `sanitizeUntrustedLine` from `lib/format.ts` at the
 * boundary; `sanitizeLine` covers the extension's own trusted text.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { boundedTail, sanitizeLine } from "../../lib/format.ts";
import { clip, clipLabel, labelLine } from "../../lib/tui/columns.ts";
import { GLYPHS, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { byRunningFirst } from "../../lib/tui/rows.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import type { PendingMatch, WatchRecord, WatchStatus } from "./types.ts";

/** Compile a pattern; case-insensitive unless `caseSensitive`. */
export function compileRegex(pattern: string, caseSensitive: boolean): RegExp {
	return new RegExp(pattern, caseSensitive ? "" : "i");
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

/** The design role a watcher status is drawn in. */
export function statusRole(status: WatchStatus): TuiRole {
	switch (status) {
		case "exited":
			return "ok";
		case "error":
			return "bad";
		case "stopped":
			return "meta";
		default:
			return "accent";
	}
}

/** Width-1 glyph for a watcher status, from the shared vocabulary. */
export function statusGlyphChar(status: WatchStatus): string {
	switch (status) {
		case "exited":
			return GLYPHS.check;
		case "error":
			return GLYPHS.warn;
		case "stopped":
			return GLYPHS.stopped;
		default:
			return GLYPHS.target;
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
export const compareWatches = byRunningFirst<WatchRecord>((watch) => watch.status === "running");

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
	const { text: body, truncated } = boundedTail(lines, maxChars);
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
			const preview = labelLine(source);
			const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
			return pattern ? `add ${preview} /${clip(sanitizeLine(pattern), 24)}/` : `add ${preview}`;
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
	const sep = paint(theme, "faint", SEPARATORS.item);
	const age = Math.max(0, (watch.endedAt ?? now) - watch.startedAt);
	const outcome =
		watch.status === "error"
			? paint(theme, "bad", statusWord(watch))
			: paint(theme, "faint", `${watch.matchCount} match${watch.matchCount === 1 ? "" : "es"}`);
	return (
		paint(theme, statusRole(watch.status), statusGlyphChar(watch.status)) +
		" " +
		paint(theme, "accent", watch.id) +
		" " +
		paint(theme, "meta", shortLabel(watch)) +
		sep +
		outcome +
		sep +
		paint(theme, "faint", `${Math.round(age / 1000)}s`)
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
