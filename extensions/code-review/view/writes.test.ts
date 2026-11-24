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
import { MAX_COMMENTS } from "../review/store.ts";
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
					await page.waitForFunction(() => document.querySelectorAll(".rv-compose").length === 2, undefined, {
						timeout: REVIEW_PAINT_MS,
					});
					const restored = [
						await page.locator(".rv-compose__area").nth(0).inputValue(),
						await page.locator(".rv-compose__area").nth(1).inputValue(),
					];
					expect(restored.sort()).toEqual(["note on the added line", "note on the context line"]);

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

	/**
	 * Send is save-then-send: the comment still in a composer is written first, through the same
	 * route a Save takes, so the dialog lists exactly what leaves and the button's number is what
	 * the press does.
	 */
	test(
		"Send carries the comment still being typed, and the dialog names it",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "saved one");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });

				await page
					.locator(".bf-diff-line")
					.nth(1)
					.locator(".browse-diff-no")
					.filter({ hasText: /^\d+$/ })
					.first()
					.click();
				await page.locator("#rv-sel-comment").click();
				await page.locator(".rv-compose__area").fill("still typing this");
				expect(await page.locator("#rv-send").textContent()).toBe("Send feedback 2");

				await page.locator("#rv-send").click();
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.querySelector("#rv-send-dialog")?.hidden === false,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator("#rv-send-list .rv-dialog-line").allTextContents()).toEqual([
					"saved one",
					"still typing this",
				]);

				await page.locator("#rv-send-confirm").click();
				await page.waitForFunction(
					() =>
						(globalThis as unknown as ReviewDom).document.querySelector("#rv-toast")?.textContent?.includes("sent") ===
						true,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator(".rv-compose").count()).toBe(0);
				await page.reload({ waitUntil: "networkidle" });
				expect(await page.locator(".rv-compose").count()).toBe(0);
				expect(await page.locator("#rv-send").textContent()).toBe("Send feedback 0");
			});
		},
		CASE_MS,
	);

	/**
	 * A flush that stops halfway. The only per-comment refusal the page can reach is the review's
	 * comment cap, so the fixture starts one short of it: the first flush becomes #200, the second
	 * is refused, and what the page shows is what landed plus what did not.
	 *
	 * The button reads 201 before and after because a successful flush moves one composer into one
	 * draft — the sum is invariant by construction, and 201 is the number that proves the typing
	 * composer was counted at both ends rather than dropped between them.
	 */
	test(
		"a flush that stops halfway keeps the dialog shut and the rest in place",
		async () => {
			const seed = Array.from({ length: MAX_COMMENTS - 1 }, (_unused, index) => ({
				rel: "a.ts",
				line: 17,
				body: `seed ${index}`,
			}));
			await withPage(
				async (page) => {
					await page
						.locator(".bf-diff-line")
						.nth(1)
						.locator(".browse-diff-no")
						.filter({ hasText: /^\d+$/ })
						.first()
						.click();
					await page.locator("#rv-sel-comment").click();
					await page.locator(".rv-compose__area").fill("the two hundredth");
					// The second composer is on the added line, so the flush saves the context one
					// first: that is the write the cap refuses, and the one that has to survive.
					await page.locator(".bf-diff-line--add .browse-diff-no").filter({ hasText: /^\d+$/ }).first().click();
					await page.locator("#rv-sel-comment").click();
					await page.locator(".rv-compose", { hasText: "a.ts:19" }).locator(".rv-compose__area").fill("over the cap");
					expect(await page.locator("#rv-send").textContent()).toBe(`Send feedback ${MAX_COMMENTS + 1}`);

					await page.locator("#rv-send").click();
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document
								.querySelector("#rv-toast")
								?.textContent?.includes("at most 200 comments") === true,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator("#rv-send-dialog").isVisible()).toBe(false);
					expect(await page.locator(".rv-compose").count()).toBe(1);
					expect(await page.locator(".rv-compose__area").inputValue()).toBe("over the cap");
					expect(await page.locator("#rv-send").textContent()).toBe(`Send feedback ${MAX_COMMENTS + 1}`);
				},
				{ start: 17 },
				seed,
			);
		},
		CASE_MS,
	);

	/**
	 * The mint-then-write guard, and the words that come with it: the first save mints the review
	 * and writes a comment, and the second save on the same page must land — if the shas had moved
	 * the snapshot's fingerprint, the page's own next write would be refused as SNAPSHOT_MOVED.
	 * The footer is the comparison's one home and the Send button holds the draft count (#816), so
	 * this case reads each where it lives.
	 */
	test(
		"the footer names the comparison, and a second write lands",
		async () => {
			await withPage(
				async (page) => {
					await startComment(page, "one");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
					const facts = await page.locator("#rv-facts").textContent();
					expect(facts).toContain("main...HEAD");
					expect(facts).not.toContain("draft");
					expect(await page.locator("#rv-send").textContent()).toBe("Send feedback 1");

					await startComment(page, "two");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					// The second write's thread is the state the count below reads.
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 2,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator(".rv-thread").count()).toBe(2);
					// The count is read exactly: `toContain("2 draft")` is green on "2 drafts" too.
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
					// The Send button is painted from the review the drop answered with, so zero here is the
					// server holding no draft — the count `code_review close` reads.
					expect(await page.locator("#rv-send").textContent()).toBe("Send feedback 0");
					expect(await page.locator(".rv-orphans__item").count()).toBe(0);
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
