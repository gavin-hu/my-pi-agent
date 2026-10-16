import { describe, expect, test } from "bun:test";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { GLYPHS } from "./glyphs.ts";
import { RAIL, RAIL_GAP, RAIL_ROLES, railBlockLines, railLines, railPrefix, railWidth } from "./rail.ts";

/** A stand-in for a tool's own renderer, recording the width it was asked for. */
const innerOf = (lines: string[], onWidth?: (width: number) => void): Component => ({
	render: (width) => {
		onWidth?.(width);
		return lines;
	},
	invalidate: () => {},
});

describe("RAIL", () => {
	test("is the shared glyph, one neutral column", () => {
		expect(RAIL).toBe(GLYPHS.rail);
		expect(visibleWidth(RAIL)).toBe(1);
		expect(RAIL_GAP).toBe(1);
	});
});

describe("RAIL_ROLES", () => {
	test("maps a finished rail to neutral and keeps warn and bad for attention", () => {
		expect(RAIL_ROLES).toEqual({ info: "info", ok: "faint", warn: "warn", bad: "bad" });
	});
});

describe("railWidth / railPrefix", () => {
	test("adds the gap and the indent", () => {
		expect(railWidth(0)).toBe(2);
		expect(railWidth(3)).toBe(5);
		expect(railWidth(-4)).toBe(2);
	});

	test("paints the rail in the role, after the indent", () => {
		expect(railPrefix(coloringTheme, "bad")).toBe(`[error]${RAIL} `);
		expect(railPrefix(coloringTheme, "ok", 2)).toBe(`  [success]${RAIL} `);
	});
});

describe("railBlockLines", () => {
	test("prefixes every line with the rail", () => {
		expect(railBlockLines(["one", "two"], "ok", fakeTheme, 40)).toEqual([`${RAIL} one`, `${RAIL} two`]);
	});

	test("indents by the option", () => {
		expect(railBlockLines(["x"], "ok", fakeTheme, 40, { indent: 2 })[0]).toBe(`  ${RAIL} x`);
	});

	test("paints the rail in the given role", () => {
		expect(railBlockLines(["x"], "bad", coloringTheme, 40)[0]).toContain(`[error]${RAIL}`);
	});

	test("drops trailing lines with no content", () => {
		expect(railBlockLines(["a", "", "b", ""], "ok", fakeTheme, 40)).toEqual([`${RAIL} a`, `${RAIL} `, `${RAIL} b`]);
	});

	test("treats a background-padded line as blank when trimming", () => {
		const padded = "\u001b[49m      \u001b[49m";
		expect(railBlockLines(["a", padded], "ok", fakeTheme, 40)).toEqual([`${RAIL} a`]);
	});

	test("keeps a leading blank by default", () => {
		expect(railBlockLines(["", "a"], "ok", fakeTheme, 40)).toEqual([`${RAIL} `, `${RAIL} a`]);
	});

	test("drops leading blanks when asked", () => {
		expect(railBlockLines(["", "a", ""], "ok", fakeTheme, 40, { trimLeading: true })).toEqual([`${RAIL} a`]);
	});

	test("keeps trailing blanks when asked", () => {
		expect(railBlockLines(["a", ""], "ok", fakeTheme, 40, { trimTrailing: false })).toEqual([`${RAIL} a`, `${RAIL} `]);
	});

	test("passes an image sequence through unprefixed", () => {
		const image = "\u001b_Gabc";
		expect(railBlockLines([image], "ok", fakeTheme, 40)).toEqual([image]);
	});

	test("clips every line to the width it was given", () => {
		for (const line of railBlockLines(["x".repeat(100)], "ok", fakeTheme, 10)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(10);
		}
	});
});

describe("railLines", () => {
	test("renders the inner at the reduced width", () => {
		let seen = 0;
		railLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			"ok",
			fakeTheme,
			20,
			{ indent: 1 },
		);
		expect(seen).toBe(17);
	});

	test("rails the inner's lines", () => {
		expect(railLines(innerOf(["a", "b"]), "ok", fakeTheme, 40)).toEqual([`${RAIL} a`, `${RAIL} b`]);
	});

	test("renders nothing for an absent inner", () => {
		expect(railLines(undefined, "ok", fakeTheme, 40)).toEqual([]);
	});
});
