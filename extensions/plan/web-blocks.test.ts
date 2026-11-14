/**
 * How the review draws a block's content: a list is the kit's, one `<ul>` per run of items.
 *
 * The scan gives one block per list item — a comment points at a step, not at a list — so the
 * page owns the grouping, and this suite is the proof that a run of bullets is one list, that a
 * numbered item starts its own, and that a step is the kit's drawn task box rather than a glyph
 * a renderer picked. Split from the served review's suite when the grouping landed: that suite
 * is a height that may only fall, and a block's drawing is a subject of its own.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestBrowser } from "../../test/helpers/browser.ts";
import {
	launchReviewBrowser,
	mountReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
} from "../../test/helpers/plan-browser.ts";

let browser: TestBrowser;

describe.skipIf(REVIEW_CHROME === undefined)("the review's blocks", () => {
	beforeAll(async () => {
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	test("draws a step as the kit's task item, checked or not", async () => {
		// The list is the kit's: a plain bullet is an `li`, and a step is `li.task` with the box the
		// browse page draws for the same Markdown — so the two pages render a checklist alike, and
		// the box is the sheet's drawn control rather than a glyph the renderer picked.
		const local = await mountReview({
			...REVIEW_PAGE,
			blocks: [
				{ start: 0, end: 0, kind: "heading", lines: ["# Steps"] },
				{ start: 1, end: 1, kind: "list", lines: ["- a plain bullet"] },
				{ start: 2, end: 2, kind: "list", lines: ["- [x] a done step"] },
				{ start: 3, end: 3, kind: "list", lines: ["1. an ordered step"] },
			],
			annotations: [],
			outline: [{ id: "s-0", line: 0, level: 1, text: "Steps" }],
		});
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		try {
			await page.goto(local.url, { waitUntil: "load" });
			await page.waitForSelector("#plan li.task", { timeout: REVIEW_PAINT_MS });
			const items = await page.$$eval("#plan ul li, #plan ol li", (nodes) =>
				nodes.map((node) => {
					const box = node.querySelector("input.md-check") as unknown as {
						checked: boolean;
						disabled: boolean;
					} | null;
					return { cls: node.className, box: box === null ? null : { checked: box.checked, disabled: box.disabled } };
				}),
			);
			expect(items).toEqual([
				{ cls: "", box: null },
				{ cls: "task done", box: { checked: true, disabled: true } },
				{ cls: "", box: null },
			]);
			// One block per item is the scan's shape, not the page's drawing: a run of bullets is
			// one list, and a numbered item starts a second rather than joining the first.
			const lists = await page.$$eval("#plan ul, #plan ol", (nodes) =>
				nodes.map((node) => ({ tag: node.tagName, items: node.children.length })),
			);
			expect(lists).toEqual([
				{ tag: "UL", items: 2 },
				{ tag: "OL", items: 1 },
			]);
		} finally {
			await page.close();
			await local.close();
		}
	});
});
