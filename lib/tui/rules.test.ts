import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { centeredRule, plainRule, sectionRule, titleRule } from "./rules.ts";

/** Column counts exercised by the width sweep. */
const WIDTHS = Array.from({ length: 115 }, (_, index) => index + 6);

describe("plainRule", () => {
	test("is a full fill of the width", () => {
		expect(plainRule(fakeTheme, 4)).toBe("─".repeat(4));
		expect(visibleWidth(plainRule(fakeTheme, 37))).toBe(37);
	});

	test("never renders zero columns", () => {
		expect(visibleWidth(plainRule(fakeTheme, 0))).toBe(1);
	});
});

describe("titleRule", () => {
	test("puts the label first and fills to the edge", () => {
		expect(titleRule(fakeTheme, 12, "Docs")).toBe("Docs" + " " + "─".repeat(7));
	});

	test("degrades to a plain rule rather than truncating the label", () => {
		expect(titleRule(fakeTheme, 6, "Extensions")).toBe("─".repeat(6));
	});

	test("trims the label and skips an empty one", () => {
		expect(titleRule(fakeTheme, 12, "  Docs  ")).toBe("Docs" + " " + "─".repeat(7));
		expect(titleRule(fakeTheme, 6, "   ")).toBe("─".repeat(6));
	});

	test("paints the label with the title role", () => {
		expect(titleRule(coloringTheme, 6, "Doc")).toBe("[accent]Doc" + " " + "[borderMuted]──");
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS)
			expect(visibleWidth(titleRule(fakeTheme, width, "Extensions"))).toBeLessThanOrEqual(width);
	});
});

describe("sectionRule", () => {
	test("uses the muted label role and keeps the shape", () => {
		expect(sectionRule(coloringTheme, 8, "Task")).toBe("[muted]Task" + " " + "[borderMuted]" + "─".repeat(3));
	});
});

describe("centeredRule", () => {
	test("centers the label between the fill", () => {
		expect(centeredRule(fakeTheme, 10, "x")).toBe("─".repeat(3) + " x " + "─".repeat(4));
	});

	test("gives the odd spare column to the right", () => {
		expect(centeredRule(fakeTheme, 12, "x")).toBe("─".repeat(4) + " x " + "─".repeat(5));
	});

	test("degrades to a plain rule when the label does not fit", () => {
		expect(centeredRule(fakeTheme, 4, "turn 1")).toBe("─".repeat(4));
	});

	test("honours the glyph, padding, and roles", () => {
		expect(centeredRule(coloringTheme, 11, "turn 1", { glyph: "╌", pad: 0, labelRole: "accent" })).toBe(
			"[border]" + "╌".repeat(2) + "[accent]turn 1[border]" + "╌".repeat(3),
		);
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			expect(visibleWidth(centeredRule(fakeTheme, width, "turn 123"))).toBeLessThanOrEqual(width);
			expect(stripTerminalSequences(centeredRule(fakeTheme, width, "turn 123")).length).toBeGreaterThan(0);
		}
	});
});
