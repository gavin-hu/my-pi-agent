/**
 * The review's comment controls: what they say, how big they are, and where focus goes.
 *
 * Every rail button used to say "Comment on this block", the count was an unlabelled number,
 * the card actions were 20px high, and a write left the tab stop on the block's control. These
 * cases drive the shipped page: each + names its block, the badge names its count, the thread
 * reads as a list, the targets meet 24px, and add/edit/resolve/delete put focus on the card
 * that changed (or the block's control once the thread is empty).
 *
 * Where the machine has no browser the suite skips, naming `PI_CHROME`, so `bun run check`
 * stays green there.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { type TestBrowser } from "../../test/helpers/browser.ts";
import {
	type Doc,
	mountReview,
	openReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
	launchReviewBrowser,
} from "../../test/helpers/plan-browser.ts";

let browser: TestBrowser;

/** The card a write's focus hint should have landed on, by its text. */
async function focusedCard(page: Page): Promise<string> {
	return page.$eval(".bf-comment:focus", (node) => node.textContent ?? "");
}

describe.skipIf(REVIEW_CHROME === undefined)("the review's comment controls", () => {
	beforeAll(async () => {
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	test("names each control by its block, and the count by its number", async () => {
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			const labels = await page.$$eval(".bf-block__add", (nodes) =>
				nodes.map((node) => node.getAttribute("aria-label")),
			);
			expect(labels).toEqual([
				"Comment on \u201cAdd rate limiting\u201d",
				"Comment on \u201cStart with the token bucket.\u201d",
				"Comment on \u201cRollout\u201d",
				"Comment on \u201cShip behind a flag.\u201d",
			]);
			const badge = await page.$eval(".bf-block__count", (node) => ({
				role: node.getAttribute("role"),
				label: node.getAttribute("aria-label"),
				text: node.textContent,
			}));
			expect(badge).toEqual({ role: "img", label: "1 review comment", text: "1" });
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("meets 24px on the rail and the card actions", async () => {
		const local = await mountReview({ ...REVIEW_PAGE, annotations: [{ anchor: 1, comment: "mine" }] });
		const page = await openReview(browser, local.url);
		try {
			const add = await page.$eval(".bf-block__add", (node) => {
				const box = node.getBoundingClientRect();
				return { width: Math.round(box.width), height: Math.round(box.height) };
			});
			expect(add.width).toBeGreaterThanOrEqual(24);
			expect(add.height).toBeGreaterThanOrEqual(24);
			const actions = await page.$$eval(".bf-comment__actions .bf-btn", (nodes) =>
				nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
			);
			expect(actions.length).toBe(3);
			for (const height of actions) expect(height).toBeGreaterThanOrEqual(24);
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("reads a thread as a list of its cards", async () => {
		const local = await mountReview({
			...REVIEW_PAGE,
			annotations: [
				{ anchor: 1, comment: "first" },
				{ anchor: 1, comment: "second" },
			],
		});
		const page = await openReview(browser, local.url);
		try {
			const thread = await page.$eval('.bf-comments[data-line="1"]', (node) => ({
				role: node.getAttribute("role"),
				label: node.getAttribute("aria-label"),
			}));
			expect(thread).toEqual({
				role: "list",
				label: "2 comments on \u201cStart with the token bucket.\u201d",
			});
			const cards = await page.$$eval('.bf-comments[data-line="1"] .bf-comment', (nodes) =>
				nodes.map((node) => ({ role: node.getAttribute("role"), tabindex: node.getAttribute("tabindex") })),
			);
			expect(cards).toEqual([
				{ role: "listitem", tabindex: "-1" },
				{ role: "listitem", tabindex: "-1" },
			]);
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("focuses the new comment after an add", async () => {
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			await page.click('#plan .bf-block[data-line="1"] .bf-block__add');
			await page.fill(".bf-composer textarea", "a committed note");
			await page.keyboard.press("Enter");
			await page.waitForFunction(
				() => (globalThis as unknown as { document: Doc }).document.querySelector(".bf-composer") === null,
				undefined,
				{ timeout: REVIEW_PAINT_MS },
			);
			expect(await focusedCard(page)).toContain("a committed note");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("offers the owner Resolve on a teammate's note and nothing else", async () => {
		const local = await mountReview({ ...REVIEW_PAGE, annotations: [{ anchor: 1, comment: "hers", author: "priya" }] });
		const page = await openReview(browser, local.url);
		try {
			expect(
				await page.$$eval(".bf-comment__actions .bf-btn", (nodes) => nodes.map((node) => node.textContent)),
			).toEqual(["Resolve"]);
			// Resolve is the owner's to give; it flips the card and no text is offered for editing.
			await page.click(".bf-comment__actions .bf-btn");
			expect(await page.$eval(".bf-comment", (node) => node.className)).toContain("bf-comment--resolved");
			expect(await page.textContent(".bf-comment__actions .bf-btn")).toBe("Reopen");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("offers a reviewer no action on somebody else's note", async () => {
		const local = await mountReview({
			...REVIEW_PAGE,
			role: "reviewer",
			canApprove: false,
			annotations: [{ anchor: 1, comment: "hers", author: "priya" }],
		});
		const page = await openReview(browser, local.url);
		try {
			expect(await page.$$eval(".bf-comment__actions", (nodes) => nodes.length)).toBe(0);
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("keeps focus on the card after Resolve and after an edit", async () => {
		const local = await mountReview({ ...REVIEW_PAGE, annotations: [{ anchor: 1, comment: "mine to settle" }] });
		const page = await openReview(browser, local.url);
		try {
			await page.click(".bf-comment__actions button:nth-of-type(1)");
			expect(await page.$eval(".bf-comment--resolved", (node) => node.className)).toContain("bf-comment--resolved");
			expect(await focusedCard(page)).toContain("mine to settle");

			// Edit the settled note and save: the same card keeps the tab stop.
			await page.click(".bf-comment__actions button:nth-of-type(2)");
			await page.fill(".bf-comment textarea", "edited note");
			await page.click(".bf-comment__row .bf-btn--primary");
			expect(await focusedCard(page)).toContain("edited note");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("focuses the next card after a delete, and the block's control when the thread empties", async () => {
		const local = await mountReview({
			...REVIEW_PAGE,
			annotations: [
				{ anchor: 1, comment: "first" },
				{ anchor: 1, comment: "second" },
			],
		});
		const page = await openReview(browser, local.url);
		try {
			const del = ".bf-comment__actions button:nth-of-type(3)";
			await page.click(`.bf-comments[data-line="1"] .bf-comment:nth-child(1) ${del}`);
			expect(await focusedCard(page)).toContain("second");

			await page.click(`.bf-comments[data-line="1"] .bf-comment:nth-child(1) ${del}`);
			expect(await page.$$eval('.bf-comments[data-line="1"] .bf-comment', (nodes) => nodes.length)).toBe(0);
			expect(await page.$$eval('#plan .bf-block[data-line="1"] .bf-block__add:focus', (nodes) => nodes.length)).toBe(1);
		} finally {
			await page.close();
			await local.close();
		}
	});
});
