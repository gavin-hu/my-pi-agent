/**
 * What the review's view switch says about the plan it is showing.
 *
 * The switch is a filter over the document, and a filtered plan that reads as a short one is
 * the defect these cases exist for: the count of what was hidden sits under the control that
 * hid it, and a view that matched nothing says so in words instead of showing the whole plan
 * under a pressed button. It is its own suite because `web-behaviour.test.ts` and
 * `web-page.test.ts` are named at their height in `LONG_SUITES`, and a sentence that outlived
 * its view — the count once went to the header's status line and nothing cleared it — needs a
 * case that reads the note after the reader has left the view.
 *
 * Where the machine has no browser the last suite skips, naming `PI_CHROME`, so `bun run check`
 * stays green there and still says why nothing ran; the sentences themselves are read without
 * a document, because a missing row is a case the page cannot reach by driving it.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import type { TestBrowser } from "../../test/helpers/browser.ts";
import {
	launchReviewBrowser,
	mountReview,
	openReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
} from "../../test/helpers/plan-browser.ts";
import { reviewNote, VIEW_NOTES } from "./web-note.ts";

describe("the switch's sentences", () => {
	test("one per view and per nothing, none sharing another's words", () => {
		// The type is the completeness guard; this is the half a type cannot see, two rows that
		// answer with the same sentence under different labels.
		const sentences = Object.values(VIEW_NOTES).flatMap((byReason) => Object.values(byReason));
		expect(sentences).toHaveLength(4);
		expect(new Set(sentences).size).toBe(4);
	});

	test("counts what a view hid, and says nothing for the whole plan", () => {
		expect(reviewNote("all", { shown: 4, hidden: 0 })).toBe("");
		expect(reviewNote("changed", { shown: 3, hidden: 1 })).toBe("Showing 3 of 4 blocks — 1 hidden");
		expect(reviewNote("comments", { shown: 4, hidden: 0, empty: "headings" })).toBe(VIEW_NOTES.comments.headings);
	});
});

let browser: TestBrowser;

/**
 * The sentence under the switch, and the header line it must not be in.
 *
 * The line carries two sentences when the switch cannot offer a view — the view's own and the
 * reason the control is off — so these cases read the view's span: what the reader pressed is
 * what they are about, and `#review-view-why` has its own cases below.
 */
const note = (page: Page): Promise<string | null> => page.textContent("#review-note-view");
const status = (page: Page): Promise<string | null> => page.textContent("#status");

/** The view the switch says it is showing. */
const pressed = (page: Page): Promise<string | null> =>
	page.$eval('[data-view][aria-pressed="true"]', (node) => node.getAttribute("data-view"));

/** The blocks the page draws: blank lines never become one, so five fixture blocks are four. */
const shownBlocks = (page: Page): Promise<number> =>
	page.$$eval("#plan .bf-block:not([hidden])", (nodes) => nodes.length);

/** One mount and its tab, closed whatever the case did to them. */
async function withReview(overrides: Partial<typeof REVIEW_PAGE>, run: (page: Page) => Promise<void>): Promise<void> {
	const review = await mountReview({ ...REVIEW_PAGE, ...overrides });
	const page = await openReview(browser, review.url);
	try {
		await run(page);
	} finally {
		await review.close();
	}
}

