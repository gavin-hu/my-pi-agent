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
	openPlanTab,
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

	/** The suite's tab on the served review, at one width, with its blocks painted. */
	async function open(width: number): Promise<Page> {
		const page = await openPlanTab(browser, mount.url, { width, height: 900 });
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
	});

	test("keeps the line whole at 1280, where there is room to scroll", async () => {
		const page = await open(1280);
		for (const at of [0, 1]) {
			await outgrows(page, at);
			expect((await panel(page, at)).textContent).toContain(LONG);
		}
	});
});

/**
 * The narrow review itself: what the chrome costs the document, and which control answers.
 *
 * Every case here reads a box or a computed style, because the defects this card fixes are
 * invisible to a class name — a list that folds and takes the filter with it, a field that is
 * 15px, and a row that hides an action behind a menu are all still "present" in the markup.
 *
 * The bounds are today's measurements with room, and the comment names the number each one
 * replaces: at 420 the open band put the plan pane at y=391 of 900 (jack's measurement on
 * #708), and the switch and its count cost the band 38px of the 317 it now sits at.
 */
describe.skipIf(REVIEW_CHROME === undefined)("the narrow review", () => {
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
	async function open(width: number): Promise<Page> {
		const page = await openPlanTab(browser, mount.url, { width, height: 900 });
		await page.waitForSelector("#plan .bf-block", { timeout: REVIEW_PAINT_MS });
		return page;
	}

	/** The facts one case reads, measured in the page rather than described by a class. */
	interface Skin {
		sectionsOpen: boolean;
		moreOpen: boolean;
		planTop: number;
		viewTop: number;
		viewInSection: boolean;
		noteInSection: boolean;
		shareTop: number;
		shareVisible: boolean;
		rowTop: number;
		rowBottom: number;
	}

	/**
	 * The page's own DOM, as these two cases read it.
	 *
	 * `page.evaluate` runs the body in the browser, where this package's `tsconfig.json` — `lib:
	 * ["ES2023"]`, no DOM — has no types for it. These name the members the bodies touch, and the
	 * one cast below is the browser boundary: the global is the page's, not a double of it.
	 */
	interface DomRect {
		top: number;
		bottom: number;
		height: number;
	}

	interface DomNode {
		/** A `<details>` element's open state. */
		open: boolean;
		getBoundingClientRect(): DomRect;
		contains(other: DomNode | null): boolean;
	}

	interface DomDocument {
		getElementById(id: string): DomNode | null;
		querySelector(selector: string): DomNode | null;
	}

	interface DomGlobals {
		document: DomDocument;
		getComputedStyle(node: DomNode): { fontSize: string };
	}

	async function skin(page: Page): Promise<Skin> {
		return page.evaluate(() => {
			const { document: doc } = globalThis as unknown as DomGlobals;
			const present = (node: DomNode | null): DomNode => {
				if (node === null) throw new Error("the page drew no node to measure");
				return node;
			};
			const box = (node: DomNode): DomRect => {
				const rect = node.getBoundingClientRect();
				return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
			};
			const sections = doc.getElementById("review-sections");
			const view = doc.getElementById("review-view");
			const note = doc.getElementById("review-note");
			const share = doc.getElementById("share");
			const row = doc.querySelector(".bf-app__actions");
			const top = (node: DomNode | null): number => box(present(node)).top;
			const heightOf = (node: DomNode | null): number => box(present(node)).height;
			return {
				sectionsOpen: sections ? sections.open : false,
				moreOpen: doc.getElementById("review-more")?.open ?? false,
				planTop: top(doc.getElementById("plan")),
				viewTop: view ? top(view) : -1,
				viewInSection: view ? present(sections).contains(view) : true,
				noteInSection: note ? present(sections).contains(note) : true,
				shareTop: share ? top(share) : -1,
				shareVisible: share ? heightOf(share) > 0 : false,
				rowTop: top(row),
				rowBottom: box(present(row)).bottom,
			};
		});
	}

	test("folds the whole rail at 420 into one row, and keeps the filter's answer in it", async () => {
		const page = await open(420);
		const shape = await skin(page);
		// 391 was the open band's pane top before #732; the fold is one row now, so the document
		// starts above 250 of 900 rather than 346.
		expect(shape.sectionsOpen, "the list starts shut on a phone").toBe(false);
		expect(shape.planTop, `the document starts above 250, at ${shape.planTop}`).toBeLessThan(250);
		// #729 kept the switch outside the list because a folded list took the filter with it, and a
		// filtered plan then read as a short one. #732 reversed that on purpose — one row shut is the
		// card — so the switch is inside the fold now and the row's chips are what keep the answer:
		// the pressed view and both counts live in the summary, and `web-band.test.ts` holds them.
		expect(shape.viewInSection, "the fold owns the whole rail, the switch included").toBe(true);
		expect(shape.noteInSection, "and the count it writes").toBe(true);
	});

	test("leaves the list open at 1280, where the rail is a column", async () => {
		const page = await open(1280);
		const shape = await skin(page);
		expect(shape.sectionsOpen, "a desk keeps the outline open").toBe(true);
		// Beside, not above: the plan pane starts at the band's own top, not below it.
		expect(shape.planTop, "the document sits beside the rail").toBeLessThan(200);
	});

	test("sets a comment field at 16px, so a phone does not zoom on focus", async () => {
		const page = await open(420);
		await page.click("#plan .bf-block .bf-block__add", { timeout: REVIEW_PAINT_MS });
		await page.waitForSelector(".bf-composer textarea", { timeout: REVIEW_PAINT_MS });
		const size = await page.evaluate(() => {
			const { document: doc, getComputedStyle } = globalThis as unknown as DomGlobals;
			const area = doc.querySelector(".bf-composer textarea");
			return area ? Number.parseFloat(getComputedStyle(area).fontSize) : 0;
		});
		expect(size, "the kit inherits the 15px body size; the field names 16").toBe(16);
	});

	test("folds sharing and closing behind one control at 640, and shows them when it opens", async () => {
		const page = await open(640);
		const shut = await skin(page);
		expect(shut.moreOpen, "the row starts folded").toBe(false);
		expect(shut.shareVisible, "a folded action draws nothing").toBe(false);

		await page.click("#review-more > summary");
		const openShape = await skin(page);
		expect(openShape.moreOpen).toBe(true);
		expect(openShape.shareVisible, "the menu draws the action once opened").toBe(true);
		expect(openShape.shareTop, "the menu covers the document rather than the header's height").toBeGreaterThanOrEqual(
			shut.rowTop,
		);
	});

	test("keeps both actions in the row at 1280", async () => {
		const page = await open(1280);
		const shape = await skin(page);
		expect(shape.moreOpen, "the wide row is not a menu").toBe(true);
		expect(shape.shareVisible, "the action is drawn without opening anything").toBe(true);
		expect(shape.shareTop, "and it sits in the control row").toBeGreaterThanOrEqual(shape.rowTop);
		expect(shape.shareTop).toBeLessThan(shape.rowBottom);
	});
});
