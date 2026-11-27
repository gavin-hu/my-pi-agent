/**
 * The file view's chrome, in a browser: the two controls the page draws, the facts that say it
 * is a reader rather than a diff, and the stream it holds so the review survives the visit.
 *
 * A string suite can read the markup the server wrote; only a browser can say that a click
 * reaches the client the page serves. The page ships its own small script, so the theme toggle,
 * the wrap button and the default cursor are DOM facts after an interaction — and the key
 * sheet's absent trigger is the other half: a page that serves no sheet draws none.
 *
 * The last two cases need the shipping mount, not the bare handler: a review's lifetime is its
 * page's streams, and only a real registry can say a page was abandoned. `GRACE_MS` is that
 * fixture's own grace, so the wait past it is bounded by the feature rather than a sleep.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import type { DiffLine } from "../../../lib/diff/parse.ts";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import { waitFor } from "../../../test/helpers/process.ts";
import {
	CASE_MS,
	fileAddress,
	islandToken,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	withFilePage,
	withReviewPage,
} from "../../../test/helpers/review-browser.ts";

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

/** Two context lines, numbered as a whole file's are. */
const TEXT: DiffLine[] = [
	{ kind: "ctx", text: "const one = 1;", oldNo: 1, newNo: 1 },
	{ kind: "ctx", text: "const two = 2;", oldNo: 2, newNo: 2 },
];

/** The fixture's own closed-tab grace, short enough that a case can outlive it. */
const GRACE_MS = 500;

/** One element's computed cursor: the browser's answer, not the sheet's. */
function cursorOf(page: Page, selector: string): Promise<string> {
	return page
		.locator(selector)
		.first()
		.evaluate(
			(node) =>
				(globalThis as unknown as { getComputedStyle: (n: unknown) => { cursor: string } }).getComputedStyle(node)
					.cursor,
		);
}

gated("the file view's chrome", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	test(
		"the theme toggle reaches the page's own client",
		async () => {
			await withFilePage(
				browser,
				async (page) => {
					// The header draws it, so it has to work: before this card the file view shipped the
					// button and none of the wiring, and a click changed nothing.
					await page.click("#theme-toggle");
					expect(await page.locator("html").getAttribute("data-theme")).toMatch(/^(light|dark)$/);
				},
				{ fileText: TEXT },
			);
		},
		CASE_MS,
	);

	test(
		"the wrap button speaks for the text it sits over",
		async () => {
			await withFilePage(
				browser,
				async (page) => {
					const wrap = () => page.locator("pre.rv-diff").getAttribute("data-wrap");
					const pressed = () => page.locator("#rv-wrap").getAttribute("aria-pressed");
					// The file view wraps by default, at every width: the server rendered the state.
					expect(await wrap()).toBe("true");
					expect(await pressed()).toBe("true");

					await page.locator("#rv-wrap").click();
					expect(await wrap()).toBe("false");
					expect(await pressed()).toBe("false");

					await page.locator("#rv-wrap").click();
					expect(await wrap()).toBe("true");
					expect(await pressed()).toBe("true");
				},
				{ fileText: TEXT },
			);
		},
		CASE_MS,
	);

	test(
		"a whole file draws one number per row, with no sign and no pick",
		async () => {
			await withFilePage(
				browser,
				async (page) => {
					const row = page.locator(".bf-diff-line").first();
					expect(await row.locator(".browse-diff-no").count()).toBe(1);
					expect(await row.locator(".browse-diff-sign").count()).toBe(0);
					// The diff page's gutter is a pick target; this page has no pick handler, so the
					// cursor must not promise one.
					expect(await cursorOf(page, ".browse-diff-no")).toBe("default");
				},
				{ fileText: TEXT },
			);
		},
		CASE_MS,
	);

	test(
		"the page offers no control it cannot wire",
		async () => {
			await withFilePage(
				browser,
				async (page) => {
					// The review page serves a key sheet; this one does not, so it draws no trigger.
					expect(await page.locator("#keys-open").count()).toBe(0);
					// The text is a named tab stop: the scroll region is reachable by keyboard.
					await page.locator("pre.rv-diff").focus();
					expect(
						await page.evaluate(
							() =>
								(globalThis as unknown as { document: { activeElement: { tagName: string } } }).document.activeElement
									.tagName,
						),
					).toBe("PRE");
				},
				{ fileText: TEXT },
			);
		},
		CASE_MS,
	);

	test(
		"a visit to a file keeps the review open, and the page's token with it",
		async () => {
			await withReviewPage(
				browser,
				async (page, fixture) => {
					const token = await islandToken(page);
					// Registered before the visit: the response is the proof that the file page's stream reached
					// the server, which is the fact the page's lifetime hangs on.
					const streamed = page.waitForResponse((response) => response.url().includes("/events?token="), {
						timeout: REVIEW_PAINT_MS,
					});
					await page.goto(fileAddress(fixture.url, "a.ts", token), { waitUntil: "load" });
					await streamed;
					await page.waitForSelector("pre.rv-diff", { timeout: REVIEW_PAINT_MS });

					// The diff page's departure armed a grace; the file page's stream stood it down, so firing
					// it does nothing. Before this fix the same fire abandoned the review.
					fixture.fireGrace();
					expect(fixture.abandoned()).toBe(0);

					// And going back is the same page, not a fresh review minted over the old one.
					await page.goto(fixture.url, { waitUntil: "load" });
					await page.waitForSelector("#rv-filter", { timeout: REVIEW_PAINT_MS });
					expect(await islandToken(page)).toBe(token);
				},
				{},
				[],
				false,
				TEXT,
				{ graceMs: GRACE_MS },
			);
		},
		CASE_MS,
	);

	test(
		"a tab that leaves for somewhere else still ends the review",
		async () => {
			await withFilePage(
				browser,
				async (page, fixture) => {
					// The control: the same mount, a tab that goes nowhere near the file view. Without this,
					// a broken grace would read as the fix working.
					await page.goto("about:blank", { waitUntil: "load" });
					await waitFor(() => fixture.gracePending(), REVIEW_PAINT_MS);
					fixture.fireGrace();
					expect(fixture.abandoned()).toBe(1);
				},
				{ fileText: TEXT, lifetime: { graceMs: GRACE_MS } },
			);
		},
		CASE_MS,
	);
});
