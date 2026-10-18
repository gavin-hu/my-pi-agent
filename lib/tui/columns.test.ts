import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { clip, clipMiddle, fitCells, flowCells, LABEL_WIDTH, labelLine, padTo, splitRow } from "./columns.ts";

/** A representative mix: ASCII, a CJK sample, and a themed string. */
const SAMPLES = ["Extensions", "日本語のリスト", "\u001b[31mred\u001b[39m text", "a", ""];

/** Column counts exercised by the width sweep. */
const WIDTHS = Array.from({ length: 115 }, (_, index) => index + 6);

describe("clip", () => {
	test("keeps text that fits and marks a cut with an ellipsis", () => {
		expect(clip("Extensions", 10)).toBe("Extensions");
		expect(stripTerminalSequences(clip("Extensions", 6))).toBe("Exten…");
	});

	test("never exceeds the width, even for wide and themed characters", () => {
		for (const width of WIDTHS) {
			for (const sample of SAMPLES) {
				expect(visibleWidth(clip(sample, width))).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("clipMiddle", () => {
	test("keeps text that fits untouched", () => {
		expect(clipMiddle("example.com/retry", 40)).toBe("example.com/retry");
	});

	test("keeps the head and the tail of a long path", () => {
		const out = stripTerminalSequences(clipMiddle("https://example.com/docs/guides/retry-policy", 24));
		expect(out.startsWith("https://")).toBe(true);
		expect(out.endsWith("policy")).toBe(true);
		expect(out).toContain("…");
	});

	test("never exceeds the width, even for wide and themed characters", () => {
		for (const width of WIDTHS) {
			for (const sample of SAMPLES) {
				expect(visibleWidth(clipMiddle(sample, width))).toBeLessThanOrEqual(width);
			}
		}
	});

	test("keeps a themed string coloured on both halves", () => {
		const red = "\u001b[31m";
		const reset = "\u001b[39m";
		const out = clipMiddle(`${red}https://example.com/docs/retry-policy${reset}`, 24);
		expect(out.split(red).length - 1).toBeGreaterThanOrEqual(2);
		expect(visibleWidth(out)).toBeLessThanOrEqual(24);
	});

	test("degrades to a plain clip when there is no room for both ends", () => {
		expect(stripTerminalSequences(clipMiddle("example.com/retry", 1))).toBe("…");
		expect(visibleWidth(clipMiddle("example.com/retry", 2))).toBeLessThanOrEqual(2);
	});
});

describe("padTo", () => {
	test("pads to the exact width and leaves longer text untouched", () => {
		expect(visibleWidth(padTo("ab", 10))).toBe(10);
		expect(visibleWidth(padTo("abcdefghijkl", 4))).toBeGreaterThan(4);
	});

	test("treats a wide glyph as two columns", () => {
		expect(visibleWidth(padTo("日本", 6))).toBe(6);
	});
});

describe("labelLine", () => {
	test("collapses to one line and clips at the label width", () => {
		expect(labelLine("a\nb\tc")).toBe("a b c");
		expect(labelLine("a\u0007b")).toBe("a b");
		expect(visibleWidth(labelLine("x".repeat(LABEL_WIDTH + 20)))).toBe(LABEL_WIDTH);
	});

	test("uses the sanitizer it is given", () => {
		expect(labelLine("a\u0007b", () => "kept")).toBe("kept");
	});
});

describe("splitRow", () => {
	test("pushes the right cell to the edge with the gap between", () => {
		const line = splitRow("ab", "yz", 10);
		expect(line).toBe("ab" + " ".repeat(6) + "yz");
		expect(visibleWidth(line)).toBe(10);
	});

	test("clips the left cell before the right anchor", () => {
		const line = splitRow("a-very-long-left-cell", "right", 12);
		expect(line.endsWith("right")).toBe(true);
		expect(visibleWidth(line)).toBe(12);
	});

	test("keeps the right anchor when only it fits", () => {
		expect(stripTerminalSequences(splitRow("left", "a-long-right-anchor", 8))).toBe("a-long-…");
	});

	test("an empty right cell means no trailing padding", () => {
		expect(splitRow("left", "", 10)).toBe("left");
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			for (const sample of SAMPLES) {
				expect(visibleWidth(splitRow(sample, "yz", width))).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("flowCells", () => {
	test("packs whole cells greedily and wraps at the width", () => {
		expect(flowCells(["a", "b", "c"], 2)).toEqual(["ab", "c"]);
	});

	test("keeps every cell when they all fit", () => {
		expect(flowCells(["a", "b", "c"], 10)).toEqual(["abc"]);
	});

	test("clips an over-wide cell instead of splitting it", () => {
		const lines = flowCells(["wide-cell"], 4);
		expect(lines).toHaveLength(1);
		expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(4);
	});

	test("always returns at least one line", () => {
		expect(flowCells([], 10)).toEqual([""]);
	});

	test("every line fits the width", () => {
		const cells = [" alpha ", " beta ", " gamma ", " delta "];
		for (const width of WIDTHS) {
			for (const line of flowCells(cells, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("fitCells", () => {
	test("drops trailing cells whole instead of clipping one", () => {
		expect(fitCells(["alpha", "beta", "gamma"], 11)).toBe("alpha beta");
	});

	test("keeps the first cell even when it alone overflows", () => {
		expect(stripTerminalSequences(fitCells(["a-very-long-first-cell"], 8))).toBe("a-very-…");
	});

	test("honours a custom separator", () => {
		expect(fitCells(["alpha", "beta"], 9, " \u00b7 ")).toBe("alpha");
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			expect(visibleWidth(fitCells(["alpha", "beta", "gamma", "delta"], width, " | "))).toBeLessThanOrEqual(width);
		}
	});
});
