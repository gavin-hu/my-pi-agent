/**
 * The ask row's facts line: one type, one height, and a column the reason starts at.
 *
 * The row review measured the fault this suite holds fixed: the pill, reason and age were 12px
 * while the kind and the owner inherited the column's 15px, so a row had three things at title
 * size and its sentence was the smallest; a one-line row was 43, 51 or 52px depending on which
 * optional parts a card carried; and the reason followed a variable-width pill and kind, starting
 * 138px apart on two rows. Everything here is computed off the page — sizes, boxes, the reason's
 * left edge — so a stylesheet that looks right and draws wrong fails.
 *
 * It needs a browser; where the machine has none the suite skips, naming PI_CHROME.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { type Doc } from "../../../test/helpers/board-dom.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	drawn,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { makeClock } from "../../../test/helpers/clock.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** One boot and one teardown for the suite. */
const HOOK_MS = 30_000;

/** The sliver of an element this suite measures; this project's TypeScript has no DOM lib. */
interface Boxed {
	getBoundingClientRect(): { x: number; top: number; width: number; height: number };
	querySelector(selector: string): Boxed | null;
	textContent: string | null;
	getAttribute?(name: string): string | null;
}

/** One row's facts line: the row's box, the reason's box, and every part's computed type size. */
interface Facts {
	card: string;
	row: { w: number; h: number };
	why: { x: number; w: number; h: number } | null;
	/** Each part's font size, or absent when the card carries no such part. */
	sizes: { pill: string; kind: string; why: string; owner: string; stamp: string };
}

/**
 * Every row's facts line, read once.
 *
 * The fixture carries the shapes that used to disagree: an executing card with a type, a
 * breaking marker and an owner; unassigned cards with no type and no owner; a blocked card with
 * a danger reason; and a wait whose reason is long enough to clamp.
 */
const factsOf = (page: Page): Promise<Facts[]> =>
	page.evaluate(() => {
		const document = (globalThis as unknown as { document: Doc }).document;
		const style = (globalThis as unknown as { getComputedStyle(n: unknown): { fontSize: string } }).getComputedStyle;
		const box = (node: Boxed) => node.getBoundingClientRect();
		const round = (value: number) => Math.round(value * 10) / 10;
		return Array.from(document.querySelectorAll("#board-team .board-queue__row"), (node) => {
			const row = node as unknown as Boxed;
			const why = row.querySelector(".board-queue__why");
			const size = (selector: string) => {
				const found = row.querySelector(selector);
				return found === null ? "" : style(found).fontSize;
			};
			return {
				card: row.getAttribute?.("data-card") ?? "",
				row: { w: round(box(row).width), h: round(box(row).height) },
				why:
					why === null ? null : { x: Math.round(box(why).x), w: Math.round(box(why).width), h: round(box(why).height) },
				sizes: {
					pill: size(".bf-tag"),
					kind: size(".bf-row__kind"),
					why: size(".board-queue__why"),
					owner: size(".board-owner"),
					stamp: size(".board-stamp"),
				},
			};
		});
	}) as Promise<Facts[]>;

let board: BoardBrowser;

describe.skipIf(CHROME === undefined)("the ask row's facts", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({ lead: LEAD.label, now: clock.now, seed: seedWorkingBoard });
	}, HOOK_MS);

	afterAll(async () => {
		await board?.close();
	}, HOOK_MS);

	for (const width of [1280, 1440] as const) {
		test(`sets one type on the facts line at ${width}`, async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
			await page.setViewportSize({ width, height: 900 });
			await drawn(page);
			const rows = await factsOf(page);
			expect(rows.length).toBeGreaterThan(2);
			for (const row of rows) {
				// Every part a card carries is the same size; a part it does not carry is absent.
				const sizes = Object.entries(row.sizes).filter(([, size]) => size !== "");
				expect(sizes.length, `card ${row.card}`).toBeGreaterThan(1);
				for (const [part, size] of sizes) expect(size, `card ${row.card} ${part}`).toBe("12px");
			}
			// A one-line reason makes every row the same height, whatever optional parts it has:
			// before the fix these were 43 (neither), 51 (a kind) and 52 (an owner).
			const oneLine = rows.filter((row) => row.why !== null && row.why.h <= 16);
			expect(oneLine.length, `one-line rows at ${width}`).toBeGreaterThan(1);
			const heights = [...new Set(oneLine.map((row) => row.row.h))];
			expect(heights, `one-line heights at ${width}`).toEqual([44]);
		});

		test(`starts every reason at one x at ${width}`, async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
			await page.setViewportSize({ width, height: 900 });
			await drawn(page);
			const xs = (await factsOf(page)).flatMap((row) => (row.why === null ? [] : [row.why.x]));
			expect(xs.length).toBeGreaterThan(2);
			// The labels are a track, so the sentence's left edge is a column rather than a function
			// of how wide the pill and the kind happen to be (the spread was 138px before this).
			expect(Math.max(...xs) - Math.min(...xs), `reason starts at ${width}`).toBeLessThanOrEqual(4);
		});
	}

	test("gives a phone the reason a full line", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
		await page.setViewportSize({ width: 420, height: 900 });
		await drawn(page);
		const rows = await factsOf(page);
		const withReason = rows.filter((row) => row.why !== null);
		expect(withReason.length).toBeGreaterThan(1);
		for (const row of withReason) {
			// The labels and the age keep the first line and the sentence takes the width beneath it,
			// so its box is the row's width rather than the strip the labels left over.
			expect(Math.abs((row.why?.w ?? 0) - row.row.w), `card ${row.card}`).toBeLessThanOrEqual(1);
		}
		// The signature row's reason is the 29-character sentence that used to clamp into two 99px
		// lines: on its own line it is one.
		const signature = rows.find((row) => row.sizes.kind !== "");
		expect(signature?.why?.h ?? 0).toBeLessThanOrEqual(16);
	});
});
