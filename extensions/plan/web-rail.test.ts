/**
 * The review's rail as a reader meets it: state, then the switch, then the outline, then the help.
 *
 * Every defect this rail was filed for is geometry or colour, which no class assertion can see: at
 * 260px the step row wrapped alone to 51px against the comment row's 20px, the switch had no caption
 * and the outline's heading sat flush against its bottom, the unearned half of the progress drew at
 * 1.08:1, and the pressed segment's label at 4.27:1. It is its own suite for the reason
 * `web-switch.test.ts` gives: `web-behaviour.test.ts` and `web-page.test.ts` are named at their
 * height in `LONG_SUITES`, and lines there may only fall.
 *
 * Where the machine has no browser the driving suite skips, naming `PI_CHROME`, so `bun run check`
 * stays green there; the rules themselves are read without a document, because a missing
 * `repeating-linear-gradient` is a case no browser would reach by clicking.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestBrowser } from "../../test/helpers/browser.ts";
import { islandOf, reviewPage } from "../../test/helpers/fixtures/plan-web.ts";
import { launchReviewBrowser, mountReview, openReview, REVIEW_CHROME, REVIEW_PAGE } from "../../test/helpers/plan-browser.ts";
import { REVIEW_CSS } from "./web-page.ts";

/** Where a rail part starts in the page, which is the whole of what its order is. */
const at = (html: string, part: string): number => {
	const index = html.indexOf(part);
	expect(index, `${part} is drawn`).toBeGreaterThan(-1);
	return index;
};

describe("the rail's markup and rules", () => {
	test("reads state, then the switch, then the help, then the outline", () => {
		// Measured on main at 1440: the finish block — three lines naming the buttons that sit in
		// the same viewport — held the rail's top, and the plan's progress was a muted row under
		// it, so a 400px-tall window scrolled the state away before the help.
		const html = reviewPage();
		const order = [
			'id="review-facts"',
			'id="review-view-label"',
			'id="review-view"',
			'id="review-note"',
			'class="review-finish"',
			'id="review-sections"',
			'class="review-hints"',
		].map((part) => at(html, part));
		expect(order).toEqual([...order].sort((left, right) => left - right));
	});

	test("names the plan the switch redraws, in words a reader can see", () => {
		// The switch is a filter over the document, not a fourth segment of the outline, so it
		// carries a caption the way the outline's title names the sections — and the group takes
		// its name from that caption rather than from a sentence drawn nowhere on the page.
		const html = reviewPage();
		expect(html).toContain('<p class="review-view__label" id="review-view-label">Show in the plan</p>');
		expect(html).toContain('role="group" aria-labelledby="review-view-label" id="review-view"');
		expect(html).not.toContain("What to show");
	});

	test("draws the progress as eight pips, the empty half included", () => {
		// 8 x 6px + 7 x 2px = 62px. The 96px trough it replaces drew the unearned half in
		// --accent-soft on --raised = 1.08:1, which is no bar at all; --dim on the rail measures
		// 4.69:1, so an empty pip is a pip.
		expect(REVIEW_CSS).toContain(
			".review-steps__track{display:inline-block;flex:0 0 auto;width:62px;height:6px;border-radius:var(--radius-badge);background-image:repeating-linear-gradient(90deg,var(--dim) 0 6px,transparent 6px 8px);overflow:hidden}",
		);
		expect(REVIEW_CSS).toContain(
			".review-steps__fill{display:block;height:100%;width:0;background-image:repeating-linear-gradient(90deg,var(--accent) 0 6px,transparent 6px 8px)",
		);
	});

	test("gives the two fact rows one geometry", () => {
		// At 260px the step group needed 181px beside a 63px label and wrapped alone, so the row
		// carrying the progress was 51px against the comment's 20px. One geometry is a whole label
		// and a value flush right on one line; the rendered heights are a browser's to say.
		expect(REVIEW_CSS).toContain(".review-fact{display:flex;flex-wrap:nowrap;align-items:center;");
		expect(REVIEW_CSS).toContain(".review-fact>span:first-child{flex:0 0 auto;white-space:nowrap}");
	});

	test("pairs every label in the rail above 4.5", () => {
		// The pressed segment and the nav hover shared --accent on --accent-soft = 4.27:1, under the
		// 4.5 a 13px semibold word owes, and a section's count badge was the third instance. The
		// pressed label takes the token's own pair for an accent fill; the other two take --text,
		// and the accent wash stays the mark of the current row.
		expect(REVIEW_CSS).toContain(
			'.review-view .bf-tabs__item[aria-pressed="true"]{background:var(--accent);color:var(--on-accent)}',
		);
		expect(REVIEW_CSS).toContain(".review-nav a:hover{background:var(--surface);color:var(--text);text-decoration:none}");
		expect(REVIEW_CSS).toContain("background:var(--accent-soft);color:var(--text);font:var(--fs-xs)/18px");
	});

	test("draws a seam the rail can see between the switch and the outline", () => {
		// --border on the rail measures 1.05:1, so the heading under the tab row sat flush against
		// it at gap 0 and read as a fourth segment; the seam is the stronger line plus the rail's
		// own space either side.
		expect(REVIEW_CSS).toContain(
			".review-panel--head{padding-bottom:var(--space-3);border-bottom:1px solid var(--border-strong)}",
		);
		expect(REVIEW_CSS).toContain(".review-outline .review-sections>.review-panel{padding-top:var(--space-3)}");
	});
});

