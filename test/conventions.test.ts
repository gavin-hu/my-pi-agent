/**
 * The line bans: what a test file may not do, and what shipped source may not do.
 *
 * One engine, two lists. A `*.test.ts` may not reach for `mock.module`, a real timer, the
 * wall clock, a padding assertion, or a theme double of its own — each has a helper. Extension,
 * `lib/`, and `scripts/` source may not carry a `TODO`, a suppression comment, an `any`, or a
 * commented-out statement. A line opts out with `allow:<name>` when the matched text is genuine
 * content rather than a shortcut.
 */

import { describe, expect, test } from "bun:test";
import { allowsAt } from "./helpers/comments.ts";
import { SCANNED_DIRS, SOURCE_DIRS, sourceFiles, filesIn, repo, textOf } from "./helpers/scan.ts";

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
];

/**
 * The same bans, on extension, `lib/`, and `scripts/` **source** (not `.test.ts`):
 * the half of `AGENTS.md` "Code quality" a line scan can hold. The capture
 * scripts are unshipped dev tooling, which is why they are not in `SCANNED_DIRS`
 * with the renderer and boundary scans, but they are still read as code.
 */
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
	test("source avoids the banned patterns", () => {
		const offenders: string[] = [];
		for (const dir of SOURCE_DIRS) {
			for (const file of sourceFiles(dir)) offenders.push(...scanBans(file, SOURCE_BANS));
		}
		expect(offenders).toEqual([]);
	});
});
