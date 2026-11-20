/**
 * The review page's interactions, in a browser: the draft survives the diff moving, and a
 * write against a moved diff names the way out instead of taking the text.
 *
 * Both are DOM facts after an interaction — a composer restored with its note, a chip
 * revealed, a textarea that still holds what was typed — which is exactly what a string
 * assertion cannot see. The card that added the first case is #758; the helper it lands is
 * `test/helpers/review-browser.ts`, and the later UI cards grow the suite from here.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import {
	mountReviewPage,
	openReviewPage,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	type ReviewPageFixture,
	type SnapshotOptions,
} from "../../../test/helpers/review-browser.ts";

/** A browser case pays a launch, a load, and an interaction. */
const CASE_MS = 30_000;

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

gated("the review page's interactions", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	});

	afterAll(async () => {
		await browser?.close();
	});

	/** One fixture, one page, and the close both own. */
	async function withPage(
		run: (page: Page, fixture: ReviewPageFixture) => Promise<void>,
		options: SnapshotOptions = {},
	): Promise<void> {
		const fixture = await mountReviewPage(options);
		const page = await openReviewPage(browser, fixture);
		try {
			await run(page, fixture);
		} finally {
			await page.close();
			await fixture.close();
		}
	}

	/** Comment on the added line and leave the composer open with `text`. */
	async function startComment(page: Page, text: string): Promise<void> {
		await page.locator(".bf-diff-line--add .browse-diff-no").filter({ hasText: /^\d+$/ }).first().click();
		await page.locator("#rv-sel-comment").click();
		await page.locator(".rv-compose__area").fill(text);
	}

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
		"a filter that matches nothing leaves the diff readable and offers a clear",
		async () => {
			await withPage(async (page) => {
				await page.fill("#rv-filter", "zzz");
				await page.waitForSelector("#rv-rail-empty", { state: "visible", timeout: REVIEW_PAINT_MS });
				expect(await page.locator("#rv-rail-empty-text").textContent()).toBe('No files match "zzz"');
				expect(await page.locator("#rv-file-count").textContent()).toBe("0 of 1 files");
				// The rail narrowed; the reading pane did not.
				expect(await page.locator(".rv-file").isVisible()).toBe(true);
				expect(await page.locator("#rv-filter-note").isVisible()).toBe(true);
				expect(await page.locator("#rv-filter-note-text").textContent()).toContain(
					'Showing 0 of 1 files · filter "zzz"',
				);

				await page.locator("#rv-rail-clear").click();
				expect(await page.locator("#rv-filter").inputValue()).toBe("");
				expect(await page.locator("#rv-rail-empty").isHidden()).toBe(true);
				expect(await page.locator(".rv-rail").first().isVisible()).toBe(true);
				expect(await page.locator("#rv-filter-note").isHidden()).toBe(true);
			});
		},
		CASE_MS,
	);

	test(
		"only commented is offered only once there is one",
		async () => {
			await withPage(async (page) => {
				const box = page.locator("#rv-only-commented");
				const label = page.locator("label").filter({ has: page.locator("#rv-only-commented") });
				expect(await box.isDisabled()).toBe(true);
				expect(await label.getAttribute("title")).toBe("No comments on this review yet");

				await startComment(page, "one note");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });

				expect(await box.isDisabled()).toBe(false);
				await box.check();
				expect(await page.locator("#rv-file-count").textContent()).toBe("1 of 1 files");
				expect(await page.locator("#rv-filter-note-text").textContent()).toContain(
					"Showing 1 of 1 files · only commented",
				);
				// Narrowed to the one file, it is still drawn.
				expect(await page.locator(".rv-file").isVisible()).toBe(true);
			});
		},
		CASE_MS,
	);

	test(
		"a rail click moves the file without selecting a line",
		async () => {
			await withPage(
				async (page) => {
					await page.locator(".rv-rail").nth(1).click();
					expect(await page.locator("[data-picked='true']").count()).toBe(0);
					expect(await page.locator("#rv-selbar").getAttribute("data-open")).toBe("false");
					expect(await page.locator(".rv-rail").nth(1).getAttribute("aria-current")).toBe("true");
					expect((await page.evaluate("location.hash")) as string).toBe("#rv-file-1");
				},
				{ second: true },
			);
		},
		CASE_MS,
	);

	test(
		"j puts the cursor on the first line the diff shows, not line 1",
		async () => {
			await withPage(
				async (page) => {
					await page.keyboard.press("j");
					expect(await page.locator("[data-picked='true']").count()).toBe(1);
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("a.ts:17");
					expect((await page.evaluate("document.activeElement.className")) as string).toContain("bf-diff-line");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	test(
		"the arrows move the cursor, and a move crosses into the next visible file",
		async () => {
			await withPage(
				async (page) => {
					await page.keyboard.press("j");
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("a.ts:17");
					await page.keyboard.press("ArrowDown");
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("a.ts:18");
					await page.keyboard.press("j");
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("a.ts:19");
					await page.keyboard.press("j");
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("b.ts:40");
					expect(await page.locator(".rv-rail").nth(1).getAttribute("aria-current")).toBe("true");
				},
				{ start: 17, second: true },
			);
		},
		CASE_MS,
	);

	test(
		"Enter and c comment at the cursor",
		async () => {
			await withPage(
				async (page) => {
					await page.keyboard.press("j");
					await page.keyboard.press("Enter");
					expect(await page.locator(".rv-compose__head").textContent()).toContain("a.ts:17");
					await page.keyboard.press("Escape");
					expect(await page.locator(".rv-compose__area").count()).toBe(0);
					await page.keyboard.press("c");
					expect(await page.locator(".rv-compose__head").textContent()).toContain("a.ts:17");
				},
				{ start: 17 },
			);
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

	test(
		"m marks the current file, and its box names it",
		async () => {
			await withPage(
				async (page) => {
					await page.keyboard.press("j");
					await page.keyboard.press("m");
					await page.waitForSelector('.rv-rail[data-state="reviewed"]', { timeout: REVIEW_PAINT_MS });
					expect(await page.locator("[data-reviewed='a.ts']").isChecked()).toBe(true);
					expect(await page.locator("[data-reviewed='a.ts']").getAttribute("aria-label")).toBe("Mark a.ts reviewed");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);
});
