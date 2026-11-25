/**
 * Pure text/number formatting shared across extensions, plus the one way a function's body
 * crosses into a page's bundle: {@link pageSource}.
 *
 * No terminal access and no theme: these turn numbers and text into the short
 * strings a renderer shows.
 */

import { homedir } from "node:os";

/**
 * A call through a module namespace, the shape the host's transpiler writes: `(0, _mod.member)`.
 *
 * The `(0, …)` wrapper is the transpiler's alone — nothing a body is written with produces one —
 * so this form is safe to rewrite wherever it appears.
 */
const NAMESPACE_CALL = /\(0, _[A-Za-z$][\w$]*\.([A-Za-z$][\w$]*)\)/g;

/**
 * The same namespace read as a value rather than called: `_mod.member`.
 *
 * This one cannot be told from the body's own name: a `_cache.value` written by the body reads
 * exactly the same, and the rewrite would leave `value` behind. So a spliced body names nothing
 * of its own with a leading underscore, and `test/spliced-bodies.test.ts` fails a body that
 * writes the `_x.member` form this eats — a page reading the wrong value is the failure, not a
 * ReferenceError, so nothing else would say so.
 *
 * The guard reads the whole source, a string literal included, because this rewrite does: a body
 * that needs to print such text builds it (`"_x" + ".member"`) rather than relying on a scan that
 * skipped quotes, which would bless the one form this still breaks.
 */
const NAMESPACE_READ = /(?<![\w$.])_[A-Za-z$][\w$]*\.([A-Za-z$][\w$]*)/g;

/** A default import through one, whose local name the transpiler did not keep. */
const NAMESPACE_DEFAULT = /(?<![\w$.])_[A-Za-z$][\w$]*\.default\b/;

/**
 * A function's source as a page's bundle receives it.
 *
 * The body is JavaScript on its own there: a fragment splices the helper's *body*, under its
 * own name, because a page has no import graph. The host loads an extension through a
 * transpiler, though, and it rewrites a call to an *imported* binding into a member of that
 * module's namespace — `sameLabel(a, b)` arrives as `(0, _sessionLabel.sameLabel)(a, b)` — so
 * a body written in one module and spliced from another called a name the page never has:
 * `_sessionLabel is not defined`, on the first paint, with every static check green, because
 * `bun`'s transpiler leaves the call site alone.
 *
 * So the member is written back to the name it exports, in both forms a body can use. A
 * default import cannot be named back — the transpiler keeps only `_mod.default` — and a body
 * that needs one belongs with it, so that is refused at load rather than served as a page that
 * throws on the first click.
 */
export function pageSource(fn: (...args: never[]) => unknown): string {
	const source = String(fn);
	if (NAMESPACE_DEFAULT.test(source)) {
		throw new Error("a spliced body may not call a default import: declare the helper in the body's own module");
	}
	return source.replace(NAMESPACE_CALL, "$1").replace(NAMESPACE_READ, "$1");
}

/**
 * Compact token count: `999`, `1.0k`, `12k`, `1.5M`, `12M`. `?` when not a
 * number. The `k` → `M` switch sits below a million so a count that would round
 * to `1000k` prints as `1.0M` instead.
 */
export function formatTokens(count: number): string {
	if (!Number.isFinite(count)) return "?";
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 999500) return `${Math.round(count / 1000)}k`;
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
 * A list in a sentence: `a, b, or c`, or the same with `and`.
 *
 * One body, because a refusal that names the lanes a card may move to, one that names the
 * fields a contract needs, and one that names the lanes a tool accepts are the same
 * sentence, and a second copy drifts on the comma.
 */
export function listOf(entries: readonly string[], conjunction: "or" | "and" = "or"): string {
	if (entries.length === 0) return "nothing";
	if (entries.length === 1) return entries[0] ?? "nothing";
	return `${entries.slice(0, -1).join(", ")}, ${conjunction} ${entries[entries.length - 1]}`;
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

/**
 * A coarse age, the way a reader says it: `now`, `3m`, `2h`, `5d`.
 *
 * One rule for both surfaces that print an age — a card's offer in the transcript, and
 * the same card on the page — so one fact cannot read `2h ago` in a tool result and `3h`
 * on the page. Its source crosses as `FORMAT_AGE_JS`, and a spliced body may spell none of
 * `.replace`'s replacement patterns (`test/spliced-bodies.test.ts`).
 */
export function formatAge(now: number, at: number): string {
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 45) return "now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return minutes + "m";
	const hours = Math.round(minutes / 60);
	if (hours < 24) return hours + "h";
	return Math.round(hours / 24) + "d";
}

/** {@link formatAge} as the page's bundle receives it. */
export const FORMAT_AGE_JS = pageSource(formatAge);

