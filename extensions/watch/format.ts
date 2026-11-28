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
 * Refuse an expression whose work is exponential in the line it is run against.
 *
 * A repeat over a group is the shape: when an iteration can end in more than one place, the
 * outer repeat multiplies the inner choices, and one line — from a file nobody vouched for —
 * wedges the session, the poll clock included. So three things are refused, and each is a
 * measurement in `format.test.ts`: a body whose own tail repeats without a bound (`(a+)+`), a
 * body whose last element is optional or can match what the run before it matches
 * (`(\w+\s?)+`, `(a+a)+`), and a body whose branches can match the same text (`(a|aa)+`).
 *
 * The check reads the expression as text rather than asking the engine, because the cost is a
 * property of the shape and not of a match; the watch page's Limits owns what it misses.
 */
export function assertSafePattern(value: string, field: string): void {
	const refusal = unpinnedRepeat(value);
	if (refusal === undefined) return;
	// Nothing is rewritten for the caller, so each sentence quotes the group it means: the
	// expression as a whole can be long, and the offending repeat is what has to change.
	throw new Error(`${field} \`${value}\` repeats \`${refusal.group}\`, ${refusal.why}`);
}

/** Compile a pattern; case-insensitive unless `caseSensitive`. */
export function compileRegex(pattern: string, caseSensitive: boolean): RegExp {
	assertSafePattern(pattern, "pattern");
	return new RegExp(pattern, caseSensitive ? "" : "i");
}

/** What a quantifier does to the width of the atom before it. */
type Repeat = "none" | "nullable" | "variable";

/** The quantifier starting at `at`, as the characters it spans and the width it gives its atom. */
function repeatAt(pattern: string, at: number): { text: string; repeat: Repeat } {
	const char = pattern[at];
	if (char === "?") return { text: "?", repeat: "nullable" };
	if (char === "*" || char === "+") return { text: char, repeat: "variable" };
	if (char !== "{") return { text: "", repeat: "none" };
	const braces = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(at));
	if (braces === null) return { text: "", repeat: "none" };
	const span = braces[0] as string;
	const lower = Number(braces[1]);
	if (braces[2] === undefined) return { text: span, repeat: lower === 0 ? "nullable" : "none" };
	if (braces[3] === "") return { text: span, repeat: "variable" };
	const upper = Number(braces[3]);
	if (upper === lower) return { text: span, repeat: upper === 0 ? "nullable" : "none" };
	return { text: span, repeat: upper <= 1 ? "nullable" : "variable" };
}

/** Whether a quantifier's text repeats without a bound: `*`, `+`, `{n,}`. */
function isUnbounded(text: string): boolean {
	return text === "*" || text === "+" || text.endsWith(",}");
}

/** One atom as written: a literal, an escape, a class, `.`, or a whole group. */
interface Atom {
	text: string;
}

/** What the overlap sample tries: every printable ASCII character. */
const SAMPLE: readonly string[] = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index));

/**
 * Whether two atoms can match a character in common, so neither pins where the other stops.
 *
 * A sample of printable ASCII and not a proof: two classes that meet only outside it read as
 * disjoint here, which is the false negative the watch page names rather than a wrong refusal.
 */
function overlaps(left: Atom, right: Atom): boolean {
	if (left.text === right.text) return true;
	let a: RegExp;
	let b: RegExp;
	try {
		a = new RegExp(`^(?:${left.text})$`, "u");
		b = new RegExp(`^(?:${right.text})$`, "u");
	} catch {
		return true;
	}
	return SAMPLE.some((char) => a.test(char) && b.test(char));
}

/** One branch of an alternation, as the body's own scan saw it. */
interface Branch {
	/** The branch as written, comparable as text only when `plain` is true. */
	text: string;
	/** Every character a literal and no quantifier, so `(a|aa)` can be read as text. */
	plain: boolean;
	/** The branch can end its iteration more than one place, so the repeat around it is exponential. */
	loose: boolean;
}