describe.skipIf(REVIEW_CHROME === undefined)("the review's view switch", () => {
	beforeAll(async () => {
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	test("counts what Changed hid, under the switch, and leaves the header line empty", async () => {
		await withReview({ changed: [1], blockMarks: true }, async (page) => {
			await page.click('[data-view="changed"]');
			// Two headings, the one changed paragraph, and one paragraph behind it.
			expect(await note(page)).toBe("Showing 3 of 4 blocks — 1 hidden");
			expect(await shownBlocks(page)).toBe(3);
			// The count used to go to the header's line, which is where it outlived its view.
			expect(await status(page)).toBe("");
		});
	});

	test("clears the note when the reader goes back to the whole plan", async () => {
		await withReview({ changed: [1], blockMarks: true }, async (page) => {
			await page.click('[data-view="changed"]');
			expect(await note(page)).toBe("Showing 3 of 4 blocks — 1 hidden");
			await page.click('[data-view="all"]');
			expect(await pressed(page)).toBe("all");
			expect(await shownBlocks(page)).toBe(4);
			// The regression: the sentence stayed behind and claimed 62 of 79 over a whole plan.
			expect(await note(page)).toBe("");
			expect(await status(page)).toBe("");
		});
	});

	test("says so when nothing changed since the last review", async () => {
		// A baseline with no block marks is the state a plan reaches after a review with no
		// edits: the tab is offered, and the filter matches nothing.
		await withReview({ changed: [], blockMarks: true }, async (page) => {
			await page.click('[data-view="changed"]');
			expect(await pressed(page)).toBe("changed");
			expect(await note(page)).toBe("Nothing changed since the last review");
			// The document stays whole rather than blanking, so the words are the only signal.
			expect(await shownBlocks(page)).toBe(4);
		});
	});

	test("says so when the plan has no comments", async () => {
		await withReview({ annotations: [] }, async (page) => {
			await page.click('[data-view="comments"]');
			expect(await note(page)).toBe("No comments on this plan yet");
			expect(await shownBlocks(page)).toBe(4);
		});
	});

	test("says only headings changed, over a document kept whole", async () => {
		// A heading is kept by every view, so the mark on one is not prose the filter matched: the
		// page must not claim nothing changed over a heading that visibly did, nor blank itself to
		// two headings and no text.
		await withReview({ changed: [0], blockMarks: true }, async (page) => {
			await page.click('[data-view="changed"]');
			expect(await note(page)).toBe("Only headings changed since the last review");
			expect(await shownBlocks(page)).toBe(4);
		});
	});

	test("says the only comments are on headings, over a document kept whole", async () => {
		// The same state from the other filter: a note sitting under the heading it was written on.
		await withReview({ annotations: [{ anchor: 3, comment: "on the rollout heading" }] }, async (page) => {
			await page.click('[data-view="comments"]');
			expect(await note(page)).toBe("The only comments are on headings");
			expect(await shownBlocks(page)).toBe(4);
		});
	});

	test("fills the segment the reader pressed, and leaves the others plain", async () => {
		await withReview({ changed: [1], blockMarks: true }, async (page) => {
			await page.click('[data-view="changed"]');
			// The page's TypeScript has no DOM lib, so the predicate serialized into the browser
			// reaches `getComputedStyle` through its own `globalThis`.
			const read = (node: unknown): string =>
				(globalThis as unknown as { getComputedStyle(n: unknown): { backgroundColor: string } }).getComputedStyle(node)
					.backgroundColor;
			const [painted, plain] = await page.$$eval("[data-view]", (nodes) =>
				nodes
					.filter(
						(node) =>
							(node as unknown as { getAttribute(name: string): string | null }).getAttribute("data-view") !== "all",
					)
					.map(
						(node) =>
							(globalThis as unknown as { getComputedStyle(n: unknown): { backgroundColor: string } }).getComputedStyle(
								node,
							).backgroundColor,
					),
			);
			// `read` names the same member the shipped page reads, so a typo here fails loudly.
			expect(read).toBeDefined();
			expect(painted).not.toBe(plain);
			expect(painted).not.toBe("rgba(0, 0, 0, 0)");
		});
	});

	test("draws how many blocks a section lost, beside the changed dot", async () => {
		// The count sat in a tooltip: a touch reader, a printed page, and a screenshot never saw it.
		await withReview(
			{
				outline: [
					{ id: "s-0", line: 0, level: 1, text: "Add rate limiting" },
					{ id: "s-3", line: 3, level: 2, text: "Rollout", removed: 2 },
				],
			},
			async (page) => {
				const chip = await page.$eval("#outline-list li:nth-child(2) .review-nav__removed", (node) => ({
					text: node.textContent,
					label: node.getAttribute("aria-label"),
					hidden: (node as unknown as { hidden: boolean }).hidden,
				}));
				expect(chip).toEqual({
					text: "−2",
					label: "2 blocks removed since your last review",
					hidden: false,
				});
			},
		);
	});

	test("the switch draws nothing the plan cannot show, and says why in the note line", async () => {
		// No baseline: Changed is off. A disabled control leaves the tab order, so the reason is the
		// note line's second sentence, and the switch's group describes itself with that element; a
		// title on the button reached neither a keyboard reader nor a touch one.
		await withReview({}, async (page) => {
			const changed = await page.$eval('[data-view="changed"]', (node) => ({
				disabled: (node as unknown as { disabled: boolean }).disabled,
				title: node.getAttribute("title"),
			}));
			expect(changed).toEqual({ disabled: true, title: null });
			expect(await page.textContent("#review-note")).toContain("No earlier review of this plan to compare against");
			// The description names the element that holds the sentence, rather than a copy of it.
			expect(await page.$eval("#review-view", (node) => node.getAttribute("aria-describedby"))).toBe("review-view-why");
			expect(await page.textContent("#review-view-why")).toBe("No earlier review of this plan to compare against");
			// The key cycles the two views that are offered, never the disabled one.
			await page.keyboard.press("v");
			expect(await pressed(page)).toBe("comments");
			await page.keyboard.press("v");
			expect(await pressed(page)).toBe("all");
			// The sentence answers the switch, not the pressed view: it stays while Changed is off.
			expect(await page.textContent("#review-note")).toContain("No earlier review");
		});
	});

	test("offers the Changed view with no description when the plan has a baseline", async () => {
		// The reverse of the case above, and the one a standing describedby would have broken: it
		// would point at a hidden span, describing the group with an element outside the tree.
		await withReview({ changed: [1], blockMarks: true }, async (page) => {
			const changed = await page.$eval('[data-view="changed"]', (node) => ({
				disabled: (node as unknown as { disabled: boolean }).disabled,
				title: node.getAttribute("title"),
			}));
			expect(changed).toEqual({ disabled: false, title: null });
			expect(await page.$eval("#review-view", (node) => node.getAttribute("aria-describedby"))).toBe(null);
			const why = await page.$eval("#review-view-why", (node) => ({
				hidden: (node as unknown as { hidden: boolean }).hidden,
				text: node.textContent,
			}));
			expect(why).toEqual({ hidden: true, text: "" });
			expect(await page.textContent("#review-note")).not.toContain("No earlier review");
		});
	});
});
