/**
 * The review page's interactions, in a browser: the draft survives the diff moving, and a
 * write against a moved diff names the way out instead of taking the text.
 *
 * Both are DOM facts after an interaction — a composer restored with its note, a chip
 * revealed, a textarea that still holds what was typed — which is exactly what a string
 * assertion cannot see. The card that added the first case is #758; the helper it lands is
 * `test/helpers/review-browser.ts`, and the later UI cards grow the suite from here.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import {
	mountReviewPage,
	openReviewPage,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	type ReviewPageFixture,
} from "../../../test/helpers/review-browser.ts";

/** A browser case pays a launch, a load, and an interaction. */
const CASE_MS = 30_000;

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

gated("the review page's interactions", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	});

	afterAll(async () => {
		await browser?.close();
	});

	/** One fixture, one page, and the close both own. */
	async function withPage(run: (page: Page, fixture: ReviewPageFixture) => Promise<void>): Promise<void> {
		const fixture = await mountReviewPage();
		const page = await openReviewPage(browser, fixture);
		try {
			await run(page, fixture);
		} finally {
			await page.close();
			await fixture.close();
		}
	}

	/** Comment on the added line and leave the composer open with `text`. */
	async function startComment(page: Page, text: string): Promise<void> {
		await page.locator(".bf-diff-line--add .browse-diff-no").filter({ hasText: /^\d+$/ }).first().click();
		await page.locator("#rv-sel-comment").click();
		await page.locator(".rv-compose__area").fill(text);
	}

	test(
		"an unsent draft survives the diff moving, and saves on a current line",
		async () => {
			await withPage(async (page, fixture) => {
				await startComment(page, "keep this note");
				fixture.move();
				await page.reload({ waitUntil: "networkidle" });

				const area = page.locator(".rv-compose__area");
				expect(await area.inputValue()).toBe("keep this note");
				expect(await page.locator(".rv-compose__note").textContent()).toContain("typed on the earlier diff");

				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				expect(await page.locator(".rv-thread .bf-comment__body").textContent()).toBe("keep this note");
			});
		},
		CASE_MS,
	);

	test(
		"a write against a moved diff reveals the reload chip and keeps the text",
		async () => {
			await withPage(async (page, fixture) => {
				await startComment(page, "stale note");
				fixture.move();
				await page.locator(".rv-compose__acts .bf-btn--primary").click();

				await page.waitForSelector("#reload-hint", { state: "visible", timeout: REVIEW_PAINT_MS });
				expect(await page.locator("#rv-toast").textContent()).toContain("reload");
				expect(await page.locator(".rv-compose__area").inputValue()).toBe("stale note");
			});
		},
		CASE_MS,
	);
});
