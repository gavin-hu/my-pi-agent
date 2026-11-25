/**
 * The review's narrow band, as a phone and a narrow window meet it.
 *
 * The defects this card fixes are geometry, which no class name shows: the rail's head was band
 * chrome above the fold, so a phone spent 207px of 844 on chrome it could not put away and the
 * document began 43% down the screen; opened, the outline was a flat wrap of equal 26px rows.
 * Every case here reads a box, a computed style or a chip's words.
 *
 * It is its own suite because `web-narrow.test.ts` carries the width's other subject — a fence
 * that wraps rather than scrolls — and because the band's cases are about a surface the desk
 * never draws, which is the last case here: the desk's rail must be the one #731 landed.
 *
 * Where the machine has no browser the suite skips, naming `PI_CHROME`, so `bun run check` stays
 * green without Chrome and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import type { TestBrowser } from "../../test/helpers/browser.ts";
import {
	launchReviewBrowser,
	mountReview,
	openPlanTab,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
	type ReviewMount,
} from "../../test/helpers/plan-browser.ts";

/** What one case reads off the served page, measured rather than described by a class. */
interface Band {
	sectionsOpen: boolean;
	planTop: number;
	docTop: number;
	bandHeight: number;
	headerBottom: number;
	summaryTop: number;
	summaryHeight: number;
	headVisible: boolean;
	chips: { view: string; steps: string; comments: string };
	linkTops: number[];
	linkHeights: number[];
	linkPads: string[];
	listDisplay: string;
	bandScrolls: number;
}

async function band(page: Page): Promise<Band> {
	return page.evaluate(() => {
		const scope = globalThis as unknown as {
			document: {
				getElementById(id: string): unknown;
				querySelector(selector: string): unknown;
				querySelectorAll(selector: string): Iterable<unknown>;
			};
			getComputedStyle(node: unknown): { display: string; paddingLeft: string };
		};
		const doc = scope.document;
		const styled = scope.getComputedStyle;
		const box = (node: unknown): { top: number; bottom: number; height: number } => {
			const rect = (
				node as { getBoundingClientRect(): { top: number; bottom: number; height: number } }
			).getBoundingClientRect();
			return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
		};
		const text = (id: string): string =>
			((doc.getElementById(id) as { textContent: string | null } | null)?.textContent ?? "").trim();
		const sections = doc.getElementById("review-sections") as { open: boolean };
		const summary = doc.querySelector(".bf-app__sidebar .bf-panel__summary");
		const head = doc.querySelector(".review-panel--head") as { checkVisibility(): boolean };
		const sidebar = doc.querySelector(".bf-app__sidebar") as { scrollHeight: number; clientHeight: number };
		const links = [...doc.querySelectorAll("#outline-list a")] as unknown as {
			getBoundingClientRect(): { top: number; height: number };
		}[];
		return {
			sectionsOpen: sections.open,
			planTop: box(doc.getElementById("plan")).top,
			docTop: box(doc.querySelector("#plan .bf-block")).top,
			bandHeight: box(sidebar).height,
			headerBottom: box(doc.querySelector(".bf-app__head")).bottom,
			summaryTop: box(summary).top,
			summaryHeight: box(summary).height,
			headVisible: head.checkVisibility(),
			chips: { view: text("band-view"), steps: text("band-steps"), comments: text("band-comments") },
			linkTops: links.map((link) => Math.round(link.getBoundingClientRect().top)),
			linkHeights: links.map((link) => Math.round(link.getBoundingClientRect().height)),
			linkPads: links.map((link) => styled(link).paddingLeft),
			listDisplay: styled(doc.getElementById("outline-list")).display,
			bandScrolls: Math.round(sidebar.scrollHeight - sidebar.clientHeight),
		};
	});
}

