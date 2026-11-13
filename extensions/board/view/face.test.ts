/**
 * The card face: what a lane draws, how tall it draws it, and the one line every card carries.
 *
 * `pages.test.ts` holds the names and the rules a reader cannot see; `behaviour.test.ts` holds
 * what the page does when a reader drives it. This holds the shape of the face itself, which
 * neither can measure: a card is as tall as its content — a title that wraps makes a taller
 * note, a card with no hints a shorter one — and the state row is on every card, drawn when the
 * card owes somebody something and blank when it owes nothing, with a note's prose kept in it
 * for the description and out of the face.
 *
 * The heights are asserted as relations, never as numbers of pixels: the boxes are computed from
 * the type tokens, so a suite that pinned 146 would fail the day a token moved. The one absolute
 * fact is that the row clips, so nothing may be taller than the card holding it.
 *
 * It needs a browser; where the machine has none it skips, naming `PI_CHROME`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { makeClock } from "../../../test/helpers/clock.ts";
import { type ElementLike } from "../../../test/helpers/board-dom.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** How long one case may take: a boot, a reload, a viewport change, and a read of the faces. */
const CASE_MS = 30_000;

/**
 * The element a read measures.
 *
 * `ElementLike` is the DOM a suite reads text and attributes through; a box is the one fact
 * this suite adds, so it names it here rather than widening the helper every card suite shares.
 */
interface Boxed extends ElementLike {
	id: string;
	firstElementChild: Boxed | null;
	getBoundingClientRect(): { top: number; bottom: number; width: number; height: number };
	closest(selector: string): Boxed | null;
	querySelector(selector: string): Boxed | null;
}

/** The board the suite reads. */
let board: BoardBrowser;

/** The suite's one tab, its document reloaded for each case. */
const openPage = (): Promise<Page> => board.reuse();

/** One face as a reader sees it: its box, and whether the content it holds fits inside it. */
interface Face {
	height: number;
	/** What the row needs, and what the row gives it: equal unless a card is clipped. */
	scroll: number;
	client: number;
}

/** One card's face, by the id the client reads it by. */
async function faceOf(page: Page, id: string): Promise<Face> {
	return page.$eval(`.board-row[data-card="${id}"]`, (node) => {
		const card = node as unknown as Boxed & { scrollHeight: number; clientHeight: number };
		return {
			height: Math.round(card.getBoundingClientRect().height),
			scroll: card.scrollHeight,
			client: card.clientHeight,
		};
	});
}

/**
 * Every face a reader can see, to a tenth of a pixel.
 *
 * A folded lane keeps its rows in the document — hidden, so they measure nothing — and a zero would
 * make "nothing is clipped" true by accident.
 */
async function faces(page: Page): Promise<Face[]> {
	return page.$$eval(".board-row", (nodes) =>
		Array.from(nodes as unknown as ArrayLike<Boxed & { scrollHeight: number; clientHeight: number }>, (node) => ({
			height: Math.round(node.getBoundingClientRect().height * 10) / 10,
			scroll: node.scrollHeight,
			client: node.clientHeight,
		})).filter((face) => face.height > 0),
	);
}

/** The faces whose content does not fit the card that draws it. */
function clipped(measured: readonly Face[]): Face[] {
	return measured.filter((face) => face.scroll > face.client + 1);
}

