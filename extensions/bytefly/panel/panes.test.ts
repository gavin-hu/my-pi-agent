/**
 * The two-pane arithmetic: where the side pane starts, how wide each side is, how
 * one row of each is laid on one line, and how a block that does not fit says so.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../../test/helpers/fakes.ts";
import {
	clipRows,
	composeRow,
	composeRows,
	isWide,
	listWidth,
	sideWidth,
	SIDE_MAX,
	SIDE_MIN,
	WIDE_MIN,
} from "./tui/panes.ts";

describe("the pane breakpoint", () => {
	test("switches to two panes at the breakpoint, not before it", () => {
		expect(isWide(WIDE_MIN - 1)).toBe(false);
		expect(isWide(WIDE_MIN)).toBe(true);
		expect(isWide(200)).toBe(true);
	});

	test("keeps the side pane within its bounds and leaves the list the rest", () => {
		for (const width of [40, 96, 100, 120, 200]) {
			const side = sideWidth(width);
			expect(side).toBeGreaterThanOrEqual(SIDE_MIN);
			expect(side).toBeLessThanOrEqual(SIDE_MAX);
			expect(listWidth(width)).toBeGreaterThan(0);
			// The two panes, the divider, and its two gaps add up to the width.
			expect(listWidth(width) + side + 3).toBe(width);
		}
	});

	test("gives the side pane more room as the terminal grows", () => {
		expect(sideWidth(120)).toBeGreaterThan(sideWidth(100));
		expect(sideWidth(100)).toBe(42);
	});
});

describe("composing one line pair", () => {
	test("keeps the line inside the width and the list in its own column", () => {
		const line = composeRow(fakeTheme, 120, "row", "fact");

		expect(visibleWidth(line)).toBeLessThanOrEqual(120);
		expect(line.startsWith("row")).toBe(true);
		expect(line).toContain("fact");
		// The divider separates the two panes rather than trailing the line.
		expect(line.indexOf("╎")).toBeGreaterThan(line.indexOf("row"));
		expect(line.indexOf("fact")).toBeGreaterThan(line.indexOf("╎"));
	});

	test("trims a long list row before it reaches the divider", () => {
		const line = composeRow(fakeTheme, 120, "x".repeat(400), "fact");

		expect(visibleWidth(line)).toBeLessThanOrEqual(120);
		expect(line).toContain("fact");
	});

	test("pairs a body with a shorter block and keeps one line per body row", () => {
		const lines = composeRows(fakeTheme, 120, ["a", "b", "c"], ["first"]);

		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("first");
		expect(lines[1]).not.toContain("first");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(120);
	});
});

describe("clipping the block to its rows", () => {
	test("leaves a block that fits untouched", () => {
		expect(clipRows(["a", "b"], 4, 40)).toEqual(["a", "b"]);
	});

	test("counts what it left out", () => {
		const clipped = clipRows(["a", "b", "c", "d"], 3, 40);

		expect(clipped).toHaveLength(3);
		expect(clipped.at(-1)).toContain("2 more lines");
	});

	test("says one more line for one", () => {
		const clipped = clipRows(["a", "b", "c"], 2, 40);

		expect(clipped.at(-1)).toContain("2 more lines");
		expect(clipRows(["a", "b", "c", "d"], 4, 40).at(-1)).toBe("d");
	});

	test("draws nothing at all for no room", () => {
		expect(clipRows(["a", "b"], 0, 40)).toEqual([]);
	});
});
