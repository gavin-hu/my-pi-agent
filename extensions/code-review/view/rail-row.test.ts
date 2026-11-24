/**
 * The rail's row shape, in a browser: no line for the state, no rule on its left edge.
 *
 * A split out of `interaction.test.ts` rather than an addition to it: that suite is at its
 * recorded height in `test/suite-sizes.test.ts`, and a height only falls (#817). What landed
 * here is one subject — how much room a row spends and which marks it wears — while that suite
 * keeps the page's interactions (a draft across a moved diff, the rail following the place).
 *
 * Both halves of the card are geometry, which is why they are measured rather than matched: a
 * row that still spends a line on its state is visible only as a height, and a row that still
 * wears the old left rule is visible only as a computed border. No case sleeps; each waits on
 * the state its assertion reads, with `REVIEW_PAINT_MS` as the budget.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import {
	CASE_MS,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	type ReviewDom,
	startComment,
	withReviewPage,
} from "../../../test/helpers/review-browser.ts";

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

gated("the rail's row", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	});

	afterAll(async () => {
		await browser?.close();
	});

	const withPage = (run: (page: Page) => Promise<void>, options = {}): Promise<void> =>
		withReviewPage(browser, run, options);

	/**
	 * The state takes no line of its own, and no rule marks the row's left edge.
	 *
	 * The measure is an equality: hiding the count changes no row's height, so the box it lived in
	 * never cost a line. The stripe is the left edge disagreeing with the other three — the row
	 * keeps its 1px hairline for the hover ring, so `0px` would be the wrong question.
	 */
	test(
		"a row's state takes no line of its own, and no rule marks its left edge",
		async () => {
			await withPage(
				async (page) => {
					const heights = (): Promise<number[]> =>
						page.evaluate(() => {
							const dom = globalThis as unknown as ReviewDom;
							return Array.from(dom.document.querySelectorAll(".rv-rail"), (row) =>
								Math.round(row.getBoundingClientRect().height),
							);
						});
					const before = await heights();
					// The count is the state's box: if the row does not notice it leaving, it never had
					// a line — and the attribute wins over the rule's display, which is what makes a
					// zero count cost nothing.
					await page.evaluate(() => {
						const dom = globalThis as unknown as ReviewDom;
						for (const notes of Array.from(dom.document.querySelectorAll(".rv-rail__notes"))) notes.hidden = true;
					});
					expect(await heights(), "the state word spends a line of its own").toEqual(before);
					expect(before[0], "every row is the same height").toBe(before[1]);

					const edges = await page.evaluate(() => {
						const dom = globalThis as unknown as ReviewDom;
						return Array.from(dom.document.querySelectorAll(".rv-rail, .rv-file__head"), (node) => {
							const style = dom.getComputedStyle(node);
							return { left: style.borderLeftWidth, top: style.borderTopWidth };
						});
					});
					expect(
						edges.filter((edge) => edge.left !== edge.top),
						"a left rule the other edges do not share",
					).toEqual([]);
				},
				{ second: true },
			);
		},
		CASE_MS,
	);

	/**
	 * The client half: a file marked reviewed mid-review must not regain the word the markup lost.
	 *
	 * `client-comments.ts` rewrites the notes node on every state change, so a markup-only fix would
	 * be undone by the first check — which is the reason this case exists at all (#817).
	 */
	test(
		"marking a file reviewed keeps the row's text and moves the state into its title",
		async () => {
			await withPage(
				async (page) => {
					const before = await page.locator(".rv-rail").first().textContent();
					await page.locator("[data-reviewed]").first().check();
					await page.waitForSelector('.rv-rail[data-state="reviewed"]', { timeout: REVIEW_PAINT_MS });
					const row = page.locator(".rv-rail").first();
					expect(await row.textContent()).toBe(before);
					expect(await row.getAttribute("title")).toContain("marked reviewed");
				},
				{ second: true },
			);
		},
		CASE_MS,
	);

	/** At 420 the rail is capped and scrolls, so the count has to fit the name's line, not widen it. */
	test(
		"the count fits the name's line on a phone-width page",
		async () => {
			await withPage(
				async (page) => {
					await startComment(page, "one note");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
					await page.setViewportSize({ width: 420, height: 844 });
					const measured = await page.evaluate(() => {
						const dom = globalThis as unknown as ReviewDom;
						const row = dom.document.querySelector(".rv-rail");
						const count = row?.querySelector(".rv-rail__notes") ?? null;
						if (row === null || count === null) return null;
						const box = count.getBoundingClientRect();
						const outer = row.getBoundingClientRect();
						return {
							visible: !count.hidden && box.width > 0 && box.right <= outer.right + 1,
							clipped: count.scrollWidth > count.clientWidth,
							overflow: row.scrollWidth > row.clientWidth,
						};
					});
					expect(measured, "the rail row was not drawn").not.toBeNull();
					expect(measured?.visible, "the count is inside the row").toBe(true);
					expect(measured?.clipped, "the count is not ellipsized").toBe(false);
					expect(measured?.overflow, "the row does not overflow").toBe(false);
				},
				{ second: true },
			);
		},
		CASE_MS,
	);

	// A progress count that only changes on reload is worse than none: the mark is what moves it, and
	// it moves in the rail's head while the footer the count left stays exactly as it was.
	test(
		"a mark moves the rail's progress and leaves the footer alone",
		async () => {
			await withPage(
				async (page) => {
					const facts = await page.locator("#rv-facts").textContent();
					expect(await page.locator("#rv-progress").textContent()).toContain("0 of ");
					await page.keyboard.press("j");
					await page.keyboard.press("m");
					await page.waitForSelector('.rv-rail[data-state="reviewed"]', { timeout: REVIEW_PAINT_MS });
					expect(await page.locator("#rv-progress").textContent()).toContain("1 of ");
					expect(await page.locator("#rv-facts").textContent()).toBe(facts);
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);
});
