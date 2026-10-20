import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	formatCount,
	formatDuration,
	formatToolCount,
	formatTokens,
	lineOf,
	MAX_OUTPUT_LINE,
	sanitize,
	sanitizeLine,
	sanitizeUntrustedLine,
	sanitizeUntrustedText,
	shortenPath,
	stripControlChars,
} from "./format.ts";

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

describe("lineOf", () => {
	test("sanitizes a string and reads any other value as empty", () => {
		expect(lineOf(" a\u001b[31mb\n")).toBe("a [31mb");
		expect(lineOf(undefined)).toBe("");
		expect(lineOf(7)).toBe("");
	});
});

describe("sanitizeUntrustedLine", () => {
	test("removes whole ANSI colour sequences, not their printable tail", () => {
		expect(sanitizeUntrustedLine("\u001b[31mred\u001b[0m")).toBe("red");
		expect(sanitizeUntrustedLine("\u001b[1;32mbold green\u001b[0m")).toBe("bold green");
	});

	test("removes an OSC sequence closed by BEL or by ST", () => {
		expect(sanitizeUntrustedLine("\u001b]0;title\u0007after")).toBe("after");
		expect(sanitizeUntrustedLine("\u001b]8;;https://pi.dev\u001b\\link\u001b]8;;\u001b\\")).toBe("link");
	});

	test("removes a single-character escape", () => {
		expect(sanitizeUntrustedLine("a\u001bMb")).toBe("ab");
	});

	test("resolves carriage-return progress to the final segment", () => {
		expect(sanitizeUntrustedLine("10%\r50%\r100% done")).toBe("100% done");
	});

	test("replaces a remaining control character and a C1 byte, then squeezes whitespace", () => {
		expect(sanitizeUntrustedLine("a\u0007b\u009dc\td   e")).toBe("a b c d e");
	});

	test("clips to the default maximum", () => {
		const line = sanitizeUntrustedLine("x".repeat(500));
		expect(line.length).toBe(MAX_OUTPUT_LINE);
		expect(line.endsWith("…")).toBe(true);
	});

	test("clips to a caller's maximum", () => {
		expect(sanitizeUntrustedLine("abcdef", 4)).toBe("abc…");
		expect(sanitizeUntrustedLine("abc", 4)).toBe("abc");
	});
});

describe("sanitizeUntrustedText", () => {
	test("sanitizes each line independently and keeps the blank ones", () => {
		expect(sanitizeUntrustedText("ok\n\u001b[32mgreen\u001b[0m\n")).toEqual(["ok", "green", ""]);
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

	test("accepts an explicit home for a deterministic caller", () => {
		expect(shortenPath("/home/u/repo/x", "/home/u")).toBe("~/repo/x");
		expect(shortenPath("/other/repo", "/home/u")).toBe("/other/repo");
	});
});

describe("formatDuration", () => {
	test("formats milliseconds, seconds, minutes, and hours", () => {
		expect(formatDuration(450)).toBe("450ms");
		expect(formatDuration(3200)).toBe("3.2s");
		expect(formatDuration(65_000)).toBe("1m05s");
		expect(formatDuration(7_380_000)).toBe("2h03m");
	});

	test("never prints NaN for a missing duration", () => {
		expect(formatDuration(Number.NaN)).toBe("0ms");
		expect(formatDuration(-1)).toBe("0ms");
	});
});

describe("formatCount", () => {
	test("groups thousands deterministically", () => {
		expect(formatCount(999)).toBe("999");
		expect(formatCount(8000)).toBe("8,000");
		expect(formatCount(42478)).toBe("42,478");
		expect(formatCount(-42478)).toBe("-42,478");
		expect(formatCount(Number.NaN)).toBe("0");
	});
});

describe("formatToolCount", () => {
	test("uses the singular for one and the plural otherwise", () => {
		expect(formatToolCount(0)).toBe("0 tools");
		expect(formatToolCount(1)).toBe("1 tool");
		expect(formatToolCount(3)).toBe("3 tools");
	});

	test("treats an invalid or negative count as zero", () => {
		expect(formatToolCount(Number.NaN)).toBe("0 tools");
		expect(formatToolCount(-2)).toBe("0 tools");
	});
});
