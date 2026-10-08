import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { screenHeader, screenHint, viewportRows } from "../../lib/tui.ts";
import { fakeTheme } from "../helpers/fakes.ts";

describe("viewportRows", () => {
	const options = { chrome: 7, fallback: 12 };

	test("falls back when the terminal height is unknown", () => {
		expect(viewportRows(undefined, options)).toBe(12);
		expect(viewportRows(0, options)).toBe(12);
	});

	test("fills the terminal, subtracting the chrome", () => {
		expect(viewportRows(60, options)).toBe(53);
		expect(viewportRows(15, options)).toBe(8);
	});

	test("shrinks rather than overflowing on a short terminal", () => {
		expect(viewportRows(8, options)).toBe(1);
		expect(viewportRows(1, options)).toBe(1);
	});

	test("resolves a live getter so a resize is picked up", () => {
		let rows = 30;
		expect(viewportRows(() => rows, options)).toBe(23);
		rows = 15;
		expect(viewportRows(() => rows, options)).toBe(8);
		expect(viewportRows(() => undefined, options)).toBe(12);
	});
});

describe("screenHeader", () => {
	test("is exactly the requested width and includes the label", () => {
		for (const width of [1, 20, 60, 120]) {
			const line = screenHeader(fakeTheme, width, "Plan Review");
			expect(visibleWidth(line)).toBe(width);
		}
		expect(screenHeader(fakeTheme, 60, "Plan Review")).toContain("Plan Review");
	});

	test("degrades to a plain rule when too narrow for the label", () => {
		const line = screenHeader(fakeTheme, 4, "Checkpoints");
		expect(line).not.toContain("Checkpoints");
		expect(visibleWidth(line)).toBe(4);
	});
});

describe("screenHint", () => {
	test("joins hints with a middle dot under a two-space indent", () => {
		expect(screenHint(fakeTheme, 80, ["a", "b"])).toBe("  a · b");
	});

	test("drops a whole hint rather than truncating it, keeping the first", () => {
		const line = screenHint(fakeTheme, 10, ["alpha", "beta", "gamma"]);
		expect(line).toContain("alpha");
		expect(line).not.toContain("beta");
		expect(visibleWidth(line)).toBeLessThanOrEqual(10);
	});

	test("still returns the first hint when it alone overflows", () => {
		const line = screenHint(fakeTheme, 4, ["alpha", "beta"]);
		expect(visibleWidth(line)).toBeLessThanOrEqual(4);
	});
});
