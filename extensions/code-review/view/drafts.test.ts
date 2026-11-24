/**
 * The review page's drafts, in a browser: what an unsent comment is, where it comes back, and what
 * happens when the diff will not hold it.
 *
 * A draft is this tab's, one per line: opening a second composer must not take the first, a reload
 * brings back every draft whose line is drawn, one whose line moved says which line it came from,
 * and one whose file the page no longer draws is listed above the diff to discard. The writes those
 * drafts become are `writes.test.ts`; the page's reading is `interaction.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import {
	CASE_MS,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	type ReviewDom,
	type ReviewPageFixture,
	type SeedComment,
	type SnapshotOptions,
	startComment,
	withReviewPage,
} from "../../../test/helpers/review-browser.ts";

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

gated("the review page's drafts", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	});

	afterAll(async () => {
		await browser?.close();
	});

	/** The one launch, and the fixture-and-page ownership, the helper keeps for each suite. */
	const withPage = (
		run: (page: Page, fixture: ReviewPageFixture) => Promise<void>,
		options: SnapshotOptions = {},
		seed: readonly SeedComment[] = [],
	): Promise<void> => withReviewPage(browser, run, options, seed);

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

	/**
	 * One composer per line: opening a second must not take the first, a reload brings back both
	 * with their own text, and a save closes the composer it belongs to and no other.
	 */
	test(
		"two composers hold their own text, and one save leaves the other",
		async () => {
			await withPage(
				async (page) => {
					await startComment(page, "note on the added line");
					await page
						.locator(".bf-diff-line")
						.nth(1)
						.locator(".browse-diff-no")
						.filter({ hasText: /^\d+$/ })
						.first()
						.click();
					await page.locator("#rv-sel-comment").click();
					expect(await page.locator(".rv-compose").count()).toBe(2);
					await page
						.locator(".rv-compose", { hasText: "a.ts:17" })
						.locator(".rv-compose__area")
						.fill("note on the context line");

					await page.reload({ waitUntil: "networkidle" });
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-compose").length === 2,
						undefined,
						{
							timeout: REVIEW_PAINT_MS,
						},
					);
					const restored = [
						await page.locator(".rv-compose__area").nth(0).inputValue(),
						await page.locator(".rv-compose__area").nth(1).inputValue(),
					];
					expect(restored.sort()).toEqual(["note on the added line", "note on the context line"]);
					// A count is a fact a reader cannot act on; the lines are the half that moves them.
					const toast = await page.locator("#rv-toast").textContent();
					expect(toast).toContain("a.ts:17");
					expect(toast).toContain("a.ts:19");

					await page.locator(".rv-compose", { hasText: "a.ts:19" }).locator(".bf-btn--primary").click();
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 1 &&
							(globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-compose").length === 1,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator(".rv-compose__area").inputValue()).toBe("note on the context line");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	test(
		"a save returns focus to the cursor row",
		async () => {
			await withPage(
				async (page) => {
					await page.keyboard.press("j");
					await page.keyboard.press("Enter");
					await page.locator(".rv-compose__area").fill("note at 17");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("a.ts:17");
					expect((await page.evaluate("document.activeElement.className")) as string).toContain("bf-diff-line");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	test(
		"a reply's composer comes back as a reply, and saves with the parent",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "older");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				await page.locator(".rv-thread").first().locator("button", { hasText: "reply" }).click();
				expect(await page.locator(".rv-compose__head").textContent()).toContain("reply on a.ts:3");
				await page.locator(".rv-compose__area").fill("answering older");

				await page.reload({ waitUntil: "networkidle" });
				await page.waitForSelector(".rv-compose", { timeout: REVIEW_PAINT_MS });
				// The record carries the parent: a reload restores a reply as a reply rather than
				// demoting it to a comment, which is the failure a reader would never notice.
				expect(await page.locator(".rv-compose__head").textContent()).toContain("reply on a.ts:3");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread[data-parent]").length === 1,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator(".rv-thread[data-parent] .bf-comment__body").textContent()).toBe("answering older");
			});
		},
		CASE_MS,
	);

	/**
	 * A draft whose line the diff stopped drawing but whose file it still draws: the text comes back
	 * on the file's first drawn row and says which line it was typed on, rather than moving silently.
	 */
	test(
		"a draft whose line moved comes back on a drawn line and says where it was typed",
		async () => {
			await withPage(
				async (page, fixture) => {
					await startComment(page, "note typed on 19");
					fixture.reshape({ start: 40 });
					await page.reload({ waitUntil: "networkidle" });

					await page.waitForSelector(".rv-compose", { timeout: REVIEW_PAINT_MS });
					expect(await page.locator(".rv-compose__head").textContent()).toContain("a.ts:40");
					expect(await page.locator(".rv-compose__note").textContent()).toContain("was a.ts:19 — the diff moved");
					expect(await page.locator(".rv-compose__area").inputValue()).toBe("note typed on 19");

					// It saves without a reload: the write carries the page's rev, so the line it lands on is
					// the one the page drew, not the one the record was typed on.
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
					expect(await page.locator(".rv-thread .bf-comment__body").textContent()).toBe("note typed on 19");
					expect(await page.locator(".rv-compose").count()).toBe(0);
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	/**
	 * A draft whose file the page no longer draws has nowhere to stand: it is listed above the diff
	 * with the word that says what it is, and only its reviewer's discard takes it away.
	 */
	test(
		"a draft for a file the page does not draw is listed, and only a discard clears it",
		async () => {
			await withPage(
				async (page, fixture) => {
					await page
						.locator('.rv-file[data-path="b.ts"] .bf-diff-line--add .browse-diff-no')
						.filter({ hasText: /^\d+$/ })
						.first()
						.click();
					await page.locator("#rv-sel-comment").click();
					await page.locator(".rv-compose__area").fill("note typed on b.ts");
					fixture.reshape({ start: 40 });
					await page.reload({ waitUntil: "networkidle" });

					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelector("#rv-orphans")?.hidden === false,
						undefined,
						{
							timeout: REVIEW_PAINT_MS,
						},
					);
					expect(await page.locator(".rv-compose").count()).toBe(0);
					expect(await page.locator(".rv-orphans__ref").textContent()).toBe("b.ts:42 · unsent");
					expect(await page.locator(".rv-orphans__body").textContent()).toBe("note typed on b.ts");
					expect(await page.locator(".rv-orphans__item .bf-btn").textContent()).toBe("discard");

					await page.locator(".rv-orphans__item .bf-btn").click();
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelector("#rv-orphans")?.hidden === true,
						undefined,
						{
							timeout: REVIEW_PAINT_MS,
						},
					);
					await page.reload({ waitUntil: "networkidle" });
					expect(await page.locator(".rv-compose").count()).toBe(0);
					expect(await page.locator("#rv-orphans").isVisible()).toBe(false);
				},
				{ start: 17, second: true },
			);
		},
		CASE_MS,
	);
});
