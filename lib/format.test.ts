import { describe, expect, test } from "bun:test";
import { formatTokens, sanitize, stripControlChars } from "./format.ts";

describe("formatTokens", () => {
	test("scales at each boundary", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(34000)).toBe("34k");
		expect(formatTokens(2500000)).toBe("2.5M");
	});
});

describe("sanitize", () => {
	test("collapses newlines, tabs, and runs of spaces", () => {
		expect(sanitize("a\nb\tc   d ")).toBe("a b c d");
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
