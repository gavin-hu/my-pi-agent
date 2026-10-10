import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderLine } from "./layout.ts";
import { buildLines } from "./lines.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { fullSnapshot } from "../../test/helpers/fixtures/status-bar.ts";
import { GLYPHS } from "../../lib/ui.ts";

describe("renderLine", () => {
	test("fills the width and right-aligns the right zone", () => {
		const [line1] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const rendered = renderLine(line1, 100, fakeTheme);

		expect(visibleWidth(rendered)).toBe(100);
		expect(rendered).toContain("~/repo/project");
		expect(rendered).toContain("⎇ main");
		expect(rendered.endsWith("⑂ smoke")).toBe(true);
	});

	test("renders every resources segment at full width", () => {
		const [, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const rendered = renderLine(line2, 100, fakeTheme);

		expect(visibleWidth(rendered)).toBeLessThanOrEqual(100);
		for (const text of [`${GLYPHS.plan} plan`, "62%", "$0.31", "R96k CH 87%", "opus-4.5", "high"]) {
			expect(rendered).toContain(text);
		}
	});

	test("drops low-priority segments as the width shrinks", () => {
		const [, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const rendered = renderLine(line2, 40, fakeTheme);

		expect(visibleWidth(rendered)).toBeLessThanOrEqual(40);
		expect(rendered).toContain("62%");
		expect(rendered).not.toContain("R96k");
	});

	test("drops tokens before cost", () => {
		// Pins the documented order: cost outlives the token meter.
		const [, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const rendered = renderLine(line2, 60, fakeTheme);

		expect(rendered).toContain("$0.31");
		expect(rendered).not.toContain("↑42k");
	});

	test("never exceeds a very small width", () => {
		const [line1, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		expect(visibleWidth(renderLine(line1, 8, fakeTheme))).toBeLessThanOrEqual(8);
		expect(visibleWidth(renderLine(line2, 8, fakeTheme))).toBeLessThanOrEqual(8);
	});

	test("never glues adjacent segments together as the width shrinks", () => {
		// A dropped separator collapses to a single space, not to nothing, so a
		// segment boundary must always keep at least one column of padding.
		const [line1, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		for (let width = 6; width <= 120; width++) {
			for (const line of [line1, line2]) {
				const rendered = renderLine(line, width, fakeTheme);
				expect(visibleWidth(rendered)).toBeLessThanOrEqual(width);
				expect(rendered).not.toMatch(/%[⋮⑂⎇⚠]/);
				expect(rendered).not.toMatch(/\S│|│\S/);
			}
		}
	});

	test("right-aligns a right-only line", () => {
		const spec = {
			left: [],
			right: [{ id: "model", weight: 1, droppable: false, separator: "", forms: ["opus-4.5"] }],
		};
		const rendered = renderLine(spec as any, 20, fakeTheme);

		expect(visibleWidth(rendered)).toBe(20);
		expect(rendered.endsWith("opus-4.5")).toBe(true);
		expect(rendered.startsWith(" ")).toBe(true);
	});

	test("trails the mode slot after the group separator", () => {
		const [, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const rendered = renderLine(line2, 100, fakeTheme);

		expect(rendered.startsWith("▰")).toBe(true);
		expect(rendered).toContain(` │ ${GLYPHS.plan} plan`);
	});

	test("has no separator when there is no mode slot", () => {
		const [, line2] = buildLines(fullSnapshot({ statuses: new Map() }), fakeTheme, "/home/u");
		expect(renderLine(line2, 100, fakeTheme)).not.toContain("│");
	});

	test("counts wide characters correctly", () => {
		const snapshot = fullSnapshot({ cwd: "/home/u/項目", branch: null });
		const [line1] = buildLines(snapshot, fakeTheme, "/home/u");
		const rendered = renderLine(line1, 6, fakeTheme);

		expect(visibleWidth(rendered)).toBeLessThanOrEqual(6);
	});

	test("returns a single line", () => {
		const [line1] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		expect(renderLine(line1, 80, fakeTheme)).not.toContain("\n");
	});
});
