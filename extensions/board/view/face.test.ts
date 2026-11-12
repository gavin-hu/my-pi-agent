/**
 * The card face: what a lane draws, and the one height it draws it at.
 *
 * `pages.test.ts` holds the names and the rules a reader cannot see; `behaviour.test.ts` holds
 * what the page does when a reader drives it. This holds the shape of the face itself, which
 * neither can measure: a lane is an index, so every row in it is the same height whatever the
 * card records — a long note, no paths, a title that wraps — and the reason a card sits where
 * it does is not drawn on it, staying as the card's hover and as the title button's
 * description for the keyboard.
 *
 * The height is asserted as "one value, and only one", never as a number of pixels: the boxes
 * are computed from the type tokens, so a suite that pinned 123 would fail the day a token
 * moved and pass the day a card grew the way this change exists to stop.
 *
 * It needs a browser; where the machine has none it skips, naming `PI_CHROME`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { makeClock } from "../../../test/helpers/clock.ts";
import { type Doc, type ElementLike } from "../../../test/helpers/board-dom.ts";
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
	getBoundingClientRect(): { width: number; height: number };
	closest(selector: string): Boxed | null;
	querySelector(selector: string): Boxed | null;
}

/** The board the suite reads. */
let board: BoardBrowser;

/** The suite's one tab, its document reloaded for each case. */
const openPage = (): Promise<Page> => board.reuse();

/**
 * The heights of the faces a reader can see, to a tenth of a pixel.
 *
 * A folded lane keeps its rows in the document — hidden, so they measure nothing — and a zero
 * among the heights would make "one height" true by accident.
 */
async function faceHeights(page: Page): Promise<number[]> {
	return page.$$eval(".board-row", (nodes) =>
		Array.from(
			nodes as unknown as ArrayLike<Boxed>,
			(node) => Math.round(node.getBoundingClientRect().height * 10) / 10,
		).filter((height) => height > 0),
	);
}

/** The Done lane a fresh document opens folded, opened so its faces are measured too. */
async function unfoldDone(page: Page): Promise<void> {
	// A frame from the live stream rebuilds a lane, so the toggle a locator resolves can be gone
	// before a click reaches it: the press is made in the page, and the state is read back.
	for (let attempt = 0; attempt < 5; attempt++) {
		const shown = await page.evaluate(() => {
			const list = (globalThis as unknown as { document: Doc }).document.querySelector("#lane-done");
			return list !== null && !list.hidden;
		});
		if (shown) return;
		await page.evaluate(() => {
			const toggle = (globalThis as unknown as { document: Doc }).document.querySelector("#lane-head-done");
			(toggle as unknown as { click(): void } | null)?.click();
		});
		await page.waitForTimeout(100);
	}
	throw new Error("the Done lane would not unfold");
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
		"draws every face in a lane at one height, a long note and a short one alike",
		async () => {
			const page = await openPage();
			await page.waitForSelector(".board-row", { timeout: PAINT_MS });
			await unfoldDone(page);
			const faces = await faceHeights(page);
			expect(faces.length).toBeGreaterThan(5);
			expect([...new Set(faces)]).toHaveLength(1);

			// The cards that used to be taller: a note nobody bounded, and no paths to draw at all.
			await board.store.create(
				{ title: "A card whose note runs on", paths: [], note: "why this card waits. ".repeat(20) },
				LEAD,
				clock.now(),
			);
			await page.reload({ waitUntil: "load" });
			await page.waitForSelector(".board-row", { timeout: PAINT_MS });
			await unfoldDone(page);
			const withLongNote = await faceHeights(page);
			expect(withLongNote.length).toBeGreaterThan(5);
			expect([...new Set(withLongNote)]).toEqual([faces[0] ?? -1]);

			// And the narrow layout, where the meta line wraps and the picker shows one lane at a time.
			await page.setViewportSize({ width: 860, height: 900 });
			await page.waitForTimeout(50);
			expect([...new Set(await faceHeights(page))]).toEqual([faces[0] ?? -1]);
		},
		CASE_MS,
	);

	test(
		"keeps the reason off the face, and on the card's hover and description",
		async () => {
			const page = await openPage();
			await page.waitForSelector(".board-row", { timeout: PAINT_MS });
			const reason = await page.$eval("#lane-execute .board-row .bf-row__reason", (node) => {
				const reason = node as unknown as Boxed;
				const box = reason.getBoundingClientRect();
				const title = reason.closest(".board-row")?.querySelector(".bf-row__title") ?? null;
				return {
					sentence: (reason.textContent ?? "").trim(),
					hover: reason.getAttribute("title") ?? "",
					id: reason.id,
					described: title === null ? null : (title.getAttribute("aria-describedby") ?? ""),
					width: Math.round(box.width),
					height: Math.round(box.height),
				};
			});
			// Not drawn: a hidden element measures the pixel the recipe clips, never the prose.
			expect(reason.width).toBeLessThanOrEqual(1);
			expect(reason.height).toBeLessThanOrEqual(1);
			// Still said, three ways: the hover for a pointer, the description for the keyboard and a
			// screen reader, and the sentence itself in the document.
			expect(reason.sentence.length).toBeGreaterThan(10);
			expect(reason.hover).toBe(reason.sentence);
			expect(reason.described).toContain(reason.id);
			await page.setViewportSize({ width: 1280, height: 900 });
		},
		CASE_MS,
	);
});