/**
 * An age as {@link formatAge} spells it, in the words a reader is told: `just now`, `3m ago`.
 *
 * It takes the age string rather than the two numbers because a page holds `formatAge` under the
 * name `ageText`; the body crosses as {@link AGE_WORDS_JS}, so it may call nothing but itself.
 */
export function ageWords(age: string): string {
	return age === "now" ? "just now" : age + " ago";
}

/** {@link ageWords} as the page's bundle receives it. */
export const AGE_WORDS_JS = pageSource(ageWords);

/** `1 tool`, `3 tools`: a tool count with the right word. */
export function formatToolCount(count: number): string {
	const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
	return `${formatCount(n)} ${n === 1 ? "tool" : "tools"}`;
}

/**
 * `1 owner`, `2 owners`.
 *
 * Its source crosses as `PLURAL_JS`, so a spliced body may spell none of `.replace`'s replacement
 * patterns (`test/spliced-bodies.test.ts`).
 */
export function plural(count: number, noun: string): string {
	return count + " " + noun + (count === 1 ? "" : "s");
}

/**
 * A body bounded to `limit` characters, the ellipsis included, so the answer never exceeds what the
 * caller allowed — a cap is a cap, whether it is a 200-character preview or a 4,000-character
 * message. Counted in characters rather than terminal columns: `tui/columns.ts`'s `clip` measures
 * columns, and every caller here bounds prose against a number of characters.
 */
export function clipText(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit - 1)}…`;
}

/**
 * How a reference to lines reads: `path:12`, or `path:12-30` when it names a span, then ` (old)` or
 * ` (new)` when the caller names the side the diff drew it on.
 *
 * A span is two numbers on one side of a diff, so one spelling has to serve the page's dialog, the
 * notice it sends and the tool that reads it back — a review that named its span three ways would be
 * three chances to disagree. It crosses into the page's bundle as {@link PATH_REF_JS}, so the bar,
 * the dialog and a thread label read the body the notice and the tool print rather than a copy of it.
 */
export function pathRef(rel: string, line: number, endLine?: number, side?: "new" | "old"): string {
	return `${rel}:${line}${endLine === undefined ? "" : `-${endLine}`}${side === undefined ? "" : ` (${side})`}`;
}

/** {@link pathRef} as the review page's bundle receives it. */
export const PATH_REF_JS = pageSource(pathRef);

/**
 * A field a card cannot keep because it is too long: the length it arrived at, the cap, and what
 * to trim.
 *
 * One body, because "must be at most 1000 characters" sent a caller back to guess at the number it
 * sent, and the guess is a whole turn: the sentence a refusal prints is where the edit is made.
 */
export function overLimit(what: string, length: number, limit: number): string {
	return `${what} is ${length} characters; the limit is ${limit} — trim ${length - limit}.`;
}

/**
 * The three refusals a path list earns, in the one wording both normalizers print.
 *
 * Only the sentence is shared: a caller keeps its own reading of the path — a claim resolves it
 * against the repository, a card's hint compares it lexically — and its own cap, which is why the
 * two that carry a value are functions and the fixed one is a constant.
 */
export function tooManyPaths(limit: number): string {
	return `at most ${limit} paths are allowed.`;
}

/** A path entry that cleans to nothing, or that its caller treats as empty. */
export const EMPTY_PATH = "every path must be a non-empty string.";

/** A path outside the repository, in the spelling the caller gave it. */
export function outsideRepository(path: string): string {
	return `path "${path}" is outside the repository.`;
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
 * renderer deterministic (and testable) against an injected home — which is also
 * what the page does, since `homedir` does not exist in a browser.
 *
 * {@link SHORTEN_PATH_JS} splices this body into the page's bundle, so it may spell
 * none of `.replace`'s replacement patterns.
 */
export function shortenPath(path: string, home: string = homedir()): string {
	const normalized = path.replace(/\\/g, "/");
	const root = home.replace(/\\/g, "/").replace(/\/+$/, "");
	if (!root) return normalized;
	if (normalized === root) return "~";
	return normalized.startsWith(root + "/") ? "~" + normalized.slice(root.length) : normalized;
}

/**
 * {@link shortenPath} as the page's bundle receives it.
 *
 * The page hands its own `home` down from the snapshot ({@link BoardView}), so the default
 * above never runs where `homedir` is not defined.
 */
export const SHORTEN_PATH_JS = pageSource(shortenPath);

/** A compact byte size for a listing or a report: `68 B`, `12.4 kB`, `1.5 MB`. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["kB", "MB", "GB", "TB"];
	let value = bytes;
	let index = -1;
	do {
		value /= 1024;
		index++;
	} while (value >= 1024 && index < units.length - 1);
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}
