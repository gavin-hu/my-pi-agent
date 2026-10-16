import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { dockListFrame, screenHint, viewportRows } from "./chrome.ts";
import { titleRule } from "./rules.ts";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";

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

	test("colors a primary hint while plain hints stay dim", () => {
		const line = screenHint(coloringTheme, 80, ["Esc close", { text: "a approve", color: "success" }]);
		expect(line).toContain("[dim]Esc close");
		expect(line).toContain("[success]a approve");
	});
});

describe("dockListFrame", () => {
	test("assembles the header, summary, body, and hint with the shared blanks", () => {
		const lines = dockListFrame({
			header: "Jobs ──────",
			summary: " 1 job",
			body: ["  a", "  b"],
			hint: "  Esc close",
		});

		expect(lines[0]).toBe("Jobs ──────");
		expect(lines.slice(1)).toEqual([" 1 job", "", "  a", "  b", "", "  Esc close", ""]);
	});

	test("omits the summary and its blank line when absent", () => {
		const lines = dockListFrame({ header: "Jobs", body: ["  a"], hint: "  Esc" });

		expect(lines.slice(1)).toEqual(["  a", "", "  Esc", ""]);
	});

	test("places the range after the body and the detail after the range", () => {
		const lines = dockListFrame({
			header: "Jobs",
			body: ["  a"],
			range: "  1/2",
			detail: ["  detail"],
			hint: "  Esc",
		});

		expect(lines.slice(1)).toEqual(["  a", "  1/2", "  detail", "", "  Esc", ""]);
	});

	test("keeps the caller's header and the hint inside the width", () => {
		for (const width of [1, 8, 20, 80]) {
			const lines = dockListFrame({
				header: titleRule(fakeTheme, width, "Extensions"),
				body: [],
				hint: screenHint(fakeTheme, width, ["Esc close"]),
			});

			expect(visibleWidth(lines[0])).toBe(Math.max(1, width));
			expect(visibleWidth(lines.at(-2) ?? "")).toBeLessThanOrEqual(width);
		}
	});
});
