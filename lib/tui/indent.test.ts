import { describe, expect, test } from "bun:test";
import { type Component, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { BODY_INDENT, bodyLines, indentBlockLines, indentedLines } from "./indent.ts";

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

	test("clips a body line with the requested suffix", () => {
		const [line] = indentBlockLines(["x".repeat(20)], 10, { indent: 2, bodyClip: "…" });
		expect(stripTerminalSequences(line ?? "").endsWith("…")).toBe(true);
		expect(visibleWidth(line ?? "")).toBeLessThanOrEqual(10);
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

	test("draws a rail glyph in the body's first indent column", () => {
		expect(indentBlockLines(["a", "b"], 40, { indent: 2, rail: "╎" })).toEqual(["╎ a", "╎ b"]);
	});

	test("keeps the headline un-railed and the rail at the base indent", () => {
		expect(indentBlockLines(["read", "a", "b"], 40, { indent: 2, rail: "╎", headline: true })).toEqual([
			"read",
			"╎ a",
			"╎ b",
		]);
	});

	test("places a base-indented rail under its headline", () => {
		expect(indentBlockLines(["read", "a"], 40, { indent: 4, rail: "╎", headline: true })).toEqual(["  read", "  ╎ a"]);
	});

	test("ignores a rail below BODY_INDENT", () => {
		expect(indentBlockLines(["a"], 40, { indent: 1, rail: "╎" })).toEqual([" a"]);
	});

	test("keeps a call's continuation lines unrailed", () => {
		expect(
			indentBlockLines(["edit", "src/a/long/path.ts", "", "-1 a", "+1 b"], 40, {
				indent: 2,
				rail: "╎",
				headline: true,
				railAfterCall: true,
			}),
		).toEqual(["edit", "  src/a/long/path.ts", "╎ ", "╎ -1 a", "╎ +1 b"]);
	});

	test("rails everything when the call has no blank separator", () => {
		expect(
			indentBlockLines(["edit", "a", "b"], 40, { indent: 2, rail: "╎", headline: true, railAfterCall: true }),
		).toEqual(["edit", "  a", "  b"]);
	});

	test("ignores railAfterCall without a rail", () => {
		expect(indentBlockLines(["edit", "a", "", "b"], 40, { indent: 2, headline: true, railAfterCall: true })).toEqual([
			"edit",
			"  a",
			"  ",
			"  b",
		]);
	});

	test("starts the rail at the body when railAfterCall is off", () => {
		expect(indentBlockLines(["edit", "a", "", "b"], 40, { indent: 2, rail: "╎", headline: true })).toEqual([
			"edit",
			"╎ a",
			"╎ ",
			"╎ b",
		]);
	});
});

describe("bodyLines", () => {
	test("renders the inner at the width the indent leaves", () => {
		let seen = 0;
		bodyLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			20,
			3,
		);
		expect(seen).toBe(17);
	});

	test("leaves the lines unindented", () => {
		expect(bodyLines(innerOf(["a", "b"]), 40, 2)).toEqual(["a", "b"]);
	});

	test("renders nothing for an absent inner", () => {
		expect(bodyLines(undefined, 40, 2)).toEqual([]);
	});

	test("keeps at least one column for the body", () => {
		let seen = 0;
		bodyLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			1,
			4,
		);
		expect(seen).toBe(1);
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

	test("renders the inner at the width the rail leaves", () => {
		let seen = 0;
		indentedLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			20,
			{ indent: 2, rail: "╎" },
		);
		expect(seen).toBe(18);
	});

	test("rails the inner's lines", () => {
		expect(indentedLines(innerOf(["a", "b"]), 40, { indent: 2, rail: "╎" })).toEqual(["╎ a", "╎ b"]);
	});
});
