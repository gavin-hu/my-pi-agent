/**
 * The card face: what a lane draws, and the one height it draws it at.
 *
 * `pages.test.ts` holds the names and the rules a reader cannot see; `behaviour.test.ts` holds
 * what the page does when a reader drives it. This holds the shape of the face itself, which
 * neither can measure: a lane is an index, so every row in it is the same height whatever the
 * card records — a long note, no paths, a title that wraps, and a state drawn or not — and the
 * state a card owes somebody is the one line the face draws, with the whole sentence still the
 * card's hover and the title button's description for the keyboard.
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
	getBoundingClientRect(): { top: number; bottom: number; width: number; height: number };
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
		"draws the state a card owes, and keeps a note off the face",
		async () => {
			const page = await openPage();
			await page.waitForSelector(".board-row", { timeout: PAINT_MS });
			// Two cards, two kinds of reason: the in-flight card owes a spot-check, and the pool card's
			// reason is its last note. Both are in the document; only the state is drawn.
			const faceOf = (lane: string) =>
				page.$eval(`#lane-${lane} .board-row`, (node) => {
					const card = node as unknown as Boxed;
					const line = card.querySelector(".bf-row__reason");
					const meta = card.querySelector(".bf-row__meta");
					const box = (element: Boxed | null) => {
						if (element === null) return null;
						const frame = element.getBoundingClientRect();
						return {
							top: Math.round(frame.top),
							bottom: Math.round(frame.bottom),
							height: Math.round(frame.height),
						};
					};
					return {
						card: box(card),
						line: box(line),
						meta: box(meta),
						status: line?.getAttribute("data-status") ?? null,
						sentence: (line?.textContent ?? "").trim(),
						hover: line?.getAttribute("title") ?? "",
					};
				});
			const owed = await faceOf("execute");
			const noted = await faceOf("backlog");
			// The state is drawn: a real line, above the footer where the holder and the age stay.
			expect(owed.status).toBe("true");
			expect(owed.line?.height ?? 0).toBeGreaterThan(12);
			expect(owed.line?.bottom ?? 0).toBeLessThanOrEqual((owed.meta?.top ?? 0) + 1);
			expect(owed.sentence.length).toBeGreaterThan(10);
			expect(owed.hover).toBe(owed.sentence);
			// A note is prose, not a state: the same node, still clipped to the pixel the recipe clips.
			expect(noted.status).toBeNull();
			expect(noted.line?.height ?? 99).toBeLessThanOrEqual(1);
			// The box is reserved, and that is the point: the card that draws nothing is the height of
			// the card that draws a state, so a lane stays a column rather than a ragged list.
			expect(noted.card?.height).toBe(owed.card?.height);
			// Neither loses the sentence for the keyboard or a screen reader.
			const described = await page.$eval(
				"#lane-execute .bf-row__title",
				(node) => node.getAttribute("aria-describedby") ?? "",
			);
			expect(described).toContain("card-reason-");
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
