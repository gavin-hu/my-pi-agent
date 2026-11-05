/**
 * The plan review footer: the hint row it draws at each width, the rank it keeps
 * when the terminal narrows, the colours it gives a key, and the entry line the
 * inline editor swaps in for it.
 *
 * The suite is separate from the review screen's own because the screen suite is
 * past the size bar: the hint row is one capability and its cases live here.
 */

import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { coloringTheme, fakeMarkdownTheme } from "../../test/helpers/fakes.ts";
import { MANY_LINES, SECTIONED_PLAN } from "../../test/helpers/fixtures/plan-view.ts";
import { hintRow, planReview, renderReview, REVIEW_TUI, scrollRow } from "../../test/helpers/plan-view.ts";
import { PLAN as POSTER_PLAN } from "../../scripts/screens/fixtures/plan.ts";

describe("plan review footer", () => {
	test("shows only the hints that fit", () => {
		const short = hintRow(planReview(MANY_LINES, { rows: 20 }).component, 60);
		expect(short).toContain("Esc keep plan");
		expect(short).toContain("a approve");
		expect(short).toContain("r refine");
		expect(short).not.toContain("space");
		expect(short).not.toContain("…");

		const full = hintRow(planReview(MANY_LINES, { rows: 24 }).component, 120);
		expect(full).toContain("space page");
		expect(full).toContain("g/G ends");
	});

	test("leads with the safe exit when only one hint fits", () => {
		const hint = hintRow(planReview(MANY_LINES, { rows: 20 }).component, 20);
		expect(hint).toContain("Esc keep plan");
		expect(hint).not.toContain("a approve");
	});

	test("keeps the mode exit and the section jump as the footer narrows", () => {
		// Neither key has a second way to be found: `Esc keep plan` does not leave
		// the mode, and nothing else names the section jump.
		for (const width of [60, 80]) {
			const hint = hintRow(planReview(SECTIONED_PLAN, { rows: 20 }).component, width);
			expect(hint, `${width} columns`).toContain("x exit plan");
			expect(hint, `${width} columns`).toContain("n/p section");
		}

		// And the frame the card was reported from: the docs poster's own fixture, at
		// the widths that lost the exit and then the jump.
		for (const width of [60, 80]) {
			const hint = hintRow(planReview(POSTER_PLAN.content, { rows: 20 }).component, width);
			expect(hint, `poster fixture at ${width}`).toContain("x exit plan");
			expect(hint, `poster fixture at ${width}`).toContain("n/p section");
		}
	});

	test("offers the section-jump hint only when the plan has sections", () => {
		const withSections = planReview(SECTIONED_PLAN, { rows: 20 });
		expect(hintRow(withSections.component, 120)).toContain("n/p section");

		const plain = planReview(MANY_LINES, { rows: 20 });
		expect(hintRow(plain.component, 120)).not.toContain("n/p section");
		expect(scrollRow(plain.component)).not.toContain(GLYPHS.plan);
	});

	test("colors the approve, refine, and browser hints", () => {
		const { component } = planReview(undefined, {
			theme: coloringTheme,
			markdownTheme: fakeMarkdownTheme(coloringTheme),
		});
		const hint = hintRow(component, 200);
		expect(hint).toContain("[success]a approve");
		expect(hint).toContain("[accent]r refine");
		expect(hint).toContain("[accent]w browser");
	});

	test("leads the inline editor's footer with the safe exit on a narrow screen", () => {
		const { component } = planReview(undefined, { tui: REVIEW_TUI });
		renderReview(component, 80);
		component.handleInput("r");

		const hint = hintRow(component, 20);
		expect(hint).toContain("Esc back to plan");
		expect(hint).not.toContain("Enter submit");
	});
});
