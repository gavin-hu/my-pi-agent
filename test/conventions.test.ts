/**
 * The line bans: what a test file may not do, and what shipped source may not do.
 *
 * One engine, two lists. A `*.test.ts` may not reach for `mock.module`, a real timer, the
 * wall clock, a padding assertion, or a theme double of its own — each has a helper. Extension,
 * `lib/`, and `scripts/` source may not carry a `TODO`, a suppression comment, an `any`, or a
 * commented-out statement. A line opts out with `allow:<name>` when the matched text is genuine
 * content rather than a shortcut.
 */

import { win32 } from "node:path";
import { describe, expect, test } from "bun:test";
import { allowsAt } from "./helpers/comments.ts";
import { GLYPH_SEQUENCES, GLYPH_SPECS, GLYPHS } from "../lib/tui/glyphs.ts";
import { SCANNED_DIRS, SOURCE_DIRS, sourceFiles, filesIn, repo, textOf } from "./helpers/scan.ts";

/**
 * The two backslashes a separator escape is written with, and the one on either side that
 * would make a longer run — the fixture that *shows* the pattern is one string deeper, so
 * it is not a conversion. The separator comes from `node:path`, so the ban spells none.
 */
const ESCAPE = win32.sep.repeat(4);
const ONE = win32.sep.repeat(2);
const NOT_LONGER = `(?<!${ONE})${ESCAPE}(?!${ONE})`;
const TYPED_PAIR = new RegExp(`replaceAll\\(\\s*["'\`]${NOT_LONGER}["'\`]`);

/**
 * A native path converted to the POSIX spelling by hand, where `lib/path.ts`'s
 * `posixPath` owns that conversion for the whole package.
 *
 * A character class holding both separators (`[\\/]`) is deliberately not matched: it is
 * the "either separator" idiom, correct on every platform, and the tree has thirteen of
 * them — five of which are `lastSegment`'s own rule restated. Folding those is a
 * refactor, not a red case, and a ban that lands red or with thirteen allows holds nothing.
 */
const TYPED_SEPARATOR: Ban = {
	name: "hand-typed separator",
	matches: (line) => TYPED_PAIR.test(line),
	reason: "use posixPath() from lib/path.ts, or join() the segments",
};

/** Files whose violations are accepted with a stated reason. Keep this tiny. */
const EXEMPT_FILES = new Set<string>([]);

interface Ban {
	name: string;
	matches: (line: string) => boolean;
	reason: string;
}

