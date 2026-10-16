import { describe, expect, test } from "bun:test";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { BODY_INDENT, indentBlockLines, indentedLines } from "./indent.ts";

/** A stand-in for a tool's own renderer, recording the width it was asked for. */
const innerOf = (lines: string[], onWidth?: (width: number) => void): Component => ({
	render: (width) => {
		onWidth?.(width);
		return lines;
	},
	invalidate: () => {},
});

describe("BODY_INDENT", () => {
	test("is two columns", () => {
		expect(BODY_INDENT).toBe(2);
	});
});

describe("indentBlockLines", () => {
	test("prefixes every line with the indent", () => {
		expect(indentBlockLines(["one", "two"], 40, { indent: 2 })).toEqual(["  one", "  two"]);
	});

	test("defaults to no indent", () => {
		expect(indentBlockLines(["one"], 40)).toEqual(["one"]);
	});

	test("drops trailing lines with no content", () => {
		expect(indentBlockLines(["a", "", "b", ""], 40, { indent: 2 })).toEqual(["  a", "  ", "  b"]);
	});

	test("treats a background-padded line as blank when trimming", () => {
		const padded = "\u001b[49m      \u001b[49m";
		expect(indentBlockLines(["a", padded], 40, { indent: 1 })).toEqual([" a"]);
	});

	test("keeps a leading blank by default", () => {
		expect(indentBlockLines(["", "a"], 40, { indent: 2 })).toEqual(["  ", "  a"]);
	});

	test("drops leading blanks when asked", () => {
		expect(indentBlockLines(["", "a", ""], 40, { indent: 2, trimLeading: true })).toEqual(["  a"]);
	});

	test("keeps trailing blanks when asked", () => {
		expect(indentBlockLines(["a", ""], 40, { indent: 2, trimTrailing: false })).toEqual(["  a", "  "]);
	});

	test("passes an image sequence through unprefixed", () => {
		const image = "\u001b_Gabc";
		expect(indentBlockLines([image], 40, { indent: 2 })).toEqual([image]);
	});

	test("clips every line to the width it was given", () => {
		for (const line of indentBlockLines(["x".repeat(100)], 10, { indent: 2 })) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(10);
		}
	});

	test("leads with a headline at the base and the body directly under it", () => {
		expect(indentBlockLines(["read src/cli.ts", "a", "b"], 40, { indent: 2, headline: true })).toEqual([
			"read src/cli.ts",
			"  a",
			"  b",
		]);
	});

	test("drops the body's own leading blank under a headline", () => {
		expect(
			indentBlockLines(["write src/a.ts", "", "body"], 40, { indent: 2, headline: true, trimLeading: true }),
		).toEqual(["write src/a.ts", "  body"]);
	});

	test("keeps interior blanks indented under a headline", () => {
		expect(indentBlockLines(["read", "a", "", "b"], 40, { indent: 2, headline: true })).toEqual([
			"read",
			"  a",
			"  ",
			"  b",
		]);
	});

	test("skips a leading blank when picking the headline", () => {
		expect(indentBlockLines(["", "read", "a"], 40, { indent: 2, headline: true })).toEqual(["read", "  a"]);
	});

	test("indents a headline at a base beyond zero", () => {
		const lines = indentBlockLines(["read", "a"], 40, { indent: 4, headline: true });
		expect(lines[0]).toBe(`${" ".repeat(2)}read`);
		expect(lines[1]).toBe(`${" ".repeat(4)}a`);
	});

	test("never moves a headline left of the margin", () => {
		expect(indentBlockLines(["read", "a"], 40, { indent: 1, headline: true })).toEqual(["read", " a"]);
	});

	test("emits only the headline for a headline-only block", () => {
		expect(indentBlockLines(["read"], 40, { indent: 2, headline: true })).toEqual(["read"]);
	});
});

describe("indentedLines", () => {
	test("renders the inner at the reduced width", () => {
		let seen = 0;
		indentedLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			20,
			{ indent: 3 },
		);
		expect(seen).toBe(17);
	});

	test("indents the inner's lines", () => {
		expect(indentedLines(innerOf(["a", "b"]), 40, { indent: 2 })).toEqual(["  a", "  b"]);
	});

	test("renders nothing for an absent inner", () => {
		expect(indentedLines(undefined, 40, { indent: 2 })).toEqual([]);
	});
});
