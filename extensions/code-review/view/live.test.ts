/**
 * The review page's live frames, in a browser: a frame that lands under an open composer is held,
 * and closing the box is what puts it on the page.
 *
 * `client.test.ts` says the bundle carries both halves — `liveTyping()` sending a frame to
 * `livePending`, and `closeComposer` calling `liveFlush`. This says what only a page can: with the
 * box open the comment is nowhere in the document, and after closing it the comment is drawn and
 * the count moved. The frame is the only place that comment exists, so seeing it on the page is
 * also the proof that nothing reloaded.
 *
 * The stream is a stub, installed before the page's script by the fixture's `stream: true`; the
 * transport's route and broadcasts are `transport/stream.test.ts`'s to prove.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import {
	CASE_MS,
	mountReviewPage,
	openReviewPage,
	pushFrame,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	type ReviewPageFixture,
	startComment,
} from "../../../test/helpers/review-browser.ts";

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

/** The comment the frame carries: the page has never seen it, because only the frame has it. */
const FROM_ANOTHER_TAB = {
	review: {
		id: "",
		comments: [{ id: "c1", rel: "a.ts", line: 1, side: "new", body: "from another tab", state: "draft", at: 1 }],
		reviewed: [],
	},
};

gated("the review page's live frames", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	});

	afterAll(async () => {
		await browser?.close();
	});

	/** One page with a stream it can be pushed to, and the close both own. */
	const withLivePage = async (run: (page: Page, fixture: ReviewPageFixture) => Promise<void>): Promise<void> => {
		const fixture = await mountReviewPage();
		const page = await openReviewPage(browser, fixture, { stream: true });
		try {
			await run(page, fixture);
		} finally {
			await page.close();
			await fixture.close();
		}
	};

	test(
		"a frame that lands under an open composer is held, and closing the box draws it",
		async () => {
			await withLivePage(async (page) => {
				// The stream is real before anything is pushed: a case that pushed into no stream would
				// satisfy every "nothing drawn" assertion for the wrong reason.
				await page.waitForSelector('#rv-live[data-state], .bf-live:has-text("live")', { timeout: REVIEW_PAINT_MS });

				await startComment(page, "hold this");
				const area = page.locator(".rv-compose__area");
				expect(await area.inputValue()).toBe("hold this");
				expect(await page.locator(".rv-thread").count()).toBe(0);

				await pushFrame(page, FROM_ANOTHER_TAB);
				// Held: the box keeps its text, and the frame's comment is not drawn under it. Both
				// facts are needed — one alone is what a dropped frame and a repaint look like.
				expect(await area.inputValue()).toBe("hold this");
				expect(await page.locator(".rv-thread").count()).toBe(0);
				expect(await page.locator(".rv-compose").count()).toBe(1);

				// Closing the box is what applies it. The comment exists only in the frame, so a page
				// that reloaded would have nothing to draw: seeing it is the flush, not a fresh load.
				await page.locator(".rv-compose__acts .bf-btn--ghost").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				expect(await page.locator(".rv-thread .bf-comment__body").textContent()).toBe("from another tab");
				// The other half of the same defect: the comment is drawn *and* the count agrees with it.
				// A build that draws and leaves the count stale is the disagreement mirrored, and the body
				// assertion above would pass without this line.
				expect(await page.locator("#rv-send").textContent()).toBe("Send feedback 1");
				expect(await page.locator(".rv-compose").count()).toBe(0);
			});
		},
		CASE_MS,
	);
});
