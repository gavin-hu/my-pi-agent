/**
 * How the review draws a block's content: a list is the kit's, one item per block.
 *
 * The scan gives one block per list item — a comment points at a step, not at a list — so the
 * item and the rail that names it have to share a block, and the page shuts the kit's gap
 * between two lists so a run still reads as one list. This suite is the proof of that shape, of
 * the drawn task box, and of the number a split list keeps. Split from the served review's suite
 * when the drawing became a subject of its own: that suite is a height that may only fall.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ReviewPageData } from "../../extensions/plan/web-page.ts";
import type { TestBrowser } from "../../test/helpers/browser.ts";
import {
	launchReviewBrowser,
	mountReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
} from "../../test/helpers/plan-browser.ts";

let browser: TestBrowser;

/**
 * The sliver of the page a case measures.
 *
 * This project's TypeScript has no DOM lib — the client is a string, never compiled against one —
 * and a predicate handed to Playwright runs in the page, so it reaches the document by name.
 */
interface DomBlock {
	getAttribute(name: string): string | null;
	querySelector(selector: string): DomBlock | null;
	querySelectorAll(selector: string): { length: number };
	getBoundingClientRect(): { top: number; bottom: number };
	textContent: string | null;
}

/** What the page's runtime answers, reached through the one global a predicate has. */
interface PageRuntime {
	document: { querySelectorAll(selector: string): Iterable<DomBlock> };
	getComputedStyle(node: DomBlock): { marginBottom: string };
}

describe.skipIf(REVIEW_CHROME === undefined)("the review's blocks", () => {
	beforeAll(async () => {
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	/** A heading, one run of four items, and the paragraph that ends it. */
	const RUN = {
		...REVIEW_PAGE,
		blocks: [
			{ start: 0, end: 0, kind: "heading", lines: ["# Steps"], level: 1, text: "Steps" },
			{
				start: 1,
				end: 1,
				kind: "list",
				lines: ["- a plain bullet"],
				item: { ordered: false, indent: 0, marker: "-", content: "a plain bullet", task: null },
			},
			{
				start: 2,
				end: 2,
				kind: "list",
				lines: ["- [x] a done step"],
				item: { ordered: false, indent: 0, marker: "-", content: "a done step", task: "done" },
			},
			{
				start: 3,
				end: 3,
				kind: "list",
				lines: ["1) an ordered step"],
				item: { ordered: true, indent: 0, marker: "1)", content: "an ordered step", task: null },
			},
			{
				start: 4,
				end: 4,
				kind: "list",
				lines: ["2. a second numbered step"],
				item: { ordered: true, indent: 0, marker: "2.", content: "a second numbered step", task: null },
			},
			{ start: 5, end: 5, kind: "paragraph", lines: ["After the list."] },
		],
		annotations: [],
		outline: [{ id: "s-0", line: 0, level: 1, text: "Steps" }],
	} satisfies ReviewPageData;

	test("draws a step as the kit's task item, checked or not", async () => {
		// The list is the kit's: a plain bullet is an `li`, and a step is `li.task` with the box the
		// browse page draws for the same Markdown — so the two pages render a checklist alike, and
		// the box is the sheet's drawn control rather than a glyph the renderer picked.
		const local = await mountReview(RUN);
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
				{ cls: "", box: null },
			]);
			// One item per block, because the block is what a comment anchors to: each item's list is
			// its own, and the page keeps a run reading as one list by its spacing, not its grouping.
			const lists = await page.$$eval("#plan ul, #plan ol", (nodes) =>
				nodes.map((node) => ({ tag: node.tagName, items: node.children.length })),
			);
			expect(lists).toEqual([
				{ tag: "UL", items: 1 },
				{ tag: "UL", items: 1 },
				{ tag: "OL", items: 1 },
				{ tag: "OL", items: 1 },
			]);
			// A split list restarts at 1, so the number rides on the item — `1)` as well as `1.`, which
			// is the marker form a converted `Number` reads as NaN.
			const numbers = await page.$$eval("#plan ol li", (nodes) =>
				nodes.map((node) => (node as unknown as { value: number }).value),
			);
			expect(numbers).toEqual([1, 2]);
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("leaves no empty block inside a run, and the gap at its end", async () => {
		// A run drawn block by block has one failure mode worth measuring: an item block that draws
		// no item, which is what showed as a band of blank rows under a list and left the block's
		// rail — the comment control, the badge, the change mark — beside nothing.
		const local = await mountReview(RUN);
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		try {
			await page.goto(local.url, { waitUntil: "load" });
			await page.waitForSelector("#plan li", { timeout: REVIEW_PAINT_MS });
			const run = await page.evaluate(() => {
				// The page's own globals, named rather than assumed: there is no DOM lib here.
				const view = globalThis as unknown as PageRuntime;
				const shapes = Array.from(view.document.querySelectorAll("#plan .bf-block")).map((node) => {
					const box = node.getBoundingClientRect();
					const list = node.querySelector(":scope > ul, :scope > ol");
					return {
						kind: node.getAttribute("data-kind"),
						runEnd: node.getAttribute("data-run-end") === "1",
						items: node.querySelectorAll(":scope > ul > li, :scope > ol > li").length,
						text: (node.textContent ?? "").trim(),
						top: box.top,
						bottom: box.bottom,
						listMargin: list === null ? null : view.getComputedStyle(list).marginBottom,
					};
				});
				return shapes;
			});
			const items = run.filter((shape) => shape.kind === "list");
			expect(items.map((shape) => shape.items)).toEqual([1, 1, 1, 1]);
			expect(items.every((shape) => shape.text.length > 0)).toBe(true);
			// Flush: one block's bottom is the next one's top, so no blank row sits between two steps.
			const gaps = items.slice(1).map((shape, index) => Math.round(shape.top - (items[index]?.bottom ?? 0)));
			expect(gaps).toEqual([0, 0, 0]);
			// The gap the kit puts between two lists is kept at the end of the run, and only there.
			expect(items.map((shape) => shape.runEnd)).toEqual([false, false, false, true]);
			expect(items.map((shape) => shape.listMargin)).toEqual(["0px", "0px", "0px", "15px"]);
			// The paragraph after the run is spaced off the list by the margin the run's last item keeps,
			// which sits inside that block: the blocks themselves are flush.
			const after = run[run.length - 1];
			expect(Math.round((after?.top ?? 0) - (items[3]?.bottom ?? 0))).toBe(0);
		} finally {
			await page.close();
			await local.close();
		}
	});
});
