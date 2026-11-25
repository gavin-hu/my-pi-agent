/**
 * The rail's current-section mark, at the widths it used to be dead at.
 *
 * The watcher was anchored to the window with a band named `-88px 0px -68% 0px`. At and below 860 the
 * sidebar becomes a band above the document, so the pane starts lower than the band's own bottom and no
 * heading could intersect: the mark never appeared on a phone or a narrow window. These cases scroll a
 * six-section plan the way a reader does and read the mark the page paints, so a window root cannot pass
 * them; each step waits on the mark rather than on the clock.
 *
 * The second half is the mark after a jump: End and a scrollbar dragged to the bottom both deliver one
 * scroll to the pane's end, which is the movement an observer never reports.
 *
 * Where the machine has no browser the suite skips, naming `PI_CHROME`, so `bun run check` stays green
 * there.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { Page } from "playwright-core";
import type { TestBrowser } from "../../test/helpers/browser.ts";
import {
	drawnReview,
	launchReviewBrowser,
	mountReview,
	openReview,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	REVIEW_PAGE,
	retryLine,
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

/** How long one case may take: a boot, a six-section walk, and the trip back to the top. */
const CASE_MS = 30_000;

/**
 * The budget the stall case gives the gate: enough for one attempt to poll, short enough that two
 * of them stay well inside a case. It is a named constant because a budget bounds a failure and
 * never makes a passing case faster.
 */
const STALL_MS = 1_000;

/**
 * The two budgets a retry can print, told apart from the line alone and without a browser.
 *
 * The gate's form is the one a flake leaves behind, and no case here can produce a real cold-paint
 * miss to read it from — that is the unproducible bit #805 chased — so the assertion is on the line
 * its builder makes. What matters is the pair rather than either sentence: a reader of the log has
 * to tell the gate's miss from a case's forced retry without opening this file.
 */
test("names whose budget the retry ran under, and reads apart from a case's", () => {
	const missed = retryLine(2, REVIEW_PAINT_MS, [
		'attempt 1 waited 10004ms and saw readyState "complete", 0 "#plan .bf-block[id]", outline-list present',
	]);
	const forced = retryLine(2, STALL_MS, [
		'attempt 1 waited 1019ms and saw readyState "complete", 0 "#plan .bf-block[id]", outline-list absent',
	]);
	expect(missed).toContain("drew on attempt 2");
	expect(missed).toContain(`under the gate's ${REVIEW_PAINT_MS}ms budget`);
	expect(forced).toContain(`under a ${STALL_MS}ms budget this case passed`);
	expect(missed).not.toBe(forced);
});

/**
 * How far one step scrolls, in px.
 *
 * The walk records the mark after each step, so a step must not carry the reader from one side of a
 * heading to the other between two reads: the sections are 518 to 758 px apart, and 80 px keeps a
 * reader-sized scroll well inside one, so every section is seen rather than stepped over.
 */
const STEP_PX = 80;

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
 * Scroll the pane one step down, then let the rail answer. Returns the mark the pane shows
 * afterwards, and whether it reached its end.
 *
 * Two paints, because the mark is one frame's work away from the scroll that moved it: the reading
 * of the pane's position is scheduled by the scroll event, so it lands in that frame or the next
 * one, and the walk must hold whichever it is. It is a frame count rather than a clock, so a loaded
 * machine changes how long a frame takes and never what the walk sees. The old twelve were a guess
 * at quietness on steps that can only answer "no": a section is several steps long, so most steps
 * cannot move the mark at all.
 */
async function stepDown(page: Page): Promise<{ mark: string; atEnd: boolean }> {
	return page.evaluate(
		async ({ step }) => {
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
			const nextFrame = (globalThis as unknown as { requestAnimationFrame(callback: () => void): number })
				.requestAnimationFrame;
			const paint = () => new Promise<void>((resolve) => nextFrame(() => resolve(undefined)));

			pane.scrollBy(0, step);
			await paint();
			await paint();
			return { mark: current(), atEnd: atEnd() };
		},
		{ step: STEP_PX },
	);
}

/**
 * Jump the pane to its end in one step, then read the mark. Returns what the rail marks.
 *
 * End and a scrollbar dragged to the bottom are the same movement: one `scrollTop` write that lands
 * the reader somewhere the pane never passed through, which is why the mark has to be read off the
 * position rather than off what crossed a band. The wait is the assertion's condition; the read
 * after it names what a page that never answered left behind.
 */
