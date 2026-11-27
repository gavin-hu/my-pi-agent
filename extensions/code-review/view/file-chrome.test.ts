/**
 * The file view's chrome, in a browser: the two controls the page draws, and the facts that say
 * it is a reader rather than a diff.
 *
 * A string suite can read the markup the server wrote; only a browser can say that a click
 * reaches the client the page serves. The page ships its own small script, so the theme toggle,
 * the wrap button and the default cursor are DOM facts after an interaction — and the key
 * sheet's absent trigger is the other half: a page that serves no sheet draws none.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import type { DiffLine } from "../../../lib/diff/parse.ts";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import { CASE_MS, REVIEW_CHROME, withFilePage } from "../../../test/helpers/review-browser.ts";

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

/** Two context lines, numbered as a whole file's are. */
const TEXT: DiffLine[] = [
	{ kind: "ctx", text: "const one = 1;", oldNo: 1, newNo: 1 },
	{ kind: "ctx", text: "const two = 2;", oldNo: 2, newNo: 2 },
];

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
				TEXT,
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
				TEXT,
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
				TEXT,
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
				TEXT,
			);
		},
		CASE_MS,
	);
});
