import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { separatorLabel, separatorLine, separatorParts } from "./format.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

const width = (parts: { left: string; label: string; right: string }) =>
	visibleWidth(parts.left) + visibleWidth(parts.label) + visibleWidth(parts.right);

describe("separatorParts", () => {
	test("fills exactly the requested width", () => {
		for (const target of [1, 5, 8, 9, 20, 40, 100]) {
			expect(width(separatorParts(3, target))).toBe(target);
		}
	});

	test("centers the label", () => {
		const parts = separatorParts(3, 41);
		expect(parts.label).toBe(" turn 3 ");
		expect(parts.left).toBe("╌".repeat(16));
		expect(parts.right).toBe("╌".repeat(17));
	});

	test("degrades to dashes when the label does not fit", () => {
		expect(separatorParts(12, 5)).toEqual({ left: "╌╌╌╌╌", label: "", right: "" });
	});

	test("never returns a zero-width line", () => {
		expect(width(separatorParts(1, 0))).toBe(1);
	});
});

describe("separatorLabel", () => {
	test("includes the turn number and padding", () => {
		expect(separatorLabel(7)).toBe(" turn 7 ");
	});
});

describe("separatorLine", () => {
	test("renders one line of the requested width and names the turn", () => {
		const lines = separatorLine(2, 30, fakeTheme);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("turn 2");
		expect(visibleWidth(lines[0])).toBe(30);
	});
});
