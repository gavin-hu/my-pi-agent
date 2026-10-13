import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatTokens, sanitize, sanitizeLine, shortenPath, stripControlChars } from "./format.ts";

describe("formatTokens", () => {
	test("scales at each boundary", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(34000)).toBe("34k");
		expect(formatTokens(2500000)).toBe("2.5M");
	});

	test("shows ? for a value that is not a number", () => {
		expect(formatTokens(Number.NaN)).toBe("?");
		expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("?");
	});
});

describe("sanitize", () => {
	test("collapses newlines, tabs, and runs of spaces", () => {
		expect(sanitize("a\nb\tc   d ")).toBe("a b c d");
	});

	test("is layout only: an escape sequence is left for the boundary to handle", () => {
		expect(sanitize("a\u001b[31mb")).toBe("a\u001b[31mb");
	});
});

describe("sanitizeLine", () => {
	test("neutralizes escapes and control characters, then collapses to one line", () => {
		expect(sanitizeLine("a\u001b[31mb\u009dc\n d ")).toBe("a [31mb c d");
	});

	test("replaces a lone control character and trims what it leaves behind", () => {
		expect(sanitizeLine("x\u0007")).toBe("x");
	});

	test("defuses an OSC title sequence from untrusted text", () => {
		expect(sanitizeLine("\u001b]0;title\u0007keep\ttab   here\n")).toBe("]0;title keep tab here");
	});
});

describe("stripControlChars", () => {
	test("replaces ESC and C1 control characters with spaces", () => {
		expect(stripControlChars("a\u001b[31mb\u009dc")).toBe("a [31mb c");
	});

	test("keeps newlines and tabs for multi-line rendering", () => {
		expect(stripControlChars("a\nb\tc")).toBe("a\nb\tc");
	});
});

describe("shortenPath", () => {
	test("replaces the home prefix only", () => {
		const home = homedir();
		expect(shortenPath(join(home, "projects", "x"))).toBe("~/projects/x");
		expect(shortenPath("/tmp/x")).toBe("/tmp/x");
	});

	test("does not shorten a sibling path sharing the prefix", () => {
		const home = homedir();
		const normalize = (value: string): string => value.replace(/\\/g, "/");
		// A sibling directory whose name merely starts with the home string.
		expect(shortenPath(`${home}-backup/x`)).toBe(normalize(`${home}-backup/x`));
		expect(shortenPath(home)).toBe("~");
	});
});
