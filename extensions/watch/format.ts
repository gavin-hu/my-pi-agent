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

/**
 * Refuse an expression that repeats a group already repeating without a bound.
 *
 * `(a+)+` is the shape: the inner `+` chooses how much to consume and the outer one chooses
 * how many times to try again, so the work is exponential in the line and one line — from a
 * file nobody vouched for — wedges the session, the poll clock included. The check reads the
 * expression as text (escapes, character classes and `{n,m}` bounds included) rather than
 * asking the engine, because the cost is a property of the shape, not of a match.
 *
 * Only a *trailing* unbounded repeat counts: `(\w+\s)+` ends with `\s`, so its splits are
 * pinned by the separator and it stays linear, while `(\w+)+` has nowhere else to go.
 */
export function assertSafePattern(value: string, field: string): void {
	const group = nestsUnboundedRepeat(value);
	if (group === undefined) return;
	// Nothing is rewritten for the caller, so the sentence quotes the group it means: the
	// expression as a whole can be long, and the offending repeat is what has to change.
	throw new Error(
		`${field} \`${value}\` repeats \`${group}\`, whose last element already repeats without a bound — exponential in the line it runs on, so one long line can freeze the session: bound one of the two repeats, or rewrite the expression.`,
	);
}

/** Compile a pattern; case-insensitive unless `caseSensitive`. */
export function compileRegex(pattern: string, caseSensitive: boolean): RegExp {
	assertSafePattern(pattern, "pattern");
	return new RegExp(pattern, caseSensitive ? "" : "i");
}

/** One group being read, and whether the last thing in it repeats without a bound. */
interface Frame {
	/** Where the group's `(` is, so a refusal can quote it. */
	start: number;
	/** Whether this group's last element is followed by an unbounded quantifier. */
	endsUnbounded: boolean;
	/** Whether it has an element yet, so a `?` in `(?:` is not read as a quantifier. */
	hasAtom: boolean;
}

/**
 * The first group in `pattern` that is quantifier-unbounded and ends unbounded itself, as
 * the text a refusal quotes (`(a+)+`), or `undefined` when there is none.
 *
 * The quantifier after `)` is read by {@link unboundedAt}, which returns how many characters
 * it spans so the scan can skip it; frames make the answer hold through nesting, so
 * `((a+))+` is caught the same way `(a+)+` is.
 */
function nestsUnboundedRepeat(pattern: string): string | undefined {
	const frames: Frame[] = [{ start: 0, endsUnbounded: false, hasAtom: false }];
	const current = (): Frame => frames[frames.length - 1] as Frame;
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i] as string;
		if (char === "\\") {
			i++;
			current().hasAtom = true;
			current().endsUnbounded = false;
			continue;
		}
		if (char === "[") {
			// A character class is one atom, and `(`, `)` or `+` inside it are literal.
			for (i++; i < pattern.length; i++) {
				if (pattern[i] === "\\") i++;
				else if (pattern[i] === "]") break;
			}
			current().hasAtom = true;
			current().endsUnbounded = false;
			continue;
		}
		if (char === "(") {
			frames.push({ start: i, endsUnbounded: false, hasAtom: false });
			continue;
		}
		if (char === ")") {
			if (frames.length < 2) {
				// An unbalanced `)` is the engine's refusal to make, not this scan's.
				current().hasAtom = true;
				current().endsUnbounded = false;
				continue;
			}
			const closed = frames.pop() as Frame;
			const repeat = unboundedAt(pattern, i + 1);
			if (repeat !== undefined && closed.endsUnbounded) {
				return pattern.slice(closed.start, i + 1);
			}
			if (repeat !== undefined) i += repeat.length - 1;
			const parent = current();
			parent.hasAtom = true;
			// A group without a quantifier ends where its body ends, which is how `((a+))+`
			// is the same shape as `(a+)+`.
			parent.endsUnbounded = repeat !== undefined || closed.endsUnbounded;
			continue;
		}
		const repeat = unboundedAt(pattern, i);
		if (repeat !== undefined && current().hasAtom) {
			current().endsUnbounded = true;
			i += repeat.length - 1;
			continue;
		}
		if (repeat !== undefined) continue;
		current().hasAtom = true;
		current().endsUnbounded = false;
	}
	return undefined;
}

/**
 * The unbounded quantifier starting at `at`, as the characters it spans: `*`, `+`, or
 * `{n,}`. A bounded one (`?`, `{n}`, `{n,m}`) is not a repeat, so it returns `undefined`.
 */
function unboundedAt(pattern: string, at: number): string | undefined {
	const char = pattern[at];
	if (char === "*" || char === "+") return char;
	if (char !== "{") return undefined;
	const bounded = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(at));
	if (bounded === null) return undefined;
	const [, , comma, upper] = bounded;
	return comma !== undefined && upper === "" ? bounded[0] : undefined;
}

/** A pattern read out of what a caller wrote: the expression, and what it said about case. */
export interface ReadPattern {
	/** The expression itself, with the printer's delimiters gone. */
	pattern: string;
	/** What the literal's flags said, or `undefined` when the caller wrote a bare expression. */
	caseSensitive?: boolean;
}

/**
 * The printer's own shape: a body with no slash in it, then `/`, then a flag run.
 *
 * `[^/]+` rather than `.+` is what keeps a pattern like `/api/v1/` an expression: its body
 * carries a slash, so it cannot be the `/…/flags` form this reads. It is read only for the
 * whole string, so a pattern with any text around the slashes is untouched.
 */
const LITERAL_PATTERN = /^\/([^/]+)\/([a-z]*)$/;

/**
 * A pattern as the tool prints it, or the expression the caller meant.
 *
 * `formatPattern` below prints `/pat/` for a case-sensitive watcher and `/pat/i` otherwise,
 * and a model reads that line and writes it back: so the round trip has to hold, and the
 * printer and this reader are one pair. A bare expression keeps its meaning, with
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
 * A watcher's pattern as `/<pattern>/<flags>`, with the wake badge appended:
 * `/pat/`, `/pat/i`, `/pat/ · wake`, `/pat/i · wake`.
 */
export function formatPattern(watch: Pick<WatchRecord, "pattern" | "caseSensitive" | "wake">): string {
	const flags = watch.caseSensitive ? "" : "i";
	const badge = watch.wake ? `${SEPARATORS.item}wake` : "";
	return `/${sanitizeLine(watch.pattern)}/${flags}${badge}`;
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
			`${statusWord(watch)} · ${watch.linesRead} lines · ${watch.matchCount} matches · ${Math.round(age / 1000)}s`,
		),
	];
}

/** One injected-context line per pending match. */
export function formatPendingMatch(match: PendingMatch): string {
	return `${match.watcherId} (${clipLabel(match.label)}): ${sanitizeLine(match.line)}`;
}
