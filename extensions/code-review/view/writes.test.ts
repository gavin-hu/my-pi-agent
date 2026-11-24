/**
 * The review page's writes, in a browser: what a save, a mark and a send do to the page they
 * were made on, and what a refused one leaves behind.
 *
 * A write is a DOM fact the markup cannot show — a composer restored with the note typed on the
 * diff before, a chip revealed for the reader's own way out, a reviewed box back where the server
 * has it, a comment listed because no line is left to draw it under. The page's reading — the
 * cursor, the rail, the hunk jump — is `interaction.test.ts`, and the fixture and its waits are
 * `test/helpers/review-browser.ts`.
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

gated("the review page's writes", () => {
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

	/**
	 * The mint-then-write guard, and the words that come with it: the first save mints the review
	 * and writes a comment, and the second save on the same page must land — if the shas had moved
	 * the snapshot's fingerprint, the page's own next write would be refused as SNAPSHOT_MOVED.
	 * The footer is the one place the comparison and the counts are read, which is why this case
	 * reads them there and nowhere in the header.
	 */
	test(
		"the footer names the comparison and the drafts, and a second write lands",
		async () => {
			await withPage(
				async (page) => {
					await startComment(page, "one");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });

					expect(await page.locator("#rv-facts").textContent()).toContain("main...HEAD");
					expect(await page.locator("#rv-facts").textContent()).toContain("1 draft");

					await startComment(page, "two");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					// The second write's thread is the state the counts below read.
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 2,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator(".rv-thread").count()).toBe(2);
					// The count is read exactly: `toContain("2 draft")` is green on "2 drafts" too.
					expect(await page.locator("#rv-facts").textContent()).toContain("2 drafts");
					expect(await page.locator("#rv-send").textContent()).toBe("Send feedback 2");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	/**
	 * The comment the page cannot place: written on a line an earlier render drew, still stored, and
	 * drawn nowhere — so its thread is gone and this list is the only way to read or delete it. The
	 * draft count is the fact `code_review close` reads, which is why the case ends on it.
	 */
	test(
		"a comment the diff no longer draws is listed, and deleting it empties the review",
		async () => {
			await withPage(
				async (page) => {
					expect(await page.locator("#rv-orphans").isVisible()).toBe(true);
					expect(await page.locator(".rv-orphans__ref").textContent()).toBe("a.ts:3");
					expect(await page.locator(".rv-thread").count()).toBe(0);
					expect(await page.locator("#rv-send").textContent()).toBe("Send feedback 1");

					await page.locator(".rv-orphans__item .bf-btn").click();
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelector("#rv-orphans")?.hidden === true,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator("#rv-send").textContent()).toBe("Send feedback 0");
					expect(await page.locator("#rv-facts").textContent()).toContain("0 drafts");
				},
				{ start: 17 },
				[{ rel: "a.ts", line: 3, body: "a line this hunk stopped drawing" }],
			);
		},
		CASE_MS,
	);

	test(
		"a refused mark puts the reviewed box back where the server has it",
		async () => {
			await withPage(async (page, fixture) => {
				// The session closed its page while this tab was still reading it: the mark is refused,
				// and the box must not keep the tick the browser put there.
				fixture.closePage();
				await page.locator("[data-reviewed='a.ts']").click();
				await page.waitForFunction(
					() =>
						(globalThis as unknown as ReviewDom).document
							.querySelector("#rv-toast")
							?.textContent?.includes("no review page open") === true,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator("[data-reviewed='a.ts']").isChecked()).toBe(false);
			});
		},
		CASE_MS,
	);
});
