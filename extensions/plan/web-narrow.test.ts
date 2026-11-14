/**
 * A fence at a phone's width: the line wraps, so the text is read rather than scrolled
 * for. At a desk the same fence keeps the line whole, which is what a command or a log wants.
 *
 * The measurement is the fence's own: content wider than the box is content the reader has
 * to scroll, and that is the defect — an overlay scrollbar draws nothing until it is used.
 * Both routes a fence takes are covered: an unlabelled one falls back to the `code` text
 * node, and a highlighted one renders one `bf-code__line` span per line.
 *
 * The fixture line is what makes the 1280 case honest, so it is sized off the panel and not
 * off this machine's font: the panel is 928 px, and a line of N characters at 13 px outgrows
 * it when N x 13 x the font's advance is past 928. A machine's mono runs from 0.45 em to
 * 0.60 em — SF Mono is the wide end and Consolas, the one Windows resolves, is 0.55 — so a
 * 122-character line cleared the box by 7% here and fitted it on Windows, where the wait
 * could never come true. This line is 202 characters: 32% wider than the box even at 0.45 em.
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

/** A command's target: 202 characters, with no spaces, which outgrows a 1280 panel at any advance. */
const LONG =
	"/Users/someone/.pi/agent/plans/8872d3adda0e/2026-11-11-1453-instant-board-frames/snapshots/2026-11-12T201200Z/workspaces/my-pi-agent/.pi/worktrees/instant-board-frames/extensions/plan/web-narrow.test.ts";

/** The panel's box and its content, as the page measures them. */
interface Panel {
	scrollWidth: number;
	clientWidth: number;
	textContent: string | null;
}

/** One code panel, by the order the page draws them. */
async function panel(page: Page, at: number): Promise<Panel> {
	return page.$$eval(
		"#plan .bf-block pre",
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
	try {
		await page.waitForFunction(
			({ index, want }) => {
				const nodes = (
					globalThis as unknown as { document: { querySelectorAll(selector: string): ArrayLike<Panel> } }
				).document.querySelectorAll("#plan .bf-block pre");
				const node = Array.from(nodes)[index];
				if (node === undefined) return false;
				return want === "fits" ? node.scrollWidth <= node.clientWidth : node.scrollWidth > node.clientWidth;
			},
			{ index: at, want: relation },
			{ timeout: REVIEW_PAINT_MS },
		);
	} catch (cause) {
		// A wait that never lands is usually a fixture this machine's font cannot satisfy, so the
		// box that was measured is worth more than the timeout on its own.
		const drawn = await panel(page, at).catch(() => undefined);
		const width = page.viewportSize()?.width ?? 0;
		const box =
			drawn === undefined
				? `the page drew no code panel at ${at}`
				: `${drawn.scrollWidth}px of content in a ${drawn.clientWidth}px box`;
		throw new Error(`the panel at ${at} never ${relation} at ${width}: ${box}`, { cause });
	}
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

describe.skipIf(REVIEW_CHROME === undefined)("a fenced line at a narrow width", () => {
	beforeAll(async () => {
		mount = await mountReview({
			...REVIEW_PAGE,
			blocks: [
				{ start: 0, end: 0, kind: "heading", lines: ["# A plan"], level: 1, text: "A plan" },
				{ start: 1, end: 1, kind: "paragraph", lines: ["Run this:"] },
				// No language on the fence, so the page draws the line as a text node.
				{
					start: 2,
					end: 2,
					kind: "code",
					lines: ["```", "$ pi doctor " + LONG, "```"],
					fence: { char: "`", length: 3, info: "" },
					body: ["$ pi doctor " + LONG],
				},
				// A named fence, which the session highlights: the same line, one span tall.
				{
					start: 5,
					end: 5,
					kind: "code",
					lines: ["```text", "GET " + LONG, "```"],
					fence: { char: "`", length: 3, info: "text" },
					body: ["GET " + LONG],
				},
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
});
