/**
 * A code panel at a phone's width: the line wraps, so the text is read rather than scrolled
 * for. At a desk the same panel keeps the line whole, which is what a diff or a log wants.
 *
 * The measurement is the panel's own: content wider than the box is content the reader has
 * to scroll, and that is the defect — an overlay scrollbar draws nothing until it is used.
 * Both routes a fence takes are covered: an unlabelled one falls back to the `code` text
 * node, and a highlighted one renders one `bf-code__line` span per line.
 *
 * The fixture line is deliberately longer than the reported one: the `$ pi doctor` block is
 * 892 px of content against a 928 px panel at 1280, so it fits there. This line is about
 * 1,300 px, which is what makes the 1280 case honest.
 *
 * It needs a browser. Where the machine has none the suite skips, naming `PI_CHROME`, so
 * `bun run check` stays green on a runner without Chrome and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import {
	launchReviewBrowser,
	mountReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
	type ReviewMount,
} from "../../test/helpers/plan-browser.ts";
import type { TestBrowser } from "../../test/helpers/browser.ts";

/** A command's target, longer than the panel at 1280: ~135 characters, with no spaces. */
const LONG =
	"/Users/someone/.pi/agent/plans/8872d3adda0e/2026-11-11-1453-instant-board-frames/snapshots/2026-11-12T201200Z/manifest.md";

/** The panel's box and its content, as the page measures them. */
interface Panel {
	scrollWidth: number;
	clientWidth: number;
	textContent: string | null;
}

/** One code panel, by the order the page draws them. */
async function panel(page: Page, at: number): Promise<Panel> {
	return page.$$eval(
		"pre.bf-code",
		(nodes, index) => {
			const node = nodes[index] as unknown as Panel | undefined;
			if (node === undefined) throw new Error(`the page drew no code panel at ${index}`);
			return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, textContent: node.textContent };
		},
		at,
	);
}

/**
 * The panel a wait reads, found inline: a predicate handed to Playwright is serialized into
 * the page and closes over nothing, so the lookup is repeated rather than shared.
 */
async function measured(page: Page, at: number, relation: "fits" | "outgrows"): Promise<void> {
	await page.waitForFunction(
		({ index, want }) => {
			const nodes = (
				globalThis as unknown as { document: { querySelectorAll(selector: string): ArrayLike<Panel> } }
			).document.querySelectorAll("pre.bf-code");
			const node = Array.from(nodes)[index];
			if (node === undefined) return false;
			return want === "fits" ? node.scrollWidth <= node.clientWidth : node.scrollWidth > node.clientWidth;
		},
		{ index: at, want: relation },
		{ timeout: REVIEW_PAINT_MS },
	);
}

/** Wait until the panel's content fits its box: what wrapping looks like. */
async function fits(page: Page, at: number): Promise<void> {
	await measured(page, at, "fits");
}

/** Wait until the panel's content outgrows its box: what an unwrapped line looks like. */
async function outgrows(page: Page, at: number): Promise<void> {
	await measured(page, at, "outgrows");
}

let mount: ReviewMount;
let browser: TestBrowser;

describe.skipIf(REVIEW_CHROME === undefined)("a code panel at a narrow width", () => {
	beforeAll(async () => {
		mount = await mountReview({
			...REVIEW_PAGE,
			blocks: [
				{ start: 0, end: 0, kind: "heading", lines: ["# A plan"] },
				{ start: 1, end: 1, kind: "paragraph", lines: ["Run this:"] },
				// No language on the fence, so the page draws the line as a text node.
				{ start: 2, end: 2, kind: "code", lines: ["```", "$ pi doctor " + LONG, "```"] },
				// A named fence, which the session highlights: the same line, one span tall.
				{ start: 5, end: 5, kind: "code", lines: ["```text", "GET " + LONG, "```"] },
			],
			code: { "5": [`<span class="tok-key">GET</span> ${LONG}`] },
		});
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
		await mount?.close();
	}, 30_000);

	/** A tab on the served review, at one width, with its blocks painted. */
	async function open(width: number): Promise<Page> {
		const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
		await page.goto(mount.url, { waitUntil: "load" });
		await page.waitForSelector("#plan .bf-block", { timeout: REVIEW_PAINT_MS });
		return page;
	}

	test("wraps the line at 420, in a plain fence and a highlighted one", async () => {
		const page = await open(420);
		for (const at of [0, 1]) {
			await fits(page, at);
			const drawn = await panel(page, at);
			// The whole path is in the panel, so wrapping did not clip what it could not fit.
			expect(drawn.textContent).toContain(LONG);
		}
		await page.close();
	});

	test("keeps the line whole at 1280, where there is room to scroll", async () => {
		const page = await open(1280);
		for (const at of [0, 1]) {
			await outgrows(page, at);
			expect((await panel(page, at)).textContent).toContain(LONG);
		}
		await page.close();
	});

	test("lets a page with its own control say no at 420, in either route", async () => {
		const page = await open(420);
		for (const at of [0, 1]) await fits(page, at);
		// What `file-browse`'s wrap button writes when the reader asks for the line whole: the
		// escape hatch is more specific than the narrow rule, so it wins on a phone too. Both
		// routes are closed, because the rule names a span and a text node separately.
		await page.$$eval("pre.bf-code", (nodes) => {
			for (const node of Array.from(nodes))
				(node as unknown as { classList: { add(name: string): void } }).classList.add("bf-code--nowrap");
		});
		for (const at of [0, 1]) await outgrows(page, at);
		await page.close();
	});
});
