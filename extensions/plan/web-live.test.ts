/**
 * The plan review page following its stream.
 *
 * A frame arrives because the plan changed on disk or another writer commented, and the page
 * re-reads its own island and repaints. That path is the one no compiler reads — it is a
 * fragment of a `String.raw` bundle — so it is also the one that shipped calling a helper
 * with no arguments: the repaint threw, the refetch's `.catch` ate it, and the sentence
 * saying why never appeared. These cases drive the frame the server would broadcast, which
 * is a `renderFacts()` away from green in any other suite.
 *
 * Where the machine has no browser the suite skips, naming `PI_CHROME`, so `bun run check`
 * stays green there.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright-core";
import {
	type Doc,
	mountReview,
	openReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
	launchReviewBrowser,
} from "../../test/helpers/plan-browser.ts";
import type { ReviewPageData } from "./web-page.ts";

let browser: Browser;

/**
 * Wait until the page's own stream is open.
 *
 * A frame goes to the sinks the mount holds, so one pushed before the browser connected
 * lands nowhere: the state chip's `connected` is the page saying it is listening.
 */
async function awaitConnected(page: Page): Promise<void> {
	await page.waitForFunction(
		() =>
			(globalThis as unknown as { document: Doc }).document
				.querySelector("#review-state")
				?.textContent?.includes("connected") ?? false,
		undefined,
		{ timeout: REVIEW_PAINT_MS },
	);
}

/** Wait until the status line reads `text`: the page's own sentence, not a rule. */
async function awaitStatus(page: Page, text: string): Promise<void> {
	await page.waitForFunction(
		(wanted) => (globalThis as unknown as { document: Doc }).document.querySelector("#status")?.textContent === wanted,
		text,
		{ timeout: REVIEW_PAINT_MS },
	);
}

describe.skipIf(REVIEW_CHROME === undefined)("the live review", () => {
	beforeAll(async () => {
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	test("a plan frame draws the new version and says the plan changed on disk", async () => {
		// The refetch is the page's update path: it re-reads the island and repaints the body,
		// the facts, and the header chip. It then called `renderFacts()` with no arguments
		// beside a four-argument declaration, so it threw on its first line and the `.catch`
		// that ends the refetch ate it: the new body arrived and nothing said why.
		const current: ReviewPageData = { ...REVIEW_PAGE };
		const local = await mountReview(() => current);
		const page = await openReview(browser, local.url);
		try {
			await awaitConnected(page);
			// The model rewrote the plan under the review: one block more, and a step ticked
			// off, which is the fact the facts row counts.
			current.blocks = [
				...REVIEW_PAGE.blocks,
				{ start: 5, end: 5, kind: "paragraph", lines: ["Then watch it settle."] },
			];
			current.steps = { done: 2, total: 4 };
			current.rev = "rev-2";
			local.push("plan");
			await awaitStatus(page, "The plan changed on disk; showing the new version.");
			expect(await page.$$eval("#plan .bf-block", (nodes) => nodes.length)).toBe(5);
			expect(await page.textContent("#step-count")).toBe("2/4 ticked");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("a frame arriving over a half-written comment refuses and keeps the text", async () => {
		// A repaint closes the composer, so a live change waits for the draft rather than
		// dropping it: `draftTextarea()` was asked with no arguments, answered `null` every
		// time, and the refetch repainted the words away.
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			await awaitConnected(page);
			await page.click('#plan .bf-block[data-line="1"] .bf-block__add');
			await page.fill(".bf-composer textarea", "half a thought");
			local.push("comment");
			await awaitStatus(page, "A change arrived; finish or discard your draft to see it.");
			expect(await page.inputValue(".bf-composer textarea")).toBe("half a thought");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("a reload while typing reopens the composer with its text", async () => {
		// What a keystroke is worth: the composer's text is this tab's draft, kept in
		// `sessionStorage` and reopened after a reload. `typingOf()` asked `draftTextarea()`
		// for the plan element it never passed and read the line off the wrong element, so
		// no draft ever held any text.
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			await page.click('#plan .bf-block[data-line="1"] .bf-block__add');
			await page.fill(".bf-composer textarea", "half a thought");
			await page.reload({ waitUntil: "load" });
			await page.waitForSelector(".bf-composer textarea", { timeout: REVIEW_PAINT_MS });
			expect(await page.inputValue(".bf-composer textarea")).toBe("half a thought");
		} finally {
			await page.close();
			await local.close();
		}
	});
});
