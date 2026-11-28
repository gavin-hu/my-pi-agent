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
import { byRunningFirst, statusRow, type StatusRow } from "../../lib/tui/rows.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import type { PendingMatch, WatchRecord, WatchStatus } from "./types.ts";

/** A pattern read out of what a caller wrote: the expression, and what it said about case. */
export interface ReadPattern {
	/** The expression itself, with the printer's delimiters gone. */
	pattern: string;
	/** What the literal's flags said, or `undefined` when the caller wrote a bare expression. */
	caseSensitive?: boolean;
}

/**
 * The printer's own shape: a body of non-slashes and escape pairs, then `/`, then a flag run.
 *
 * `(?:\\.|[^/])*` rather than `.+` is what keeps a pattern like `/api/v1/` an expression: a
 * bare slash cannot be swallowed by `[^/]` nor by `\\.`, so the hand-written reading that keeps
 * a path pattern usable is unchanged, while the printer's own `\/` is read as part of the body.
 * It is read only for the whole string, so a pattern with any text around the slashes is
 * untouched. The star accepts an empty body — `add` refuses one, but the printer can be handed
 * a record that holds it, and a round trip with a hole at zero is one a later card trips on.
 */
const LITERAL_PATTERN = /^\/((?:\\.|[^/])*)\/([a-z]*)$/;

/**
 * A pattern as the tool prints it, or the expression the caller meant.
 *
 * `formatPattern` below prints `/pat/` for a case-sensitive watcher and `/pat/i` otherwise,
 * with a `/` in the body escaped so it cannot end the body early, and a model reads that line
 * and writes it back: so the round trip has to hold, and the printer and this reader are one
 * pair. It holds to the *meaning* rather than the spelling — `\/` and `/` are one expression to
 * the engine, which is why nothing here unescapes. A bare expression keeps its meaning, with
 * `caseSensitive` deciding — which is what `add` has always taken.
 *
 * A flag run this cannot honour is refused rather than silently matched as text: `g` and `y`
 * carry `lastIndex` across per-line `.test` calls, and a pattern that reads as `/x/g` and
 * quietly matches nothing is exactly the failure this exists to stop.
 */
export function readPattern(raw: string, field = "pattern"): ReadPattern {
	const text = raw.trim();
	const literal = LITERAL_PATTERN.exec(text);
	if (literal === null) return { pattern: text };
	const [, body, flags] = literal;
	const unsupported = [...new Set(flags)].filter((flag) => flag !== "i");
	if (unsupported.length > 0) {
		throw new Error(
			`${field}'s flags are not read (\`${unsupported.join("")}\`): it takes the expression itself, and \`caseSensitive\` decides case — \`/${body}/\` and \`/${body}/i\` are the two forms the tool prints.`,
		);
	}
	return { pattern: body, caseSensitive: !flags.includes("i") };
}

/**
 * A watcher's pattern as `/<body>/<flags>` — the one string a model copies back into `add`.
 *
 * A `/` in the body is printed escaped (`\/`), because a bare one makes the body unreadable by
 * {@link readPattern}'s shape: `/api/v1/i` comes back as the literal text `/api/v1/i` rather
 * than the expression `api/v1`, so the watcher matches nothing. Escaping costs nothing at the
 * engine — `\/` and `/` are one expression — which is why the reader needs no unescape and the
 * printed form is stable. The `wake` badge is deliberately not here: a pattern copied back must
 * not silently wake a turn, so {@link formatWatchStatus} states it on a line of its own.
 */
export function formatPattern(watch: Pick<WatchRecord, "pattern" | "caseSensitive">): string {
	const flags = watch.caseSensitive ? "" : "i";
	return `/${escapeSlashes(sanitizeLine(watch.pattern))}/${flags}`;
}

/** A body with every bare `/` escaped, so it cannot read as the end of the printed form. */
function escapeSlashes(body: string): string {
	let out = "";
	for (let i = 0; i < body.length; i++) {
		const char = body[i] as string;
		if (char === "\\") {
			// An escape pair is one atom of the pattern, so its second half is copied untouched:
			// `\/` stays `\/`, and the character after a `\\` is not read as a delimiter.
			out += char + (body[i + 1] ?? "");
			i += 1;
			continue;
		}
		out += char === "/" ? "\\/" : char;
	}
	return out;
}

/** What a watcher reads: a path or a command, clipped for display. */
export function sourceLabel(watch: WatchRecord): string {
	if (watch.source.kind === "file") return clipLabel(watch.source.path ?? "");
	return clipLabel(`$ ${watch.source.command ?? ""}`);
}

/** One watcher row: marker, status glyph, id, label, and a right-aligned count. */
export function watchRow(
	watch: WatchRecord,
	theme: Theme,
	width: number,
	options: Pick<StatusRow, "selected" | "marker"> = {},
): string {
	return statusRow(theme, width, {
		...options,
		glyph: statusGlyphChar(watch.status),
		glyphRole: statusRole(watch.status),
		label: `${watch.id}  ${shortLabel(watch)}`,
		labelRole: options.selected ? "accent" : "label",
		trailing: `${watch.matchCount}`,
	});
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

/** Short status word, including an exit code, the signal that ended it, or an error when present. */
export function statusWord(watch: WatchRecord): string {
	if (watch.status === "error" && watch.error) return `error (${watch.error})`;
	if (watch.status === "exited") {
		if (typeof watch.exitCode === "number") return `exited (${watch.exitCode})`;
		// Node reports a signalled child with a null code and the signal that ended it, so the
		// code alone would leave a killed command looking like a clean exit.
		if (watch.signal) return `exited (${watch.signal})`;
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
		`pattern: ${formatPattern(watch)}`,
	];
	if (watch.wake) lines.push("wake: true");
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
			return pattern ? `add ${preview} ${clip(sanitizeLine(pattern), 24)}` : `add ${preview}`;
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
	return [
		sanitizeLine(`${sourceLabel(watch)} · ${formatPattern(watch)}`),
		sanitizeLine(
			`${statusWord(watch)} · ${watch.linesRead} lines · ${watch.matchCount} matches · ${Math.round(age / 1000)}s${watch.wake ? " · wake" : ""}`,
		),
	];
}

/** One injected-context line per pending match. */
export function formatPendingMatch(match: PendingMatch): string {
	return `${match.watcherId} (${clipLabel(match.label)}): ${sanitizeLine(match.line)}`;
}
