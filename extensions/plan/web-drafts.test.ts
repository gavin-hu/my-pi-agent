/**
 * The review's comment drafts, driven the way a reader uses them.
 *
 * A comment is written in one of two fields — the composer under a block, or the editor a
 * card's Edit opens — and either is text the page has not committed. The composer had its
 * guards; the editor did not, so Escape closed the review over it, a card action repainted
 * it away, and a live frame dropped it. These cases drive the shipped page through both
 * fields: the text survives a repaint, one draft at a time, Escape peels the editor, and a
 * write puts the tab stop on the card it changed.
 *
 * Where the machine has no browser the suite skips, naming `PI_CHROME`, so `bun run check`
 * stays green there.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type TestBrowser } from "../../test/helpers/browser.ts";
import {
	type Doc,
	mountReview,
	openPlanTab,
	openReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
	launchReviewBrowser,
} from "../../test/helpers/plan-browser.ts";

let browser: TestBrowser;

describe.skipIf(REVIEW_CHROME === undefined)("the review's comment drafts", () => {
	beforeAll(async () => {
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	test("cancelling an edit puts the comment back and keeps nothing", async () => {
		// The editor writes through on every keystroke so a reload cannot lose the text; Cancel is
		// the way back, so it restores the body the editor opened on rather than leaving the
		// draft with a half-edited note.
		const local = await mountReview({ ...REVIEW_PAGE, annotations: [{ anchor: 1, comment: "before" }] });
		const page = await openPlanTab(browser, local.url, { width: 1280, height: 900 });
		try {
			await page.waitForSelector(".bf-comment", { timeout: REVIEW_PAINT_MS });
			await page.click(".bf-comment__actions button:nth-of-type(2)");
			await page.fill(".bf-comment textarea", "after");
			await page.click(".bf-comment__row button");
			expect(await page.textContent(".bf-comment__body")).toBe("before");
			expect(await page.$$eval(".bf-comment textarea", (nodes) => nodes.length)).toBe(0);
		} finally {
			// The tab outlives this case's mount: park it before the server goes.
			await page.goto("about:blank");
			await local.close();
		}
	});

	test("a card action over a half-written comment refuses and leaves it alone", async () => {
		// Resolve and Delete repaint the thread they sit in, which would take the composer with
		// it: both refuse while the draft exists rather than resolving over a note nobody sent.
		const local = await mountReview({ ...REVIEW_PAGE, annotations: [{ anchor: 1, comment: "mine" }] });
		const page = await openPlanTab(browser, local.url, { width: 1280, height: 900 });
		try {
			await page.waitForSelector(".bf-comment", { timeout: REVIEW_PAINT_MS });
			await page.click('#plan .bf-block[data-line="4"] .bf-block__add');
			await page.fill(".bf-composer textarea", "half a thought");
			await page.click(".bf-comment__actions button:nth-of-type(1)");
			expect(await page.textContent("#status")).toContain("Add or discard the comment you are writing.");
			expect(await page.$$eval(".bf-comment--resolved", (nodes) => nodes.length)).toBe(0);
			await page.click(".bf-comment__actions button:nth-of-type(3)");
			expect(await page.textContent("#status")).toContain("Add or discard the comment you are writing.");
			expect(await page.$$eval(".bf-comment", (nodes) => nodes.length)).toBe(1);
			expect(await page.inputValue(".bf-composer textarea")).toBe("half a thought");
		} finally {
			// The tab outlives this case's mount: park it before the server goes.
			await page.goto("about:blank");
			await local.close();
		}
	});

	test("one draft at a time: an editor and a composer refuse each other", async () => {
		// Edit replaces a card, so it is a repaint too; and the composer refuses over an edit, which
		// is the same guard read from the other side once both fields count as a draft.
		const local = await mountReview({ ...REVIEW_PAGE, annotations: [{ anchor: 1, comment: "mine" }] });
		const page = await openPlanTab(browser, local.url, { width: 1280, height: 900 });
		try {
			await page.waitForSelector(".bf-comment", { timeout: REVIEW_PAINT_MS });
			await page.click('#plan .bf-block[data-line="4"] .bf-block__add');
			await page.fill(".bf-composer textarea", "half a thought");
			await page.click(".bf-comment__actions button:nth-of-type(2)");
			expect(await page.textContent("#status")).toContain("Add or discard the comment you are writing.");
			expect(await page.$$eval(".bf-comment textarea", (nodes) => nodes.length)).toBe(0);
			expect(await page.inputValue(".bf-composer textarea")).toBe("half a thought");

			// Close the composer, edit the note, and a second composer is refused the same way.
			await page.click(".bf-composer .bf-btn");
			await page.click(".bf-comment__actions button:nth-of-type(2)");
			await page.fill(".bf-comment textarea", "edited");
			await page.click('#plan .bf-block[data-line="4"] .bf-block__add');
			expect(await page.textContent("#status")).toContain("Add or discard the comment you are writing.");
			expect(await page.inputValue(".bf-comment textarea")).toBe("edited");
			expect(await page.$$eval(".bf-composer", (nodes) => nodes.length)).toBe(0);
		} finally {
			// The tab outlives this case's mount: park it before the server goes.
			await page.goto("about:blank");
			await local.close();
		}
	});

	test("Escape cancels an edit before the composer and the review", async () => {
		// The old order asked only whether a composer was open, so Escape in an editor fell through
		// to the review's close and took the edit with it. One Escape now restores the note.
		const local = await mountReview({ ...REVIEW_PAGE, annotations: [{ anchor: 1, comment: "before" }] });
		const page = await openPlanTab(browser, local.url, { width: 1280, height: 900 });
		try {
			await page.waitForSelector(".bf-comment", { timeout: REVIEW_PAINT_MS });
			await page.click(".bf-comment__actions button:nth-of-type(2)");
			await page.fill(".bf-comment textarea", "after");
			await page.keyboard.press("Escape");
			await page.waitForFunction(
				() => (globalThis as unknown as { document: Doc }).document.querySelector(".bf-comment textarea") === null,
				undefined,
				{ timeout: REVIEW_PAINT_MS },
			);
			expect(await page.textContent(".bf-comment__body")).toBe("before");
			expect(await page.$eval("#plan", (node) => node.isConnected)).toBe(true);
			expect(await page.$eval("#save", (node) => (node as unknown as { disabled: boolean }).disabled)).toBe(false);
		} finally {
			// The tab outlives this case's mount: park it before the server goes.
			await page.goto("about:blank");
			await local.close();
		}
	});

	test("adding a comment leaves focus on the new comment", async () => {
		// The composer used to close before the repaint, so the field the reader was in was gone
		// when the frame read focus and every add dropped the caret to the document. The frame
		// closes it now, and the write's hint puts the tab stop on the new card.
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
			expect(await page.$eval(".bf-comment:focus", (node) => node.textContent)).toContain("a committed note");
		} finally {
			// The tab outlives this case's mount: park it before the server goes.
			await page.goto("about:blank");
			await local.close();
		}
	});
});