/** A group being read, and what its body has shown so far. */
interface Frame {
	/** Where the group's `(` is, so a refusal can quote it. */
	start: number;
	/** The last element is followed by an unbounded repeat — `(a+)+`'s own shape. */
	endsUnbounded: boolean;
	/** It has an element, so the group's own `?` in `(?:` is not a quantifier. */
	hasAtom: boolean;
	/** A lookaround, which consumes nothing and so pins nothing. */
	lookaround: boolean;
	/** The variable element whose split nothing has pinned yet. */
	open: Atom | undefined;
	/** A variable element that a required atom did not pin. */
	loose: boolean;
	branches: Branch[];
	/** Where the current branch starts, and whether it is still literal text. */
	branchFrom: number;
	plain: boolean;
}

/** What a scan refuses, and why: the group to quote and the fragment of its sentence. */
interface Refusal {
	group: string;
	why: string;
}

/**
 * What each refusal says the group does, in the order a reader is likely to have meant it.
 *
 * The first is `(a+)+`: the body's own tail is an unbounded repeat. The second is an iteration
 * that can end anywhere — `(\w+\s?)` leaves `\s?` free to match nothing, and `(a+a)` ends on a
 * character its own run could have swallowed. The third is `(a|aa)`, whose branches can match
 * one text two ways.
 */
const REPEATED_TAIL =
	"whose last element already repeats without a bound — exponential in the line it runs on, so one long line can freeze the session: bound one of the two repeats, or rewrite the expression.";
const OPEN_TAIL =
	"whose iterations can end more than one place — exponential in the line it runs on, so one long line can freeze the session: end each iteration on a required character the run before it cannot match, or move the optional part outside the repeat.";
const AMBIGUOUS_BRANCHES =
	"whose branches can match the same text in more than one way — exponential in the line it runs on, so one long line can freeze the session: make the branches start differently, or drop the repeat around them.";

/**
 * The first group in `pattern` whose repeat is exponential in the line, as the text a refusal
 * quotes and the fragment that says why, or `undefined` when every repeat is pinned.
 *
 * Frames make the answer hold through nesting, so `((a+))+` is `(a+)+`. Each measurement in
 * `format.test.ts` stands for one branch of {@link unpinnedRepeat}'s report.
 */
