/**
 * The review page's writes, in a browser: what a save, a mark and a send do to the page they
 * were made on, and what a refused one leaves behind.
 *
 * A write is a DOM fact the markup cannot show — a chip revealed for the reader's own way out, a
 * reviewed box back where the server has it, a comment listed because no line is left to draw it
 * under, a send that carries the comment still being typed. The drafts those writes come from are
 * `threads.test.ts`, the drafts are `drafts.test.ts`, the page's reading is `interaction.test.ts`, and the
 * fixture and its waits are
 * `test/helpers/review-browser.ts`.
 *
 * The partial flush is staged with `MAX_COMMENTS - 1` seeded comments rather than a refused first
 * flush, because the review's comment cap is the only per-comment refusal the page can reach: it is
 * what lets one save land and the next be refused, which is the state the case is about.
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
					// The flush saves in DOM order: the context composer is #200 and is accepted, the
					// added-line one after it is refused by the cap, and that refused text is the one
					// that has to stay where the reviewer left it.
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
	 * A comment on a span: the selection's two ends and the rows it covers, which the store keeps and
	 * the thread shows back as what was quoted.
	 */
	test(
		"a span is what the selection names, and the thread quotes its rows",
		async () => {
			await withPage(
				async (page) => {
					await page
						.locator(".bf-diff-line")
						.nth(1)
						.locator(".browse-diff-no")
						.filter({ hasText: /^\d+$/ })
						.first()
						.click();
					await page
						.locator(".bf-diff-line--add .browse-diff-no")
						.filter({ hasText: /^\d+$/ })
						.first()
						.click({ modifiers: ["Shift"] });
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("a.ts:17-19");

					await page.keyboard.press("c");
					expect(await page.locator(".rv-compose__head").textContent()).toContain("comment on a.ts:17-19");
					await page.locator(".rv-compose__area").fill("these three");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });

					// The quote is the rows the reviewer highlighted, read from the page they saw.
					expect(await page.locator(".rv-thread .bf-comment__quote").textContent()).toBe(
						"const one = 1;\nconst two = 2;\nconst three = 3;",
					);
					await page.locator("#rv-send").click();
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelector("#rv-send-dialog")?.hidden === false,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator("#rv-send-list .rv-dialog-path").textContent()).toBe("a.ts:17-19");

					await page.reload({ waitUntil: "networkidle" });
					expect(await page.locator(".rv-thread .bf-comment__quote").textContent()).toContain("const two = 2;");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	/**
	 * A rectangle drawn across a removed and an added row names two anchors, and the page refuses
	 * rather than comment on a subset of it: the reviewer's evidence is what they highlighted.
	 */
	test(
		"a selection across the two sides opens no composer, and says why",
		async () => {
			await withPage(
				async (page) => {
					await page.locator(".bf-diff-line--del .browse-diff-no").filter({ hasText: /^\d+$/ }).first().click();
					await page
						.locator(".bf-diff-line--add .browse-diff-no")
						.filter({ hasText: /^\d+$/ })
						.first()
						.click({ modifiers: ["Shift"] });
					await page.keyboard.press("c");
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document
								.querySelector("#rv-toast")
								?.textContent?.includes("A range stays on one side of the diff") === true,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator(".rv-compose").count()).toBe(0);
				},
				{ start: 17, paired: true },
			);
		},
		CASE_MS,
	);

	/** A selection stays inside one file: a shift-click in another starts a fresh single line there. */
	test(
		"a shift-click in another file starts a new selection, not a span across files",
		async () => {
			await withPage(
				async (page) => {
					await page
						.locator('.rv-file[data-path="a.ts"] .bf-diff-line--add .browse-diff-no')
						.filter({ hasText: /^\d+$/ })
						.first()
						.click();
					await page
						.locator('.rv-file[data-path="b.ts"] .bf-diff-line--add .browse-diff-no')
						.filter({ hasText: /^\d+$/ })
						.first()
						.click({ modifiers: ["Shift"] });
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("b.ts:42");
					expect(await page.locator("[data-picked='true']").count()).toBe(1);
				},
				{ start: 17, second: true },
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
