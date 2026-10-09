import { describe, expect, test } from "bun:test";
import { renderLine } from "./layout.ts";
import { buildLines } from "./lines.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { fullSnapshot } from "../../test/helpers/fixtures/status-bar.ts";

/**
 * Rendering of the full bar across widths.
 *
 * Assert fields, ordering, and width bounds rather than exact padding, so a
 * cosmetic spacing change does not break the suite.
 */
const WIDTHS = [100, 80, 60, 40, 24, 16];

function render(width: number): string[] {
	return buildLines(fullSnapshot(), fakeTheme, "/home/u").map((line) => renderLine(line, width, fakeTheme));
}

describe("status bar render", () => {
	test("renders the left path and right branch/worktree fields at width 100", () => {
		const [line1] = render(100);
		expect(line1).toContain("~/repo/project");
		expect(line1).toContain("⎇ main");
		expect(line1).toContain("⑂ smoke");
		expect(line1).toContain("⎇ main · ⑂ smoke");
		expect(line1.indexOf("⎇ main")).toBeLessThan(line1.indexOf("⑂ smoke"));
	});

	test("renders the gauge, plan status, and model fields at width 100", () => {
		const [, line2] = render(100);
		expect(line2).toContain("62%/200k");
		expect(line2).toContain("$0.31");
		expect(line2).toContain("│ ≡ plan");
		expect(line2).toContain("opus-4.5 · high");
		expect(line2.indexOf("│")).toBeLessThan(line2.indexOf("≡ plan"));
	});

	for (const width of WIDTHS) {
		test(`renders two lines that fit width ${width}`, () => {
			const lines = render(width);
			expect(lines).toHaveLength(2);
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(width);
				expect(line.length).toBeGreaterThan(0);
			}
			expect(lines[0]).toContain("main");
			expect(lines[1]).toContain("opus-4.5");
			if (width >= 60) {
				expect(lines[0]).toContain("⑂ smoke");
				expect(lines[1]).toContain("62%");
			}
		});
	}
});