function unpinnedRepeat(pattern: string): Refusal | undefined {
	const frameAt = (start: number, branchFrom: number): Frame => ({
		start,
		endsUnbounded: false,
		hasAtom: false,
		lookaround: isLookaround(pattern, start),
		open: undefined,
		loose: false,
		branches: [],
		branchFrom,
		plain: true,
	});
	const frames: Frame[] = [frameAt(0, 0)];
	const current = (): Frame => frames[frames.length - 1] as Frame;

	/** Take one atom and its quantifier; returns the quantifier's length. */
	const atom = (text: string, at: number, literal: boolean): number => {
		const frame = current();
		const quantifier = repeatAt(pattern, at);
		frame.hasAtom = true;
		frame.plain = frame.plain && literal && quantifier.repeat === "none";
		if (quantifier.repeat === "variable") {
			frame.endsUnbounded = isUnbounded(quantifier.text);
			frame.open = { text };
		} else if (quantifier.repeat === "nullable") {
			// `?` consumes nothing, so it neither pins the run before it nor stands in its way.
			frame.endsUnbounded = false;
		} else {
			frame.endsUnbounded = false;
			if (frame.open) {
				// A required atom is the only thing that pins a split, and one the open variable could
				// have matched itself pins nothing: `(a+a)` is that, and `(a+b)` is not.
				if (overlaps(frame.open, { text })) frame.loose = true;
				frame.open = undefined;
			}
		}
		return quantifier.text.length;
	};

	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i] as string;
		if (char === "\\") {
			i += 1 + atom(pattern.slice(i, i + 2), i + 2, false);
			continue;
		}
		if (char === "[") {
			const end = classEnd(pattern, i);
			i = end + atom(pattern.slice(i, end + 1), end + 1, false);
			continue;
		}
		if (char === "(") {
			// `(?:` is the group's own prefix, not an element of its body.
			const prefix = pattern[i + 1] === "?" && pattern[i + 2] === ":" ? 2 : 0;
			frames.push(frameAt(i, i + 1 + prefix));
			i += prefix;
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
			closed.branches.push({
				text: pattern.slice(closed.branchFrom, i),
				plain: closed.plain,
				loose: closed.open !== undefined || closed.loose,
			});
			const group = pattern.slice(closed.start, i + 1);
			const quantifier = repeatAt(pattern, i + 1);
			if (quantifier.repeat === "variable" && isUnbounded(quantifier.text)) {
				if (closed.endsUnbounded) return { group, why: REPEATED_TAIL };
				if (closed.branches.some((branch) => branch.loose)) {
					return { group, why: closed.branches.length > 1 ? AMBIGUOUS_BRANCHES : OPEN_TAIL };
				}
				if (plainAmbiguity(closed.branches)) return { group, why: AMBIGUOUS_BRANCHES };
			}
			const parent = current();
			parent.hasAtom = true;
			parent.plain = false;
			const absorbs = closed.branches.some((branch) => branch.loose);
			if (closed.lookaround) {
				parent.endsUnbounded = false;
			} else if (quantifier.repeat === "variable" || (absorbs && quantifier.repeat === "none")) {
				// A group that can absorb a run leaves the parent's split unpinned exactly as a
				// variable atom does, which is how `((a+))+` is `(a+)+`.
				parent.open = { text: group };
				parent.endsUnbounded = quantifier.repeat === "variable" ? isUnbounded(quantifier.text) : closed.endsUnbounded;
			} else if (quantifier.repeat === "none") {
				parent.endsUnbounded = closed.endsUnbounded;
				if (parent.open) {
					if (overlaps(parent.open, { text: group })) parent.loose = true;
					parent.open = undefined;
				}
			} else {
				// `?` — the group may match nothing, so the open variable keeps its freedom.
				parent.endsUnbounded = false;
			}
			i += quantifier.text.length;
			continue;
		}
		if (char === "|") {
			const frame = current();
			frame.branches.push({
				text: pattern.slice(frame.branchFrom, i),
				plain: frame.plain,
				loose: frame.open !== undefined || frame.loose,
			});
			frame.branchFrom = i + 1;
			frame.plain = true;
			frame.open = undefined;
			frame.loose = false;
			frame.endsUnbounded = false;
			continue;
		}
		if (char === "?" || char === "*" || char === "+" || char === "{") continue;
		if (char === "^" || char === "$") {
			current().plain = false;
			continue;
		}
		i += atom(char, i + 1, true);
	}
	return undefined;
}

/**
 * Whether the branches can match one text more than one way, which is `(a|aa)`, `(ab|ab)` and
 * `(a|b|ab)` — and not `(a|ab)`, `(GET|POST)`, `(a|bb)` or `(ab|cd)`, which each have one parse.
 *
 * Only literal branches take part: a branch carrying a quantifier is `loose` and is refused by
 * its own answer, and one carrying a group is left to the sample's honesty about its reach.
 */
function plainAmbiguity(branches: readonly Branch[]): boolean {
	const units = branches.filter((branch) => branch.plain).map((branch) => branch.text);
	return units.some((word) => parses(word, units) > 1);
}

/** How many ways `word` is a non-empty sequence of `units`, counted only as far as two. */
function parses(word: string, units: readonly string[]): number {
	const ways = new Array<number>(word.length + 1).fill(0);
	ways[0] = 1;
	for (let at = 0; at < word.length; at++) {
		const waysHere = ways[at] as number;
		if (waysHere === 0) continue;
		for (const unit of units) {
			if (unit.length === 0 || !word.startsWith(unit, at)) continue;
			ways[at + unit.length] = Math.min(2, (ways[at + unit.length] as number) + waysHere);
		}
	}
	return ways[word.length] as number;
}

/** Whether the `(` at `at` opens a lookaround, which consumes nothing. */
function isLookaround(pattern: string, at: number): boolean {
	if (pattern[at + 1] !== "?") return false;
	const kind = pattern[at + 2];
	if (kind === "=" || kind === "!") return true;
	return kind === "<" && (pattern[at + 3] === "=" || pattern[at + 3] === "!");
}

/** Where the character class starting at `at` ends, or the last index when it never closes. */
function classEnd(pattern: string, at: number): number {
	for (let i = at + 1; i < pattern.length; i++) {
		if (pattern[i] === "\\") i += 1;
		else if (pattern[i] === "]") return i;
	}
	return pattern.length - 1;
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