let browser: TestBrowser;

/** The contrast of two painted colours, which the page reports as rgb()/rgba() strings. */
function contrastOf(colour: string, background: string): number {
	const luminance = (value: string): number => {
		const parts = /rgba?\(([^)]+)\)/.exec(value)?.[1]?.split(",").map(Number) ?? [];
		const [r = 0, g = 0, b = 0] = parts.map((channel) => {
			const fraction = channel / 255;
			return fraction <= 0.03928 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [high, low] = [luminance(colour), luminance(background)].sort((left, right) => right - left) as [
		number,
		number,
	];
	return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
}

describe.skipIf(REVIEW_CHROME === undefined)("the rail's geometry and colours", () => {
	beforeAll(async () => {
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	test("leads with the state, on one geometry, over a visible bar and a visible seam", async () => {
		// The fixture is the owner's page: one step of three ticked, one stored comment. Ratios are
		// floors — 4.5 for a label, 3 for a graphic — which hold in either theme; the light theme
		// measures 5.19 for the pressed label and 4.69 for an empty pip.
		const review = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, review.url);
		try {
			// A string expression evaluates to `unknown`; this is the shape the page returns, and
			// the assertions below are what hold it to that.
			const rail = (await page.evaluate(`(function () {
				var box = function (selector) {
					var node = document.querySelector(selector);
					if (!node) return null;
					var rect = node.getBoundingClientRect();
					return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
				};
				var row = function (selector) {
					var node = document.querySelector(selector);
					return node ? { height: Math.round(node.getBoundingClientRect().height), overflow: node.scrollWidth - node.clientWidth } : null;
				};
				var painted = function (selector, property) {
					var node = document.querySelector(selector);
					return node ? getComputedStyle(node).getPropertyValue(property) : "";
				};
				var pressed = '#review-view .bf-tabs__item[aria-pressed="true"]';
				var caption = document.getElementById("review-view-label");
				return {
					facts: box("#review-facts"),
					caption: box("#review-view-label"),
					view: box("#review-view"),
					finish: box(".review-finish"),
					head: box(".review-panel--head"),
					navTitle: box(".review-nav__title"),
					sections: box("#review-sections"),
					hints: box(".review-hints"),
					step: row("#step-fact"),
					comment: row(".review-facts .review-fact:last-child"),
					track: box(".review-steps__track"),
					count: box("#step-count"),
					captionText: caption ? caption.textContent : "",
					groupName: document.getElementById("review-view").getAttribute("aria-labelledby"),
					seamWidth: parseFloat(painted(".review-panel--head", "border-bottom-width")),
					pressedColour: painted(pressed, "color"),
					pressedBackground: painted(pressed, "background-color"),
					pipColour: getComputedStyle(document.documentElement).getPropertyValue("--dim"),
					railBackground: painted(".bf-app__sidebar", "background-color")
				};
			})()`)) as {
				facts: { top: number; bottom: number };
				caption: { top: number; bottom: number } | null;
				view: { top: number; bottom: number };
				finish: { top: number; bottom: number };
				head: { bottom: number };
				navTitle: { top: number };
				sections: { top: number };
				hints: { top: number };
				step: { height: number; overflow: number } | null;
				comment: { height: number; overflow: number } | null;
				track: { width: number; height: number; top: number };
				count: { top: number };
				captionText: string;
				groupName: string | null;
				seamWidth: number;
				pressedColour: string;
				pressedBackground: string;
				pipColour: string;
				railBackground: string;
			};
			// The order a reader meets the rail in: state, the switch under its caption, the help,
			// the outline, then the keys.
			expect(rail.facts.bottom, "the state leads the rail").toBeLessThanOrEqual(rail.caption?.top ?? -1);
			expect(rail.caption?.bottom, "the caption sits on the switch").toBeLessThanOrEqual(rail.view.top);
			expect(rail.view.bottom).toBeLessThanOrEqual(rail.finish.top);
			expect(rail.finish.top).toBeLessThan(rail.sections.top);
			expect(rail.sections.top).toBeLessThan(rail.hints.top);
			expect(rail.captionText).toBe("Show in the plan");
			expect(rail.groupName, "the group is named by the caption a reader can see").toBe("review-view-label");
			// One geometry: the row that carries the progress is the row that carries the count.
			expect(rail.step?.height, "the fact rows agree").toBe(rail.comment?.height ?? -1);
			expect(rail.step?.overflow, "the step row fits its panel").toBeLessThanOrEqual(0);
			// Eight 6px pips 2px apart, between the label and the count, with the empty half seen.
			expect(rail.track.width, "8 x 6px + 7 x 2px").toBe(62);
			expect(rail.track.height).toBe(6);
			expect(rail.track.top).toBeLessThan(rail.count.top + 20);
			const pipRatio = contrastOf(rail.pipColour.trim(), rail.railBackground);
			expect(pipRatio, `an empty pip draws at ${pipRatio}:1, not the 1.08 accent wash`).toBeGreaterThanOrEqual(3);
			const pressedRatio = contrastOf(rail.pressedColour, rail.pressedBackground);
			expect(pressedRatio, `the pressed label draws at ${pressedRatio}:1`).toBeGreaterThanOrEqual(4.5);
			// A seam a reader can see: a hairline with the rail's own space either side of it.
			expect(rail.seamWidth, "the head is closed by a 1px rule").toBe(1);
			expect(rail.head.bottom - rail.finish.bottom, "the help ends above the seam").toBeGreaterThanOrEqual(12);
			expect(rail.navTitle.top - rail.head.bottom, "the outline starts below the seam").toBeGreaterThanOrEqual(12);
		} finally {
			await page.close();
			await review.close();
		}
	});

	test("keeps a hovered outline link's label readable", async () => {
		// Hover is a label state too, so it is measured in it rather than read out of the rule. The
		// second section, because the first is the current one and keeps its own selected paper.
		const review = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, review.url);
		try {
			await page.hover("#outline-list li:nth-child(2) a");
			const hovered = (await page.evaluate(`(function () {
				var link = document.querySelector("#outline-list li:nth-child(2) a");
				var style = getComputedStyle(link);
				return { colour: style.color, background: style.backgroundColor };
			})()`)) as { colour: string; background: string };
			const ratio = contrastOf(hovered.colour, hovered.background);
			expect(ratio, `a hovered outline link draws at ${ratio}:1, not the 4.27 it wore`).toBeGreaterThanOrEqual(4.5);
		} finally {
			await page.close();
			await review.close();
		}
	});

	test("draws the switch's caption on every role's page, not only the owner's", async () => {
		// The caption names the document this reader is looking at, so a reviewer and a viewer get
		// it too: the three roles' rails are one order, and only the facts differ.
		for (const role of ["reviewer", "viewer"] as const) {
			const review = await mountReview({ ...REVIEW_PAGE, role, canApprove: false });
			const page = await openReview(browser, review.url);
			try {
				expect(await page.textContent("#review-view-label")).toBe("Show in the plan");
				expect(await page.$eval("#review-view", (node) => node.getAttribute("aria-labelledby"))).toBe(
					"review-view-label",
				);
				// A reviewer's page has no step fact to draw, and the rail still leads with the count.
				expect(islandOf(await page.content()).role).toBe(role);
			} finally {
				await page.close();
				await review.close();
			}
		}
	});
});
