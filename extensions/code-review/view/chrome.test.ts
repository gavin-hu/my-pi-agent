/**
 * The review page's chrome, in a browser: what the rail's controls do to it, the band it folds
 * into, and the wrap button that has to speak for the row at every width.
 *
 * Split from `interaction.test.ts` when #819 (the kit's sidebar) and #814 (the wrap toggle's one
 * owner) pushed that suite past the size bar. The reading — cursor, place, spill — is one
 * capability; what the controls do to the rail and the diff is another, and the launch,
 * the fixture and the comment helper are shared through `test/helpers/review-browser.ts`.
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
import { REVIEW_NARROW_PX } from "./styles.ts";

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

gated("the review page's chrome", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	/** The one launch, and the fixture-and-page ownership, the helper keeps for both suites. */
	const withPage = (
		run: (page: Page, fixture: ReviewPageFixture) => Promise<void>,
		options: SnapshotOptions = {},
		seed: readonly SeedComment[] = [],
	): Promise<void> => withReviewPage(browser, run, options, seed);

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
		"a focused page's Commented view says why the rail is empty, not that a filter matched nothing",
		async () => {
			await withPage(
				async (page, fixture) => {
					// One file of a two-file scope, and the comment is on the other one: the rail is empty for a
					// reason no filter explains — which the page used to report as `No files match ""`.
					await page.goto(`${fixture.url}?file=a.ts`, { waitUntil: "load" });
					await page.waitForSelector("#rv-filter", { timeout: REVIEW_PAINT_MS });
					expect(await page.locator("#rv-file-count").textContent()).toBe("1 of 2 files");

					await page.locator("#rv-view-commented").click();
					expect(await page.locator("#rv-file-count").textContent()).toBe("0 of 2 files");
					expect(await page.locator("#rv-rail-empty-text").textContent()).toBe(
						"No comments in this file — clear Commented to see it",
					);
					// The control the sentence names does what it says.
					await page.locator("#rv-view-all").click();
					expect(await page.locator(".rv-rail").first().isVisible()).toBe(true);
				},
				{ second: true },
				[{ rel: "b.ts", line: 1, side: "new", body: "on the other file" }],
			);
		},
		CASE_MS,
	);

	test(
		"an unmark names the state it leaves, which for a file with no comment is not commented",
		async () => {
			await withPage(async (page) => {
				const mark = page.locator("[data-reviewed='a.ts']");
				await mark.click();
				await page.waitForFunction(
					() =>
						(globalThis as unknown as ReviewDom).document
							.querySelector("#rv-toast")
							?.textContent?.includes("Marked reviewed") === true,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator("#rv-toast").textContent()).toBe("Marked reviewed — a.ts");

				await mark.click();
				await page.waitForFunction(
					() =>
						(globalThis as unknown as ReviewDom).document
							.querySelector("#rv-toast")
							?.textContent?.includes("no comment") === true,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				// The page's own word for a file with no comment, rather than a state it never had.
				expect(await page.locator("#rv-toast").textContent()).toBe("no comment — a.ts");
			});
		},
		CASE_MS,
	);

	test(
		"the Commented view says what it hides, before and after the first comment",
		async () => {
			await withPage(async (page) => {
				// Nothing to narrow to yet: the press hides every row and the note explains why, rather
				// than the control being disabled and the press doing nothing.
				await page.locator("#rv-view-commented").click();
				expect(await page.locator("#rv-view-commented").getAttribute("aria-pressed")).toBe("true");
				expect(await page.locator("#rv-view-all").getAttribute("aria-pressed")).toBe("false");
				expect(await page.locator("#rv-file-count").textContent()).toBe("0 of 1 files");
				expect(await page.locator("#rv-rail-empty-text").textContent()).toBe("No comments on this review yet");
				// The diff keeps the section it is about: the rail narrows, the pane does not.
				expect(await page.locator(".rv-file").isVisible()).toBe(true);

				await page.locator("#rv-rail-clear").click();
				expect(await page.locator("#rv-view-all").getAttribute("aria-pressed")).toBe("true");

				await startComment(page, "one note");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });

				await page.locator("#rv-view-commented").click();
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

	/**
	 * #814: the wrap button must report what the diff is doing at the width the reader has. Below the
	 * fold the page wraps by rule, so the button starts pressed there and pressing it is what
	 * unwraps; above it, the server's unwrapped default stands until the reader presses.
	 */
	test(
		"the wrap button speaks for the row, above and below the fold",
		async () => {
			await withPage(async (page) => {
				const rowWrap = () =>
					page.evaluate(() => {
						const doc = (globalThis as unknown as ReviewDom).document;
						const row = doc.querySelector(".rv-diff .bf-diff-line");
						const style = (
							globalThis as unknown as { getComputedStyle: (node: unknown) => { whiteSpace: string } }
						).getComputedStyle(row);
						return style.whiteSpace;
					});
				const pressed = () => page.locator("#rv-wrap").getAttribute("aria-pressed");

				expect(await rowWrap()).toBe("pre");
				expect(await pressed()).toBe("false");
				await page.locator("#rv-wrap").click();
				expect(await rowWrap()).toBe("pre-wrap");
				expect(await pressed()).toBe("true");

				// Below the fold the page wraps on its own, and a fresh load says so.
				await page.setViewportSize({ width: 760, height: 900 });
				await reloadReview(page);
				await page.waitForFunction(
					() =>
						(globalThis as unknown as ReviewDom).document.getElementById("rv-wrap")?.getAttribute("aria-pressed") ===
						"true",
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await rowWrap()).toBe("pre-wrap");
				// The reader's own "no" is the one thing that unwraps it here.
				await page.locator("#rv-wrap").click();
				expect(await rowWrap()).toBe("pre");
				expect(await pressed()).toBe("false");
			});
		},
		CASE_MS,
	);

	/**
	 * The rail is the shell's sidebar, so at this page's own width it becomes a band above the diff
	 * with the kit's disclosure — the shape the plan page and browse wear — and above it the summary
	 * is the kit's hidden element rather than a stray triangle on the desk.
	 */
	test(
		"the rail is the kit's band below the page's fold",
		async () => {
			await withPage(async (page) => {
				expect(await page.locator(".bf-app__sidebar .bf-panel__summary").isHidden()).toBe(true);

				await page.setViewportSize({ width: REVIEW_NARROW_PX, height: 800 });
				await page.waitForFunction(
					() => {
						const doc = (globalThis as unknown as ReviewDom).document;
						const summary = doc.querySelector(".bf-app__sidebar .bf-panel__summary");
						return summary !== null && summary.offsetHeight > 0;
					},
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator(".bf-app__sidebar .bf-panel__summary").isVisible()).toBe(true);
				const band = await page.locator(".bf-app__sidebar").boundingBox();
				const main = await page.locator("#rv-main").boundingBox();
				const viewport = page.viewportSize();
				expect(band?.width, "the band spans the page").toBe(viewport?.width);
				expect(main?.y ?? 0, "the diff starts under the band").toBeGreaterThanOrEqual(
					(band?.y ?? 0) + (band?.height ?? 0) - 1,
				);
			});
		},
		CASE_MS,
	);

	/**
	 * A save shows two layers at once: the bar re-opens under the cursor, and the toast says what
	 * happened. They share the bottom of the page, so the toast must sit above the bar — measured,
	 * because the bar's height follows its content — or it covers the control it just freed.
	 */
	test(
		"a toast after a save sits above the selection bar, not on it",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "one note");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				const boxes = await page.evaluate(() => {
					const doc = (globalThis as unknown as ReviewDom).document;
					const bar = doc.querySelector("#rv-selbar");
					const toast = doc.querySelector("#rv-toast");
					if (bar === null || toast === null) return null;
					const barBox = bar.getBoundingClientRect();
					const toastBox = toast.getBoundingClientRect();
					return {
						open: [bar.getAttribute("data-open"), toast.getAttribute("data-open")],
						bar: { top: barBox.top, bottom: barBox.bottom },
						toast: { top: toastBox.top, bottom: toastBox.bottom },
					};
				});
				expect(boxes).not.toBeNull();
				if (boxes === null) return;
				expect(boxes.open).toEqual(["true", "true"]);
				expect(boxes.toast.bottom, "the toast ends above the bar").toBeLessThanOrEqual(boxes.bar.top);
			});
		},
		CASE_MS,
	);

	/**
	 * The dialog is the kit's, so its opener is the kit's to return to. The page used to preset
	 * `hidden` before `open()`, which made the kit skip its own bookkeeping; these four exits are
	 * the paths a keyboard reader takes and none may leave focus in a hidden panel.
	 */
	test(
		"the send dialog hands focus back on every exit",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "one note");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });

				const openDialog = async () => {
					await page.locator("#rv-send").click();
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.getElementById("rv-send-dialog")?.hidden === false,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
				};
				const active = async () =>
					(await page.evaluate("document.activeElement && document.activeElement.id")) as string | null;

				await openDialog();
				expect(await active()).toBe("rv-send-confirm");
				await page.keyboard.press("Escape");
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.getElementById("rv-send-dialog")?.hidden === true,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await active(), "Escape returns to the Send button").toBe("rv-send");
				expect(await page.locator("#rv-selbar").getAttribute("data-open"), "one layer closes").toBe("true");

				await openDialog();
				await page.locator("#rv-send-close").click();
				expect(await active()).toBe("rv-send");

				await openDialog();
				await page.locator("#rv-send-cancel").click();
				expect(await active()).toBe("rv-send");

				await openDialog();
				await page.locator("#rv-send-confirm").click();
				await page.waitForFunction(
					() =>
						(globalThis as unknown as ReviewDom).document.querySelector("#rv-toast")?.textContent?.includes("sent") ===
						true,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await active(), "the diff takes focus once Send is disabled").toBe("rv-main");
			});
		},
		CASE_MS,
	);
});
