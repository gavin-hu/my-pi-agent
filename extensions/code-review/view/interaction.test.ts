/**
 * The review page's interactions, in a browser: the draft survives the diff moving, and a
 * write against a moved diff names the way out instead of taking the text.
 *
 * Both are DOM facts after an interaction — a composer restored with its note, a chip
 * revealed, a textarea that still holds what was typed — which is exactly what a string
 * assertion cannot see. The card that added the first case is #758; the helper it lands is
 * `test/helpers/review-browser.ts`, and the later UI cards grow the suite from here.
 *
 * No case sleeps. A fixed wait asserts that this machine was fast enough, which is what reddened
 * a gate under load (#711), so each case waits on the state its assertion reads — a scroll's
 * geometry, the spy's `aria-current`, a write's thread — with `REVIEW_PAINT_MS` as its budget.
 * Those predicates are functions and not strings: the page answers with `script-src 'self'`, and
 * a string predicate is evaluated, which that policy refuses (#764).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import {
	CASE_MS,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	type ReviewDom,
	type ReviewPageFixture,
	type SnapshotOptions,
	startComment,
	withReviewPage,
} from "../../../test/helpers/review-browser.ts";

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

gated("the review page's interactions", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	});

	afterAll(async () => {
		await browser?.close();
	});

	/** The one launch, and the fixture-and-page ownership, the helper keeps for both suites. */
	const withPage = (
		run: (page: Page, fixture: ReviewPageFixture) => Promise<void>,
		options: SnapshotOptions = {},
	): Promise<void> => withReviewPage(browser, run, options);

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

	test(
		"the file head pins, and a hunk jump lands below it at 1280 and 390",
		async () => {
			await withPage(
				async (page) => {
					const read = () =>
						page.evaluate(`(function () {
							var main = document.getElementById("rv-main").getBoundingClientRect();
							var head = document.querySelector(".rv-file__head").getBoundingClientRect();
							var hunk = document.querySelector(".bf-diff-line--hunk").getBoundingClientRect();
							return {
								mainTop: Math.round(main.top),
								headTop: Math.round(head.top),
								headBottom: Math.round(head.bottom),
								hunkTop: Math.round(hunk.top)
							};
						})()`) as Promise<{ mainTop: number; headTop: number; headBottom: number; hunkTop: number }>;
					const assertJump = async () => {
						await page.keyboard.press("]");
						// The jump is a scroll this page made, so wait for the geometry the assertion reads
						// rather than for the machine to have got there.
						await page.waitForFunction(
							() => {
								const doc = (globalThis as unknown as ReviewDom).document;
								const head = doc.querySelector(".rv-file__head")?.getBoundingClientRect();
								const hunk = doc.querySelector(".bf-diff-line--hunk")?.getBoundingClientRect();
								return head !== undefined && hunk !== undefined && hunk.top >= head.bottom - 1;
							},
							undefined,
							{ timeout: REVIEW_PAINT_MS },
						);
						const rects = await read();
						expect(rects.hunkTop).toBeGreaterThanOrEqual(rects.headBottom - 1);
					};

					await page.evaluate('document.getElementById("rv-main").scrollTop = 700');
					// Pinning is the scroll's own effect at the scrollport's top, which is what the
					// assertion below reads: the box moved, and the head stayed on it. The scroll is
					// the page's own height, so it lands short of the 700 asked for and clamped.
					await page.waitForFunction(
						() => {
							const doc = (globalThis as unknown as ReviewDom).document;
							const main = doc.getElementById("rv-main");
							const head = doc.querySelector(".rv-file__head")?.getBoundingClientRect();
							if (main === null || head === undefined) return false;
							return main.scrollTop > 0 && Math.abs(head.top - main.getBoundingClientRect().top) <= 1;
						},
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					const pinned = await read();
					expect(Math.abs(pinned.headTop - pinned.mainTop), "the head pins at the scrollport top").toBeLessThanOrEqual(
						1,
					);
					await assertJump();

					await page.setViewportSize({ width: 390, height: 844 });
					// A narrower head is taller and the jump is measured against it: wait for the page's
					// own re-measure at the new width, which is the fact the next jump depends on.
					await page.waitForFunction(
						() => {
							const doc = (globalThis as unknown as ReviewDom).document;
							const section = doc.querySelector(".rv-file");
							const head = section?.querySelector(".rv-file__head");
							if (section === null || head === null || head === undefined) return false;
							return section.style.getPropertyValue("--rv-head-h") === `${head.offsetHeight}px`;
						},
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					await assertJump();
				},
				{ start: 17, lines: 60 },
			);
		},
		CASE_MS,
	);

	test(
		"the rail marks the file in view while scrolling",
		async () => {
			await withPage(
				async (page) => {
					await page.evaluate('document.querySelectorAll(".rv-file")[1].scrollIntoView({ block: "start" })');
					// The spy repaints on a frame, and the mark it moves is the state this case reads.
					await page.waitForFunction(
						() => {
							const rail = (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-rail");
							return rail[1]?.getAttribute("aria-current") === "true";
						},
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator(".rv-rail").nth(1).getAttribute("aria-current")).toBe("true");
					expect(await page.locator(".rv-rail").nth(0).getAttribute("aria-current")).toBe("false");
				},
				{ second: true, lines: 60 },
			);
		},
		CASE_MS,
	);

	test(
		"a key move brings the rail's current row into view",
		async () => {
			await withPage(
				async (page, fixture) => {
					// Start at the second line of f22.ts; two moves cross into f23.ts.
					await page.goto(`${fixture.url}#rv-file-21:840`, { waitUntil: "networkidle" });
					// A hash-only navigation does not reload; the place is restored by a load.
					await page.reload({ waitUntil: "networkidle" });
					await page.keyboard.press("j");
					await page.keyboard.press("j");
					await page.keyboard.press("j");
					// The third move is the one that crosses into f23.ts; the rail follows the place.
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document
								.querySelector('.rv-rail[aria-current="true"]')
								?.getAttribute("data-path") === "f23.ts",
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					const row = (await page.evaluate(`(function () {
						var rail = Array.prototype.filter.call(document.querySelectorAll(".rv-rail"), function (r) {
							return r.getAttribute("aria-current") === "true";
						})[0];
						var box = document.querySelector(".rv-side-scroll").getBoundingClientRect();
						var rect = rail.getBoundingClientRect();
						return {
							path: rail.getAttribute("data-path"),
							inside: rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
						};
					})()`)) as { path: string; inside: boolean };
					expect(row.path).toBe("f23.ts");
					expect(row.inside, "the rail scrolled to its current row").toBe(true);
				},
				{ files: 24 },
			);
		},
		CASE_MS,
	);

	test(
		"a reload restores the cursor from the place",
		async () => {
			await withPage(
				async (page) => {
					await page.keyboard.press("j");
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("a.ts:17");
					await page.reload({ waitUntil: "networkidle" });
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("a.ts:17");
					expect(await page.locator("[data-picked='true']").count()).toBe(1);
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	test(
		"a hash naming a file the render dropped falls back to the first section",
		async () => {
			await withPage(
				async (page, fixture) => {
					await page.goto(`${fixture.url}#rv-file-9`, { waitUntil: "networkidle" });
					await page.reload({ waitUntil: "networkidle" });
					// The restore falls back to the first section and writes the hash as it does, so the
					// hash is the state the assertion reads.
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).location.hash === "#rv-file-0",
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect((await page.evaluate("location.hash")) as string).toBe("#rv-file-0");
					expect(await page.locator(".rv-rail").first().getAttribute("aria-current")).toBe("true");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	/**
	 * The mint-then-write guard, and the words that come with it: the first save mints the review
	 * and writes a comment, and the second save on the same page must land — if the shas had moved
	 * the snapshot's fingerprint, the page's own next write would be refused as SNAPSHOT_MOVED.
	 * The footer is the one place the comparison and the counts are read, which is why this case
	 * reads them there and nowhere in the header.
	 */
	test(
		"the footer names the comparison and the drafts, and a second write lands",
		async () => {
			await withPage(
				async (page) => {
					await startComment(page, "one");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });

					expect(await page.locator("#rv-facts").textContent()).toContain("main...HEAD");
					expect(await page.locator("#rv-facts").textContent()).toContain("1 draft");

					await startComment(page, "two");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					// The second write's thread is the state the counts below read.
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 2,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator(".rv-thread").count()).toBe(2);
					// The count is read exactly: `toContain("2 draft")` is green on "2 drafts" too.
					expect(await page.locator("#rv-facts").textContent()).toContain("2 drafts");
					expect(await page.locator("#rv-send").textContent()).toBe("Send feedback 2");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);
});
