/**
 * The rail's current-section mark, at the widths it used to be dead at.
 *
 * The watcher was anchored to the window with a band named `-88px 0px -68% 0px`. At and below 860 the
 * sidebar becomes a band above the document, so the pane starts lower than the band's own bottom and no
 * heading could intersect: the mark never appeared on a phone or a narrow window. These cases scroll a
 * six-section plan the way a reader does and read the mark the page paints, so a window root cannot pass
 * them; each step waits on the mark rather than on the clock.
 *
 * Where the machine has no browser the suite skips, naming `PI_CHROME`, so `bun run check` stays green
 * there.
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
	REVIEW_PAINT_MS,
} from "../../test/helpers/plan-browser.ts";
import type { ReviewPageData } from "./web-payload.ts";

/** The pane and its box, as a page expression reaches them; the page is a string, so members are named. */
interface Paneish {
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
	scrollBy(x: number, y: number): void;
	scrollTo(x: number, y: number): void;
}

/** Six sections of ten paragraphs: long enough to scroll at every width under test. */
function longPlan(): ReviewPageData {
	const blocks: ReviewPageData["blocks"] = [];
	const outline: ReviewPageData["outline"] = [];
	let line = 0;
	for (let section = 1; section <= 6; section++) {
		blocks.push({ start: line, end: line, kind: "heading", lines: [`## Section ${section}`] });
		outline.push({ id: `s-${line}`, line, level: 2, text: `Section ${section}` });
		line += 1;
		for (let paragraph = 1; paragraph <= 10; paragraph++) {
			blocks.push({
				start: line,
				end: line,
				kind: "paragraph",
				lines: [`Paragraph ${paragraph} of section ${section}: enough text to fill a line of the page.`],
			});
			line += 1;
		}
	}
	return { ...REVIEW_PAGE, blocks, outline, annotations: [] };
}

/** Every section the rail marks as the pane walks to its end, in the order it marked them. */
const SECTIONS = ["s-0", "s-11", "s-22", "s-33", "s-44", "s-55"];

/** The section the rail marks right now, by link id; "" when it marks nothing. */
async function marked(page: Page): Promise<string> {
	return page.$eval("#outline-list", (list) => {
		const link = list.querySelector('a[aria-current="true"]');
		return link?.getAttribute("data-id") ?? "";
	});
}

/** Wait until the rail marks `id`, which is the condition every assertion here reads. */
async function marks(page: Page, id: string): Promise<void> {
	await page.waitForFunction(
		(wanted) => {
			const doc = (
				globalThis as unknown as {
					document: { querySelector(selector: string): unknown };
				}
			).document;
			const link = doc.querySelector('#outline-list a[aria-current="true"]') as {
				getAttribute(name: string): string | null;
			} | null;
			return (link?.getAttribute("data-id") ?? "") === wanted;
		},
		id,
		{ timeout: REVIEW_PAINT_MS },
	);
}

/**
 * Scroll the pane one step down, then wait for the rail to answer: the mark moved off `previous`, or
 * the pane reached its end. Returns whether the end was reached.
 */
async function stepDown(page: Page, previous: string): Promise<boolean> {
	return page.evaluate(
		async ({ from }) => {
			const doc = (
				globalThis as unknown as {
					document: { querySelector(selector: string): unknown };
				}
			).document;
			const pane = doc.querySelector("#plan") as Paneish;
			const atEnd = () => pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
			const current = () => {
				const link = doc.querySelector('#outline-list a[aria-current="true"]') as {
					getAttribute(name: string): string | null;
				} | null;
				return link?.getAttribute("data-id") ?? "";
			};
			pane.scrollBy(0, 80);
			// A scroll lands before the frame paints, and the observer answers on it: a dozen frames is
			// far more than that, and waiting the full budget on a step that changes nothing is what
			// made this suite slow.
			const nextFrame = (globalThis as unknown as { requestAnimationFrame(callback: () => void): number })
				.requestAnimationFrame;
			for (let frame = 0; frame < 12; frame++) {
				await new Promise((resolve) => nextFrame(() => resolve(undefined)));
				if (current() !== from || atEnd()) break;
			}
			return atEnd();
		},
		{ from: previous },
	);
}

/** Mark each new section as the reader scrolls to the end of the document. */
async function walkDown(page: Page): Promise<string[]> {
	const seen: string[] = [];
	const note = async () => {
		const id = await marked(page);
		if (id !== "" && seen[seen.length - 1] !== id) seen.push(id);
	};
	await note();
	for (let step = 0; step < 400; step++) {
		const atEnd = await stepDown(page, seen[seen.length - 1] ?? "");
		await note();
		// The assertion is the six sections in order, so the walk stops as soon as it has them: the
		// last of them is marked before the pane reaches its end.
		if (atEnd || seen.length === SECTIONS.length) break;
	}
	return seen;
}

let browser: TestBrowser;

describe.skipIf(REVIEW_CHROME === undefined)("the rail's current-section mark", () => {
	beforeAll(async () => {
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	/** Walk the plan at one size, then read the mark after the reader returns to the top. */
	async function walked(width: number, height: number): Promise<string[]> {
		const local = await mountReview(longPlan());
		const page = await openReview(browser, local.url);
		try {
			await page.setViewportSize({ width, height });
			await page.waitForSelector("#plan .bf-block[id]", { timeout: REVIEW_PAINT_MS });
			const seen = await walkDown(page);
			await page.$eval("#plan", (node) => (node as unknown as Paneish).scrollTo(0, 0));
			await marks(page, SECTIONS[0] ?? "");
			return seen;
		} finally {
			await page.close();
			await local.close();
		}
	}

	for (const [width, height] of [
		[390, 844],
		[900, 844],
		// A short pane is the other half of the old band's range, and a reader scrolls it the same way.
		[1280, 400],
	] as const) {
		test(`marks every section as the reader scrolls at ${width}x${height}`, async () => {
			expect(await walked(width, height)).toEqual(SECTIONS);
		});
	}
});