describe.skipIf(REVIEW_CHROME === undefined)("the review's narrow band", () => {
	let mount: ReviewMount;
	let browser: TestBrowser;

	beforeAll(async () => {
		mount = await mountReview(REVIEW_PAGE);
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
		await mount?.close();
	}, 30_000);

	/** The suite's tab on the served review at one width, with its blocks painted. */
	async function open(width: number, height = 900): Promise<Page> {
		const page = await openPlanTab(browser, mount.url, { width, height });
		await page.waitForSelector("#plan .bf-block", { timeout: REVIEW_PAINT_MS });
		return page;
	}

	test("costs one row when shut, at a phone and at a narrow window", async () => {
		// 207px of an 844 phone and 190 at 900 before this card: the head panel was band chrome
		// the reader could not fold, so the document began at 362 (43% of the phone) and 301.
		for (const [width, bound] of [
			[390, 220],
			[900, 180],
		] as const) {
			const page = await open(width);
			const shape = await band(page);
			expect(shape.sectionsOpen, `the fold starts shut at ${width}`).toBe(false);
			expect(shape.summaryHeight, "the row is a touch target").toBeGreaterThanOrEqual(44);
			expect(shape.bandHeight, `the shut band is one row, at ${shape.bandHeight}`).toBeLessThanOrEqual(46);
			expect(shape.headVisible, "the head panel is not drawn behind a shut fold").toBe(false);
			expect(shape.planTop - shape.headerBottom, "nothing but the row sits under the header").toBeLessThanOrEqual(46);
			expect(shape.docTop, `the document starts above ${bound}, at ${shape.docTop}`).toBeLessThan(bound);
		}
	});

	test("carries the view and both counts in the row while the fold is shut", async () => {
		// The reversal of #729 is only honest if the row keeps what that card protected: a filtered
		// plan that reads as a short one. The fixture is 1 of 3 steps ticked with one stored note,
		// and the view is changed on the page rather than in the bundle, so a chip that never
		// repaints fails here.
		const page = await open(390);
		const shut = await band(page);
		expect(shut.chips).toEqual({ view: "All", steps: "1/3", comments: "1" });
		await page.click("#review-sections > summary");
		await page.click('[data-view="comments"]');
		await page.click("#review-sections > summary");
		const after = await band(page);
		expect(after.sectionsOpen).toBe(false);
		expect(after.chips.view, "the row follows the view the reader pressed").toBe("Comments");
	});

	test("opens into one vertical section per row, touch-sized, inside the band's cap", async () => {
		// The flat wrap was eight equal 25px rows with no indentation; the band is the shell's 50vh
		// box (collapsedShell), so an open fold pushes the document to half the window and no
		// further, and scrolls instead. The row stays at the band's top while it does, or the only
		// way to shut the fold scrolls away with it. Twelve sections, so the fold has more than the
		// band can show: the fixture's two would fit and prove nothing about scrolling.
		const tall = await mountReview({
			...REVIEW_PAGE,
			outline: Array.from({ length: 12 }, (_, index) => ({
				id: `s-${index}`,
				line: index,
				level: index % 3 === 0 ? 1 : 2,
				text: `Section ${index + 1}`,
			})),
		});
		const page = await openPlanTab(browser, tall.url, { width: 390, height: 700 });
		try {
			await page.waitForSelector("#plan .bf-block", { timeout: REVIEW_PAINT_MS });
			await page.click("#review-sections > summary");
			const shape = await band(page);
			expect(shape.sectionsOpen).toBe(true);
			expect(shape.listDisplay, "one section per row, not a wrapped cloud").toBe("block");
			expect(new Set(shape.linkTops).size, "every link gets its own line").toBe(shape.linkTops.length);
			for (const height of shape.linkHeights) {
				expect(height, "a thumb target, not a 26px row").toBeGreaterThanOrEqual(44);
			}
			// The hierarchy the wrap threw away: a level-2 row is indented past a level-1 one.
			const [first, second] = shape.linkPads;
			expect(Number.parseFloat(second ?? "0")).toBeGreaterThan(Number.parseFloat(first ?? "0"));
			// The shell's cap, not a second scroller on the list.
			expect(shape.bandHeight, `the band is capped at 50vh, at ${shape.bandHeight}`).toBeLessThanOrEqual(351);
			expect(shape.bandScrolls, "the band scrolls what it cannot show").toBeGreaterThan(0);
			// Scrolled to the bottom, the row is still the row: sticky inside the band.
			await page.evaluate(() => {
				const sidebar = (
					globalThis as unknown as { document: { querySelector(selector: string): unknown } }
				).document.querySelector(".bf-app__sidebar") as { scrollTop: number; scrollHeight: number };
				sidebar.scrollTop = sidebar.scrollHeight;
			});
			const scrolled = await band(page);
			expect(
				Math.abs(scrolled.summaryTop - scrolled.headerBottom),
				"the row stays at the band's top",
			).toBeLessThanOrEqual(2);
		} finally {
			// The tab outlives this case's mount: park it before the server goes.
			await page.goto("about:blank");
			await tall.close();
		}
	});

	test("leaves the desk's rail exactly as it was, at 1280", async () => {
		// The desk keeps the row's own markup hidden and the fold open, so #731's rail — the state,
		// the captioned switch, the help, the seam, then the outline — is what a desk draws, and its
		// rows keep the 26px rhythm no thumb needs.
		const page = await open(1280);
		const shape = await band(page);
		expect(shape.sectionsOpen, "a desk keeps the outline open").toBe(true);
		expect(shape.summaryHeight, "the band's row is the kit's hidden element").toBe(0);
		expect(shape.headVisible, "the head panel is the rail's first block").toBe(true);
		expect(shape.planTop, "the document sits beside the rail").toBeLessThan(200);
		expect(shape.linkHeights[0], `a desk row keeps its rhythm, at ${shape.linkHeights[0]}`).toBeLessThan(30);
	});
});
