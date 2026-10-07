import { describe, expect, test } from "bun:test";
import { formatTokens, sanitize } from "../../extensions/_shared/format.ts";

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