async function jumpToEnd(page: Page): Promise<string> {
	await page.$eval("#plan", (node) => {
		const pane = node as unknown as Paneish;
		pane.scrollTop = pane.scrollHeight;
	});
	try {
		await marks(page, SECTIONS[SECTIONS.length - 1] ?? "");
	} catch {
		// Read it anyway: the failure should name the section the rail kept, not only the timeout.
	}
	return marked(page);
}

/** Mark each new section as the reader scrolls to the end of the document. */
async function walkDown(page: Page): Promise<string[]> {
	const seen: string[] = [];
	const note = (id: string) => {
		if (id !== "" && seen[seen.length - 1] !== id) seen.push(id);
	};
	note(await marked(page));
	for (let step = 0; step < 400; step++) {
		const { mark, atEnd } = await stepDown(page);
		note(mark);
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

	/** Jump to the end of the plan at one size, and read the one section the rail marks there. */
	async function jumped(width: number, height: number): Promise<string> {
		const local = await mountReview(longPlan());
		const page = await openReview(browser, local.url);
		try {
			await page.setViewportSize({ width, height });
			await drawnReview(page);
			return await jumpToEnd(page);
		} finally {
			await page.close();
			await local.close();
		}
	}

	/** Walk the plan at one size, then read the mark after the reader returns to the top. */
	async function walked(width: number, height: number): Promise<string[]> {
		const local = await mountReview(longPlan());
		const page = await openReview(browser, local.url);
		try {
			await page.setViewportSize({ width, height });
			await drawnReview(page);
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
		test(
			`marks every section as the reader scrolls at ${width}x${height}`,
			async () => {
				expect(await walked(width, height)).toEqual(SECTIONS);
			},
			CASE_MS,
		);
	}

	for (const [width, height] of [
		[390, 844],
		[900, 844],
		[1280, 400],
	] as const) {
		test(
			`marks the last section when a jump reaches the end at ${width}x${height}`,
			async () => {
				expect(await jumped(width, height)).toBe(SECTIONS[SECTIONS.length - 1] ?? "");
			},
			CASE_MS,
		);
	}

	/**
	 * The half of the gate the flake never got: a page that does not draw names the state it kept.
	 *
	 * `about:blank` loads completely and holds no block, so it is the honest version of the red that
	 * started this card — one attempt that polls the state, one retry, and a message saying the
	 * document was complete and the rail empty, rather than "a selector was late".
	 */
	test(
		"names the state a page that never drew left behind",
		async () => {
			const page = await browser.newPage();
			try {
				await page.goto("about:blank", { waitUntil: "load" });
				const message = await drawnReview(page, STALL_MS).then(
					() => "",
					(error: unknown) => String(error),
				);
				expect(message).toContain("never drew");
				expect(message).toContain('readyState "complete"');
				expect(message).toContain('0 "#plan .bf-block[id]"');
			} finally {
				await page.close();
			}
		},
		CASE_MS,
	);

	/**
	 * The retry, and the line that makes it visible: a first paint that misses its state and a
	 * reload that draws prints what the first attempt saw under the budget this case passed, so a
	 * degrading paint shows up as lines before it shows up as a failure — and a reader can tell that
	 * line from the gate's, which is the half #805's own watch could not do.
	 */
	test(
		"reports the retry when the first paint misses its state",
		async () => {
			let served = 0;
			const local = await mountReview(() => {
				served += 1;
				return served === 1 ? { ...REVIEW_PAGE, blocks: [], outline: [] } : REVIEW_PAGE;
			});
			const page = await browser.newPage();
			const warn = spyOn(console, "warn");
			try {
				await page.goto(local.url, { waitUntil: "load" });
				await drawnReview(page, STALL_MS);
				expect(warn).toHaveBeenCalled();
				const line = String(warn.mock.calls[0]?.[0]);
				expect(line).toContain("drew on attempt 2");
				expect(line).toContain(`under a ${STALL_MS}ms budget this case passed`);
			} finally {
				warn.mockRestore();
				await page.close();
				await local.close();
			}
		},
		CASE_MS,
	);
});
