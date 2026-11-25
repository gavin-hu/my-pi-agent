/**
 * The review page's threads, in a browser: one line's comments in the order they were written, a
 * reply under the comment it answers, and what the two buttons say about which one they act on.
 *
 * The thread rules are DOM facts — an order of bodies, a `data-parent` that stands or falls with the
 * comment it names, a single button on a reply — and the store's one-level rule is what makes them
 * possible. The writes a thread is made of are `writes.test.ts`, the drafts `drafts.test.ts`, and the
 * fixture and its waits `test/helpers/review-browser.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import {
	CASE_MS,
	reloadReview,
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

gated("the review page's threads", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	/** The one launch, and the fixture-and-page ownership, the helper keeps for each suite. */
	const withPage = (
		run: (page: Page, fixture: ReviewPageFixture) => Promise<void>,
		options: SnapshotOptions = {},
		seed: readonly SeedComment[] = [],
	): Promise<void> => withReviewPage(browser, run, options, seed);

	/**
	 * A line's comments are a thread: the order the review stores them, a tie keeping arrival, and a
	 * reply right under the comment it answers rather than at the top of the row.
	 */
	test(
		"comments on one line read oldest first, and a reply sits under its comment",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "older");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				await startComment(page, "newer");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 2,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator(".rv-thread .bf-comment__body").allTextContents()).toEqual(["older", "newer"]);

				await page.locator(".rv-thread", { hasText: "older" }).locator("button", { hasText: "reply" }).click();
				await page.locator(".rv-compose__area").fill("answering older");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 3,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				// The reply is under the comment it answers, not after the newest comment and not above it.
				expect(await page.locator(".rv-thread .bf-comment__body").allTextContents()).toEqual([
					"older",
					"answering older",
					"newer",
				]);
				expect(await page.locator(".rv-thread[data-parent] .bf-comment__body").textContent()).toBe("answering older");
				// A reply offers no reply button: the store holds one level, so the verb would only
				// promise a refusal after the reviewer had typed.
				expect(await page.locator(".rv-thread[data-parent] .bf-comment__row button").count()).toBe(1);
				expect(await page.locator(".rv-thread[data-parent] .bf-comment__row button").textContent()).toBe("delete");
			});
		},
		CASE_MS,
	);

	/**
	 * A press is a verb, not a hint: reply on a line whose composer is already open answers with the
	 * text that is there — the draft adopts the parent — rather than leaving it a plain comment.
	 */
	test(
		"reply adopts the composer already open on the line",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "older");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				await startComment(page, "typed as a comment");
				expect(await page.locator(".rv-compose__head").textContent()).toContain("comment on a.ts:3");

				await page.locator(".rv-thread").first().locator("button", { hasText: "reply" }).click();
				// A press asks the session about the tree first (#877), so the head changes one round trip later.
				await page.waitForFunction(
					() =>
						(globalThis as unknown as ReviewDom).document
							.querySelector(".rv-compose__head")
							?.textContent?.startsWith("reply on") === true,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator(".rv-compose__head").textContent()).toContain("reply on a.ts:3");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread[data-parent]").length === 1,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator(".rv-thread[data-parent] .bf-comment__body").textContent()).toBe(
					"typed as a comment",
				);
			});
		},
		CASE_MS,
	);

	/**
	 * A reply outlives the comment it answers: the delete is by id, so the reply stays on the line and
	 * stands on its own — on the write that removed the parent and again on the load after it, which
	 * reaches the same list down the server's render.
	 */
	test(
		"a reply whose parent is deleted reads as a comment, on the write and after a reload",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "older");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				await page.locator(".rv-thread").first().locator("button", { hasText: "reply" }).click();
				await page.locator(".rv-compose__area").fill("answering older");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 2,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator(".rv-thread[data-parent]").count()).toBe(1);

				await page.locator(".rv-thread").first().locator("button", { hasText: "delete" }).click();
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 1,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator(".rv-thread .bf-comment__body").textContent()).toBe("answering older");
				expect(await page.locator(".rv-thread[data-parent]").count()).toBe(0);

				await reloadReview(page);
				expect(await page.locator(".rv-thread").count()).toBe(1);
				expect(await page.locator(".rv-thread[data-parent]").count()).toBe(0);
			});
		},
		CASE_MS,
	);

	test(
		"reply and delete name the comment they act on, not only what they do",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "older");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				await startComment(page, "newer");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 2,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				// Two comments on one line, four buttons that used to read "reply" and "delete" twice:
				// the line and the opening words are what tell a screen reader which one it is.
				const labels: Array<string | null> = [];
				for (let index = 0; index < 4; index += 1) {
					labels.push(await page.locator(".rv-thread .bf-comment__row button").nth(index).getAttribute("aria-label"));
				}
				expect(labels).toEqual([
					'Reply to the comment on a.ts:3 — "older"',
					'Delete the comment on a.ts:3 — "older"',
					'Reply to the comment on a.ts:3 — "newer"',
					'Delete the comment on a.ts:3 — "newer"',
				]);
			});
		},
		CASE_MS,
	);
});
