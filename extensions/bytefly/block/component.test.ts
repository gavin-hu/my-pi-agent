import { describe, expect, test } from "bun:test";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { RAIL } from "../../../lib/tui/rail.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { blockStatus, toolBlockLines } from "./component.ts";

/** A stand-in for a tool's own renderer, recording the width it was asked for. */
const innerOf = (lines: string[], onWidth?: (width: number) => void): Component => ({
	render: (width) => {
		onWidth?.(width);
		return lines;
	},
	invalidate: () => {},
});

describe("blockStatus", () => {
	test("is info while partial, bad on error, ok otherwise", () => {
		expect(blockStatus({ isPartial: true, isError: false })).toBe("info");
		expect(blockStatus({ isPartial: false, isError: true })).toBe("bad");
		expect(blockStatus({ isPartial: false, isError: false })).toBe("ok");
	});
});

describe("toolBlockLines", () => {
	test("prefixes every line with the rail", () => {
		expect(toolBlockLines(innerOf(["one", "two"]), "ok", fakeTheme, 40, 0)).toEqual([`${RAIL} one`, `${RAIL} two`]);
	});

	test("indents by outputPad", () => {
		expect(toolBlockLines(innerOf(["x"]), "ok", fakeTheme, 40, 2)[0]).toBe(`  ${RAIL} x`);
	});

	test("paints the rail in the status role", () => {
		expect(toolBlockLines(innerOf(["x"]), "bad", coloringTheme, 40, 0)[0]).toContain(`[error]${RAIL}`);
	});

	test("renders the inner at the reduced width", () => {
		let seen = 0;
		toolBlockLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			"ok",
			fakeTheme,
			20,
			1,
		);
		expect(seen).toBe(17);
	});

	test("drops trailing lines with no content", () => {
		expect(toolBlockLines(innerOf(["a", ""]), "ok", fakeTheme, 40, 0)).toEqual([`${RAIL} a`]);
	});

	test("renders nothing for an absent inner", () => {
		expect(toolBlockLines(undefined, "ok", fakeTheme, 40, 0)).toEqual([]);
	});

	test("passes an image sequence through unprefixed", () => {
		const image = "\u001b_Gabc";
		expect(toolBlockLines(innerOf([image]), "ok", fakeTheme, 40, 0)).toEqual([image]);
	});

	test("clips every line to the width it was given", () => {
		for (const line of toolBlockLines(innerOf(["x".repeat(100)]), "ok", fakeTheme, 10, 0)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(10);
		}
	});
});
