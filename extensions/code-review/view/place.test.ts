/**
 * The review page's place, in a browser: the reading line a deep link, a hunk jump and a cursor
 * move land on, the tail room the last screenful needs, and the scope each hunk key keeps.
 *
 * A row's position in the viewport is a measurement, not a string, so every case here reads
 * geometry after an interaction: the picked row's distance from the reading line — a third of the
 * band under the pinned head — the scroll the page chose, the file the rail marks, and the words a
 * key that has nothing left to reach answers with.
 *
 * The suite is a page suite (it boots Chrome) and is declared in `BROWSER_SUITES` and the local
 * smoke tier, so `bun run check` runs it: the review page's navigation is the page's behaviour,
 * not a corner a landing can skip. The fixture and its waits are `test/helpers/review-browser.ts`.
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
	withReviewPage,
} from "../../../test/helpers/review-browser.ts";

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

/** What a case reads about the place: where the row sits, and what the page says about it. */
interface Place {
	/** The main's scroll, rounded, and the most it can take. */
	scroll: number;
	max: number;
	/** The picked row's top minus the reading line: 0 is on the line. */
	offset: number | null;
	/** Whether the file's head is pinned at the scrollport's top. */
	headPinned: boolean;
	/** The bar's ref, the hash, the toast, the file, and whether the row is a changed line. */
	ref: string;
	hash: string;
	toast: string;
	path: string;
	changed: boolean;
}

/** The page's own geometry, read after an interaction. */
function placeOf(page: Page): Promise<Place> {
	return page.evaluate(`(function () {
		var doc = document;
		var main = doc.getElementById("rv-main");
		var box = main.getBoundingClientRect();
		var picked = doc.querySelector('[data-picked="true"]');
		var section = picked ? picked.closest(".rv-file") : null;
		var head = section ? section.querySelector(".rv-file__head") : null;
		var height = head ? head.offsetHeight : 0;
		var line = box.top + height + (main.clientHeight - height) / 3;
		var rect = picked ? picked.getBoundingClientRect() : null;
		return {
			scroll: Math.round(main.scrollTop),
			max: Math.round(main.scrollHeight - main.clientHeight),
			offset: rect ? Math.round((rect.top - line) * 10) / 10 : null,
			headPinned: head ? Math.abs(head.getBoundingClientRect().top - box.top) <= 1 : false,
			ref: doc.getElementById("rv-selbar-ref").textContent,
			hash: location.hash,
			toast: doc.getElementById("rv-toast").textContent,
			path: section ? section.getAttribute("data-path") : "",
			changed: picked ? picked.className.indexOf("bf-diff-line--ctx") < 0 : false
		};
	})()`) as Promise<Place>;
}

/**
 * The sliver of the document an init script touches.
 *
 * This project's test build has no DOM lib — the client is a string, so nothing here ever compiled
 * against one — and a script handed to Playwright is serialized into the page, so it cannot close
 * over a helper either. Hence the shim: the two members the style injection uses.
 */
interface AnchorDom {
	document: {
		head: { appendChild(node: unknown): void } | null;
		createElement(tag: string): { textContent: string };
	};
	MutationObserver: new (
		callback: () => void,
	) => {
		observe(target: unknown, options: unknown): void;
		disconnect(): void;
	};
}

/** Wait until the bar names a ref the page has not shown yet, which is what a jump writes. */
function nextPlace(page: Page): Promise<void> {
	return page
		.waitForFunction(
			() => {
				const doc = (globalThis as unknown as ReviewDom).document;
				const row = doc.querySelector("[data-picked='true']");
				return row !== null && (doc.getElementById("rv-selbar-ref")?.textContent ?? "") !== "";
			},
			undefined,
			{ timeout: REVIEW_PAINT_MS },
		)
		.then(() => undefined);
}

