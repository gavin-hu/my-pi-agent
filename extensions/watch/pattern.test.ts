/**
 * What `add` refuses before it starts a watcher, and what it keeps.
 *
 * Every number in a comment here was measured warm through `compileRegex` on one `$`-anchored
 * line that must fail to match — that is the cost the rule in `pattern.ts` exists for. The
 * cases sit beside the module they cover; `docs/extensions/watch.md` owns what the check
 * covers and what it misses.
 */

import { describe, expect, test } from "bun:test";
import { compileRegex } from "./pattern.ts";

describe("watch pattern gate", () => {
	test("compileRegex is case-insensitive by default and sensitive on request", () => {
		expect(compileRegex("error", false).test("ERROR")).toBe(true);
		expect(compileRegex("error", true).test("ERROR")).toBe(false);
	});

	test("refuses a group that repeats a repeat without a bound", () => {
		// `(a+)+` is exponential in the line it is run against, and a line comes from a file
		// nobody vouched for; the refusal names the shape and one rewrite.
		for (const pattern of ["(a+)+", "(a+)*", "(\\w+)+", "((a+))+", "(?:a+)+", "(a+){1,}", "x(a*){2,}y"]) {
			expect(() => compileRegex(pattern, false)).toThrow(/repeats \`.+\`, whose last element already repeats/);
		}
		// The sentence quotes the group, because nothing is rewritten for the caller: the
		// expression may be long and the offending repeat is what has to change.
		expect(() => compileRegex("x(a*){2,}y", false)).toThrow(/repeats \`\(a\*\)\`/);
		expect(() => compileRegex("(a+)+", false)).toThrow(/repeats \`\(a\+\)\`/);
	});

	test("refuses an iteration that can end more than one place", () => {
		// The tail is what unpins, and each of these was measured warm through `compileRegex` on
		// one `$`-anchored line that must fail to match: `(\w+\s?)+` 525 ms at 27 characters,
		// `(\w+[a-z]?)+` 508 ms at 27, `(a+a)+` 47 ms at 32, `(a{1,3})+` 376 ms at 32.
		for (const pattern of ["(\\w+\\s?)+", "(\\w+[a-z]?)+", "(a+a)+", "(a{1,3})+", "(\\w+a)+", "(\\w+\\d)+"]) {
			expect(() => compileRegex(pattern, false)).toThrow(/whose iterations can end more than one place/);
		}
		expect(() => compileRegex("(\\w+\\s?)+", false)).toThrow(/repeats \`\(\\w\+\\s\?\)\`/);
		// Overlap is the question and the class is the answer: `b` is a `[a-c]`, so the run before
		// it can swallow the character the iteration is supposed to end on.
		expect(() => compileRegex("([a-c]+b)+", false)).toThrow(/whose iterations can end more than one place/);
	});

	test("refuses branches that can match one text more than one way", () => {
		// The ambiguity is which branch took which piece, not how wide they are: `(a|aa)+` costs
		// 117 ms at 32 characters and `(ab|ab)+` 522 ms, while `(GET|POST)+` and `(a|bb)+` each
		// have one parse per text and stay.
		for (const pattern of ["(a|aa)+", "(\\w+|x)+", "(ab|ab)+", "(a|b|ab)+"]) {
			expect(() => compileRegex(pattern, false)).toThrow(/whose branches can match the same text/);
		}
		expect(() => compileRegex("(a|aa)+", false)).toThrow(/repeats \`\(a\|aa\)\`/);
	});

	test("keeps the patterns whose repeats cannot blow up", () => {
		// Each with one place an iteration can end, or none to choose: pinned by a separator
		// (`(\w+\s)+` costs 145 ms at 16 384 characters, the same as an unselective `\w+$`, so
		// its split holds), fixed inside (`(a{2})+`), literal (`\+`, `[+]`), nested without a
		// repeat (`(?:ab)+`), or one parse per text (`(a|ab)+`, `(GET|POST)+`, `(a|bb)+`).
		for (const pattern of [
			"(ab)+",
			"(a{2})+",
			"a+",
			"(\\w+\\s)+",
			"(a+)?",
			"[+]+",
			"\\(a+\\)+",
			"(a|b)+",
			"(?:ab)+",
			"(a|ab)+",
			"(GET|POST)+",
			"(a|bb)+",
			"(ab|cd)+",
			"(a+b)+",
			"(\\d+a)+",
			"x(a?){2,}y",
		]) {
			expect(() => compileRegex(pattern, false)).not.toThrow();
		}
	});
});
