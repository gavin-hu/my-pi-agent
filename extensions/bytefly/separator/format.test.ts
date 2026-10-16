import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { separatorLine } from "./format.ts";

describe("separatorLine", () => {
	test("renders one line of exactly the requested width", () => {
		for (const target of [0, 1, 5, 8, 9, 20, 40, 100]) {
			const lines = separatorLine(3, target, fakeTheme);
			expect(lines).toHaveLength(1);
			expect(visibleWidth(lines[0] ?? "")).toBe(Math.max(1, target));
		}
	});

	test("centers the label and names the turn", () => {
		expect(separatorLine(3, 41, fakeTheme)[0]).toBe("╌".repeat(16) + " turn 3 " + "╌".repeat(17));
	});

	test("degrades to a plain dashed rule when the label does not fit", () => {
		expect(separatorLine(12, 5, fakeTheme)[0]).toBe("╌".repeat(5));
	});

	test("paints the dashes and the label from their design roles", () => {
		expect(separatorLine(2, 12, coloringTheme)[0]).toBe(
			"[border]" + "╌".repeat(2) + "[muted] turn 2 " + "[border]" + "╌".repeat(2),
		);
	});

	test("insets the rule symmetrically by Pi's output pad", () => {
		const line = separatorLine(3, 41, fakeTheme, 2)[0] ?? "";
		expect(line.startsWith("  ")).toBe(true);
		expect(line.slice(2)).toContain("turn 3");
		// Two columns on the left, the rule fills the middle, two remain on the right.
		expect(visibleWidth(line)).toBe(39);
	});

	test("a pad never collapses or overflows a narrow line", () => {
		for (const width of [1, 2, 3, 5, 20]) {
			const line = separatorLine(3, width, fakeTheme, 8)[0] ?? "";
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(visibleWidth(line)).toBeGreaterThan(0);
		}
	});
});