describe.skipIf(CHROME === undefined)("the card face", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/face" },
		});
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test(
		"draws a card as tall as its content, and never taller",
		async () => {
			const page = await openPage();
			await page.waitForSelector(".board-row", { timeout: PAINT_MS });
			// Four cards in one lane, differing in exactly one thing each: a title that needs its second
			// line, a path list, and a note that runs on.
			const short = await board.store.create({ title: "Short one", paths: ["src/a"] }, LEAD, clock.now());
			const long = await board.store.create(
				{
					title: "A title long enough to need the second line it is allowed, and then enough words to fill it",
					paths: ["src/a"],
				},
				LEAD,
				clock.now(),
			);
			const bare = await board.store.create({ title: "Short one", paths: [] }, LEAD, clock.now());
			const noted = await board.store.create(
				{ title: "Short one", paths: ["src/a"], note: "why this card waits. ".repeat(20) },
				LEAD,
				clock.now(),
			);
			await page.reload({ waitUntil: "load" });
			await page.waitForSelector(".board-row", { timeout: PAINT_MS });
			const height = async (id: string) => (await faceOf(page, id)).height;
			// The height follows the content: a title taking both its lines is a taller note, and a card
			// with no hints is a shorter one.
			expect(await height(long.id)).toBeGreaterThan(await height(short.id));
			expect(await height(bare.id)).toBeLessThan(await height(short.id));
			// A note is prose and is not drawn, so twenty sentences are the same height as none.
			expect(await height(noted.id)).toBe(await height(short.id));
			// The row clips, so nothing may need more room than the card gives it — at either width.
			expect(clipped(await faces(page))).toEqual([]);
			await page.setViewportSize({ width: 860, height: 900 });
			await page.waitForTimeout(50);
			expect(clipped(await faces(page))).toEqual([]);
		},
		CASE_MS,
	);

	test(
		"draws a state row on every card, and keeps a note's words for the description",
		async () => {
			const page = await openPage();
			await page.waitForSelector(".board-row", { timeout: PAINT_MS });
			const nothing = await board.store.create({ title: "Nothing owed", paths: [] }, LEAD, clock.now());
			await page.reload({ waitUntil: "load" });
			await page.waitForSelector(".board-row", { timeout: PAINT_MS });
			// One read of one card's row: its box, its words, and how those words are drawn.
			const rowOf = (id: string) =>
				page.$eval(`.board-row[data-card="${id}"] .bf-row__reason`, (node) => {
					const line = node as unknown as Boxed;
					const frame = line.getBoundingClientRect();
					const inner = line.firstElementChild;
					return {
						height: Math.round(frame.height),
						prose: line.textContent ?? "",
						hover: line.getAttribute("title") ?? "",
						innerWidth: inner === null ? 0 : Math.round(inner.getBoundingClientRect().width),
					};
				});
			// #3 owes a spot-check: the row draws the sentence, on one line.
			const owed = await rowOf("3");
			expect(owed.height).toBeGreaterThan(12);
			expect(owed.prose.length).toBeGreaterThan(10);
			expect(owed.hover).toBe(owed.prose);
			// #1's reason is its last note: the row is still there, one line tall, and the prose inside it
			// is a one-pixel span — the hover and the description read it, the face does not.
			const noted = await rowOf("1");
			expect(noted.height).toBeGreaterThan(12);
			expect(noted.prose.length).toBeGreaterThan(10);
			expect(noted.hover).toBe(noted.prose);
			expect(noted.innerWidth).toBeLessThanOrEqual(1);
			// A card that owes nothing reserves the same row and says nothing in it: no words, no hover,
			// and nothing to describe the title with.
			const blank = await rowOf(nothing.id);
			expect(blank.height).toBe(owed.height);
			expect(blank.prose).toBe("");
			expect(blank.hover).toBe("");
			const described = await page.$eval(
				`.bf-row[data-card="${nothing.id}"] .bf-row__title`,
				(node) => node.getAttribute("aria-describedby") ?? "",
			);
			expect(described).not.toContain(`card-reason-${nothing.id}`);
			// The two rows that do say something describe the title with the same words they draw or hide.
			const owedDescribed = await page.$eval(
				'.bf-row[data-card="3"] .bf-row__title',
				(node) => node.getAttribute("aria-describedby") ?? "",
			);
			expect(owedDescribed).toContain("card-reason-3");
			const notedDescribed = await page.$eval(
				'.bf-row[data-card="1"] .bf-row__title',
				(node) => node.getAttribute("aria-describedby") ?? "",
			);
			expect(notedDescribed).toContain("card-reason-1");
			await page.setViewportSize({ width: 1280, height: 900 });
		},
		CASE_MS,
	);

	test(
		"leads with the title, and sets the rank back beside it",
		async () => {
			const page = await openPage();
			await page.waitForSelector(".board-row", { timeout: PAINT_MS });
			// One face carries both: the seeded execute card has a priority and a title.
			const face = await page.$eval("#lane-execute .board-row", (node) => {
				const card = node as unknown as Boxed;
				const computed = (globalThis as unknown as { getComputedStyle(n: unknown): Record<string, string> })
					.getComputedStyle;
				// A type step is two facts a reader sees at once, so the two are read together: a
				// title larger than its rank at a lighter weight would still leave the rank leading.
				const step = (selector: string) => {
					const found = card.querySelector(selector);
					if (found === null) return null;
					const style = computed(found);
					return {
						size: Number.parseFloat(style.fontSize ?? "0"),
						weight: Number.parseInt(style.fontWeight ?? "0", 10),
					};
				};
				// The card's own box is the check that the height reserved for the title still fits it:
				// it is `overflow:hidden`, so a bigger title that outgrew the face would clip quietly.
				const box = card as unknown as { scrollHeight: number; clientHeight: number };
				return {
					title: step(".bf-row__title"),
					rank: step(".board-row__priority"),
					overflow: box.scrollHeight - box.clientHeight,
				};
			});
			expect(face.rank).not.toBeNull();
			expect(face.title).toEqual({ size: 15, weight: 500 });
			expect(face.rank).toEqual({ size: 12, weight: 400 });
			expect(face.title?.size ?? 0).toBeGreaterThan(face.rank?.size ?? 0);
			expect(face.title?.weight ?? 0).toBeGreaterThanOrEqual(face.rank?.weight ?? 999);
			expect(face.overflow).toBeLessThanOrEqual(1);
		},
		CASE_MS,
	);
});