const BANS: Ban[] = [
	{
		name: "mock.module",
		matches: (line) => /\bmock\.(module|restore)\s*\(/.test(line),
		reason: "use createFakePi or add a seam",
	},
	{
		name: "process.env write",
		matches: (line) =>
			/\bprocess\.env\s*(?:\.[A-Za-z_]\w*|\[\s*[^\]]+\s*\])\s*=(?!=)|\bdelete\s+process\.env\s*(?:\.[A-Za-z_]\w*|\[\s*[^\]]+\s*\])/.test(
				line,
			),
		reason: "use test/helpers/env.ts",
	},
	{
		name: "real timer",
		matches: (line) => /\bset(Timeout|Interval)\s*\(/.test(line),
		reason: "use settle() from test/helpers/process.ts",
	},
	{
		name: "wall clock",
		matches: (line) => /\bDate\.now\s*\(|\bnew\s+Date\s*\(/.test(line),
		reason: "inject makeClock() from test/helpers/clock.ts",
	},
	{
		name: "padding assertion",
		matches: (line) => /\b(?:toBe|toEqual|toContain|toMatch)\s*\(\s*[`"'][^`"'\n]* {3,}[^`"'\n]*[`"']/.test(line),
		reason: "assert fields/width/order, not column padding",
	},
	{
		name: "local theme double",
		matches: (line) => /\bfg\s*:/.test(line),
		reason: "use fakeTheme from test/helpers/fakes.ts",
	},
	{
		// A double is the one place a moved interface can hide: `as unknown as` skips every member, so
		// a fake that still answers the old shape typechecks forever (jack, #859/#860). The ban reads
		// what the cast names — a runtime interface — because 314 honest `as unknown as` casts live in
		// test files and a flat ban would only teach people to reach for the opt-out.
		name: "interface-cast",
		matches: (line) => /\bas\s+unknown\s+as\s+[A-Za-z_$][\w$]*Runtime\b/.test(line),
		reason: "declare the double against the interface (`Partial<Iface>`, or a `Pick<>`), so a moved member fails here",
	},
	TYPED_SEPARATOR,
];

/**
 * The same bans, on extension, `lib/`, and `scripts/` **source** (not `.test.ts`):
 * the half of `AGENTS.md` "Code quality" a line scan can hold. The capture
 * scripts are unshipped dev tooling, which is why they are not in `SCANNED_DIRS`
 * with the renderer and boundary scans, but they are still read as code.
 */
/**
 * A vocabulary glyph typed by hand where an import belongs. `lib/tui/glyphs.ts`
 * says keep each literal there and import it, and twenty sites had re-typed one,
 * so the rule was prose until this case existed.
 *
 * The glyphs the vocabulary declares `prose` (`→` between two versions) or
 * `ascii` (`!`, `?`) are left out: no scan can tell either from a sentence.
 */
const GLYPH_CHARS: readonly string[] = [
	...Object.entries(GLYPH_SPECS)
		.filter(([, facts]) => facts.prose !== true && facts.ascii !== true)
		.map(([name]) => GLYPHS[name as keyof typeof GLYPHS]),
	...GLYPH_SEQUENCES.spinner.frames,
];

/** A comment may illustrate a glyph; it draws nothing. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

const GLYPH_BAN: Ban = {
	name: "glyph",
	matches: (line) => !COMMENT_LINE.test(line) && GLYPH_CHARS.some((char) => line.includes(char)),
	reason: "import it from lib/tui/glyphs.ts",
};

/**
 * Surfaces that draw a browser page or a CSS rule rather than a terminal cell. A
 * mark inside `content:"\u25b8"` is a font glyph: it spends no column and agrees with
 * no vocabulary, so the ban does not reach it.
 */
const WEB_SURFACE: readonly string[] = [
	"lib/web/",
	"extensions/board/view/",
	"extensions/code-review/view/",
	"extensions/file-browse/view/html",
	"extensions/file-browse/view/styles",
	"extensions/plan/web-",
];

/** One file's bans: the glyph case skips its own owner and the browser surfaces. */
function bansFor(file: string): Ban[] {
	const relative = file.slice(repo.length + 1);
	const ownsLiterals = relative === "lib/tui/glyphs.ts" || WEB_SURFACE.some((prefix) => relative.startsWith(prefix));
	return ownsLiterals ? SOURCE_BANS.filter((ban) => ban !== GLYPH_BAN) : SOURCE_BANS;
}

const SOURCE_BANS: Ban[] = [
	{
		name: "todo",
		matches: (line) => /\b(?:TODO|FIXME|HACK|XXX)\b/.test(line),
		reason: "do it, or file a card on the board",
	},
	{
		name: "suppression",
		matches: (line) => /@ts-(?:ignore|expect-error|nocheck)|biome-ignore|eslint-disable/.test(line),
		reason: "fix the type or the rule, or state the exception in a comment",
	},
	{
		name: "any",
		matches: (line) => /\bas\s+any\b|:\s*any\b|<any>|\bany\[\]/.test(line),
		reason: "use unknown at the boundary, or name the host type",
	},
	{
		// Prose comments are not code: these are the shapes a commented-out statement
		// takes, and `// for the duration of a call` is the case they must not match.
		name: "commented-code",
		matches: (line) =>
			/^\s*\/\/\s*(?:const|let|var|return|import|export|function|class|interface|enum|await)\b/.test(line) ||
			/^\s*\/\/\s*(?:if|for|while|switch)\s*\(/.test(line) ||
			/^\s*\/\/\s*\}/.test(line),
		reason: "delete it; git has the version that worked",
	},
	TYPED_SEPARATOR,
	GLYPH_BAN,
];

/**
 * Lines in `file` that match one of `bans`, as `path:line: alert (reason)`.
 * A line may opt out of one ban with an `allow:<name>` comment on that line or
 * in the comment block directly above it, when the matched text is genuine
 * content (a whitespace-normalisation assertion, a host seam no shared type can
 * name) and not a shortcut.
 */
function scanBans(file: string, bans: Ban[] = BANS, exempt: Set<string> = EXEMPT_FILES): string[] {
	if (exempt.has(file)) return [];
	const relative = file.slice(repo.length + 1);
	const violations: string[] = [];
	const lines = textOf(file).split("\n");
	lines.forEach((line, index) => {
		for (const ban of bans) {
			if (allowsAt(lines, index, `allow:${ban.name}`)) continue;
			if (ban.matches(line)) violations.push(`${relative}:${index + 1}: ${ban.name} (${ban.reason})`);
		}
	});
	return violations;
}

describe("test conventions", () => {
	test("test files avoid the banned test patterns", () => {
		const offenders: string[] = [];
		for (const dir of SCANNED_DIRS) {
			for (const file of filesIn(dir)) {
				if (file.endsWith(".test.ts")) offenders.push(...scanBans(file));
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("source conventions", () => {
	test("the glyph case catches a re-typed literal, and not a comment or prose", () => {
		// A gate that fires on nothing is the failure this case exists to refuse: the
		// sweep below it would read green either way.
		expect(GLYPH_BAN.matches(`text: "${GLYPHS.check} done"`)).toBe(true);
		expect(GLYPH_BAN.matches(`const ok = "⬥";`)).toBe(true);
		expect(GLYPH_BAN.matches(` * draws ${GLYPHS.check} when the row is green`)).toBe(false);
		expect(GLYPH_BAN.matches(`  "v1 ${GLYPHS.arrow} v2"`)).toBe(false);
	});

	test("source avoids the banned patterns", () => {
		const offenders: string[] = [];
		for (const dir of SOURCE_DIRS) {
			for (const file of sourceFiles(dir)) offenders.push(...scanBans(file, bansFor(file)));
		}
		expect(offenders).toEqual([]);
	});
});