gated("the review page's place", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	const withPage = (
		run: (page: Page, fixture: ReviewPageFixture) => Promise<void>,
		options: SnapshotOptions = {},
	): Promise<void> => withReviewPage(browser, run, options);

	/**
	 * A deep link names a line, and the page opens on it with the file's own lines above: the
	 * reading line is what makes that context, where a row placed at the head shows none.
	 */
	test(
		"a deep link lands the row on the reading line, with its file's lines above it",
		async () => {
			await withPage(
				async (page, fixture) => {
					await page.goto(`${fixture.url}#rv-file-1:60`, { waitUntil: "load" });
					await page.reload({ waitUntil: "load" });
					await nextPlace(page);
					const place = await placeOf(page);
					expect(place.path).toBe("f2.ts");
					expect(place.ref).toBe("f2.ts:60");
					expect(place.offset, "the row sits on the reading line").toBeGreaterThanOrEqual(-1);
					expect(place.offset).toBeLessThanOrEqual(1);
					expect(place.scroll, "the file's lines above it are reachable").toBeGreaterThan(0);
					expect(place.headPinned, "the file's head is pinned above the row").toBe(true);
				},
				{ files: 3, lines: 40 },
			);
		},
		CASE_MS,
	);

	/**
	 * The clamp cannot own the place: the tail room below the last row is what lets the review's
	 * final line reach the reading line instead of stopping where the content ends.
	 */
	test(
		"the review's last line reaches the reading line, short of the scroll's end",
		async () => {
			await withPage(
				async (page, fixture) => {
					await page.goto(`${fixture.url}#rv-file-2:120`, { waitUntil: "load" });
					await page.reload({ waitUntil: "load" });
					await nextPlace(page);
					const place = await placeOf(page);
					expect(place.ref).toBe("f3.ts:120");
					expect(place.offset, "the last row still lands on the line").toBeGreaterThanOrEqual(-1);
					expect(place.offset).toBeLessThanOrEqual(1);
					expect(place.scroll, "the tail, not the content's end, decides the place").toBeLessThan(place.max);
				},
				{ files: 3, lines: 40 },
			);
		},
		CASE_MS,
	);

	/**
	 * A hunk jump moves the place, not only the viewport: the cursor lands on the hunk's first
	 * changed row, the hash and the rail follow, and the press that has nothing left says so.
	 */
	test(
		"a hunk jump moves the place to the changed row, and the end says no more",
		async () => {
			await withPage(
				async (page) => {
					await page.keyboard.press("]");
					await nextPlace(page);
					const first = await placeOf(page);
					expect(first.ref, "the jump lands on the hunk's first changed row").toBe("f2.ts:80");
					expect(first.changed, "and on a changed row, not a context line").toBe(true);
					expect(first.offset).toBeGreaterThanOrEqual(-1);
					expect(first.offset).toBeLessThanOrEqual(1);
					expect(first.hash).toBe("#rv-file-1:80");
					expect(first.path, "the rail follows the jump").toBe("f2.ts");

					await page.keyboard.press("]");
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document.getElementById("rv-selbar-ref")?.textContent ===
							"f3.ts:120",
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					const last = await placeOf(page);
					expect(last.path).toBe("f3.ts");
					expect(last.changed).toBe(true);

					// Nothing below the last hunk: the key answers rather than leaving the page still.
					await page.keyboard.press("]");
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document.getElementById("rv-toast")?.textContent ===
							"No more changes",
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					const after = await placeOf(page);
					expect(after.ref).toBe("f3.ts:120");
					expect(after.hash).toBe("#rv-file-2:120");
				},
				{ files: 3, lines: 40 },
			);
		},
		CASE_MS,
	);

	/**
	 * The two scopes the keys promise: `n`/`p` stay inside the cursor's file, and answer when that
	 * file has no more changes; `]`/`[` cross into the next file and the rail follows.
	 */
	test(
		"n stays inside the file while ] crosses into the next one",
		async () => {
			await withPage(
				async (page) => {
					await page.keyboard.press("]");
					await nextPlace(page);
					expect((await placeOf(page)).ref).toBe("f2.ts:80");

					await page.keyboard.press("n");
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document.getElementById("rv-toast")?.textContent ===
							"No more changes in f2.ts",
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					const inside = await placeOf(page);
					expect(inside.ref, "the place did not move past its file").toBe("f2.ts:80");
					expect(inside.path).toBe("f2.ts");

					await page.keyboard.press("]");
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document.getElementById("rv-selbar-ref")?.textContent ===
							"f3.ts:120",
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect((await placeOf(page)).path, "the review-wide key crossed the file").toBe("f3.ts");
				},
				{ files: 3, lines: 40 },
			);
		},
		CASE_MS,
	);

	/** A hash-only navigation does not reload, and the line names no element: the page restores it. */
	test(
		"a hash-only navigation restores the place",
		async () => {
			await withPage(
				async (page) => {
					await page.evaluate(`location.hash = "#rv-file-1:60"`);
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document.getElementById("rv-selbar-ref")?.textContent === "f2.ts:60",
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					const place = await placeOf(page);
					expect(place.offset).toBeGreaterThanOrEqual(-1);
					expect(place.offset).toBeLessThanOrEqual(1);
					expect(place.hash, "the hash the reader typed is the place").toBe("#rv-file-1:60");
				},
				{ files: 3, lines: 40 },
			);
		},
		CASE_MS,
	);

	/**
	 * A restored draft is height above the line the hash names, and the reveal must measure the
	 * viewport it lands in rather than the one the line was in — so the composer is restored first,
	 * and scroll anchoring is not what saves the place (the case turns it off).
	 */
	test(
		"a restored draft above the line leaves the line on the reading line",
		async () => {
			await withPage(
				async (page, fixture) => {
					await page.keyboard.press("j");
					await page.keyboard.press("Enter");
					await page.locator(".rv-compose__area").waitFor({ timeout: REVIEW_PAINT_MS });
					await page.keyboard.type("unsent note");
					await page.addInitScript(() => {
						const host = globalThis as unknown as AnchorDom;
						let seen: { observe(target: unknown, options: unknown): void; disconnect(): void };
						seen = new host.MutationObserver(() => {
							if (host.document.head === null) return;
							const style = host.document.createElement("style");
							style.textContent = ".rv-main{overflow-anchor:none}";
							host.document.head.appendChild(style);
							seen.disconnect();
						});
						seen.observe(host.document, { childList: true, subtree: true });
					});
					await page.goto(`${fixture.url}#rv-file-1:60`, { waitUntil: "load" });
					await page.reload({ waitUntil: "load" });
					await nextPlace(page);
					const place = await placeOf(page);
					expect(place.ref).toBe("f2.ts:60");
					expect(place.offset, "the restored composer did not push the line down").toBeGreaterThanOrEqual(-1);
					expect(place.offset).toBeLessThanOrEqual(1);
				},
				{ files: 3, lines: 40 },
			);
		},
		CASE_MS,
	);

	/** A narrower head is taller, and the line is measured from it: the jump still lands there. */
	test(
		"a hunk jump lands on the reading line at 390 too",
		async () => {
			await withPage(
				async (page) => {
					await page.setViewportSize({ width: 390, height: 844 });
					// The page re-measures the heads on resize; wait for its own re-measure before the jump.
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
					await page.keyboard.press("]");
					await nextPlace(page);
					const place = await placeOf(page);
					expect(place.ref).toBe("f2.ts:80");
					expect(place.offset).toBeGreaterThanOrEqual(-1);
					expect(place.offset).toBeLessThanOrEqual(1);
				},
				{ files: 3, lines: 40 },
			);
		},
		CASE_MS,
	);
});
