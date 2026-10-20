import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { GLYPHS } from "./glyphs.ts";
import { checkbox, chip, emptyState, keyValueRow, listRow, statusRow } from "./rows.ts";

/** Column counts exercised by the width sweep. */
const WIDTHS = Array.from({ length: 115 }, (_, index) => index + 6);

describe("listRow", () => {
	test("reserves the marker column whether or not the row is selected", () => {
		const plain = listRow(fakeTheme, 20, { label: "alpha" });
		const selected = listRow(fakeTheme, 20, { label: "alpha", selected: true });
		expect(visibleWidth(plain)).toBe(visibleWidth(selected));
		expect(selected).toContain("❯");
		expect(plain).not.toContain("❯");
	});

	test("drops the marker column when marker is false", () => {
		expect(stripTerminalSequences(listRow(fakeTheme, 20, { label: "alpha", marker: false }))).toBe("alpha");
		expect(stripTerminalSequences(listRow(fakeTheme, 20, { label: "x", glyph: "✓", marker: false }))).toBe("✓ x");
	});

	test("right-aligns the trailing meta", () => {
		const line = listRow(fakeTheme, 20, { label: "alpha", trailing: "12" });
		expect(line.endsWith("12")).toBe(true);
		expect(visibleWidth(line)).toBe(20);
	});

	test("renders a glyph and an indent before the label", () => {
		const line = stripTerminalSequences(listRow(fakeTheme, 20, { label: "x", glyph: "◼", indent: 2 }));
		expect(line).toBe("  " + "  " + "◼ x");
	});

	test("renders a pre-themed leading cell between the marker and the glyph", () => {
		const line = stripTerminalSequences(listRow(fakeTheme, 20, { label: "x", leading: "◼", glyph: "✓" }));
		expect(line).toBe("  " + "◼ ✓ x");
	});

	test("paints the label with its role", () => {
		expect(listRow(coloringTheme, 12, { label: "x", labelRole: "title" })).toBe("  [accent]x");
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			expect(
				visibleWidth(listRow(fakeTheme, width, { label: "a-very-long-label", trailing: "meta" })),
			).toBeLessThanOrEqual(width);
		}
	});
});

describe("statusRow", () => {
	test("passes the label role through, so a list can accent its focused row", () => {
		const row = { glyph: "▸", glyphRole: "ok" as const, label: "x", trailing: "" };
		expect(statusRow(coloringTheme, 30, { ...row, labelRole: "accent" })).toContain("[accent]x");
		expect(stripTerminalSequences(statusRow(fakeTheme, 30, row))).toBe("  ▸ x");
	});
});

describe("checkbox", () => {
	test("uses one glyph per state", () => {
		expect(checkbox(fakeTheme, true)).toBe(GLYPHS.boxOn);
		expect(checkbox(fakeTheme, false)).toBe(GLYPHS.boxOff);
	});

	test("paints on with success and off with faint", () => {
		expect(checkbox(coloringTheme, true)).toBe(`[success]${GLYPHS.boxOn}`);
		expect(checkbox(coloringTheme, false)).toBe(`[dim]${GLYPHS.boxOff}`);
	});

	test("honours an override role", () => {
		expect(checkbox(coloringTheme, true, { on: "accent" })).toBe(`[accent]${GLYPHS.boxOn}`);
	});
});

describe("chip", () => {
	test("joins a glyph and its label", () => {
		expect(stripTerminalSequences(chip(fakeTheme, "⎇", "main"))).toBe("⎇ main");
	});

	test("renders a glyph alone when there is no label", () => {
		expect(chip(fakeTheme, "⎇", "")).toBe("⎇");
	});

	test("paints both parts with one role", () => {
		expect(chip(coloringTheme, "⎇", "main", "ok")).toBe("[success]⎇ [success]main");
	});
});

describe("keyValueRow", () => {
	test("pads the label column to a fixed width, body-indented", () => {
		expect(keyValueRow(fakeTheme, 30, { label: "wechat", value: "on", labelWidth: 11 })).toBe(
			"  wechat" + " ".repeat(5) + "on",
		);
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			expect(visibleWidth(keyValueRow(fakeTheme, width, { label: "status", value: "connected" }))).toBeLessThanOrEqual(
				width,
			);
		}
	});
});

describe("emptyState", () => {
	test("returns a label line, and a hint line only when there is a hint", () => {
		expect(emptyState(fakeTheme, 30, { label: "No notes yet." })).toHaveLength(1);
		const both = emptyState(fakeTheme, 30, { label: "No notes yet.", hint: "Press a to add one." });
		expect(both).toHaveLength(2);
		expect(both[0]?.endsWith("No notes yet.")).toBe(true);
		expect(both[1]?.endsWith("Press a to add one.")).toBe(true);
	});

	test("paints the empty state faint, like the screens it replaces", () => {
		expect(emptyState(coloringTheme, 20, { label: "x" })[0]).toBe("  [dim]x");
	});

	test("every line fits the width", () => {
		for (const width of WIDTHS) {
			for (const line of emptyState(fakeTheme, width, { label: "No notes yet.", hint: "Press a to add one." })) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});
