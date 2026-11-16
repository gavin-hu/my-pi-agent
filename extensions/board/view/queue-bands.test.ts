/**
 * The Needs you queue's width: every band fills the track the grid gives it.
 *
 * `team.test.ts` holds the tab's own contracts and is named at its height in
 * `test/suite-sizes.test.ts`, so the band's width lives here rather than growing a suite that may
 * not gain a line. The case boots the served page because a band's width is a computed layout: a
 * stylesheet can promise `1fr` and only a browser says whether a `max-width` beat it — which is
 * exactly what a 40rem cap on the band did, leaving the asks short of the pane and the swimlanes
 * under them full width.
 *
 * Both sides of the comparison come off the page — each band's box, the column gap the grid
 * actually computed, the queue's own content box — so the case cannot pass while the layout drifts
 * under a number written here.
 *
 * It needs a browser. Where the machine has none the suite skips, naming `PI_CHROME`, so
 * `bun run check` stays green on a runner without Chrome and still says why nothing ran.
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

/** How long this suite's hooks may take: one boot, and a teardown that closes the browser. */
const HOOK_MS = 30_000;

/**
 * The window the case measures at: wide enough that the queue holds two tracks, since a queue
 * one track wide cannot tell a band that fills from a band that was capped.
 */
const WIDE = 1680;

/** One line of bands as the grid drew it, and the use it makes of the queue's content box. */
interface Line {
	/** How many bands start on this line. */
	bands: number;
	/** Their widths plus the gaps between them, in CSS pixels. */
	covered: number;
}

/** What the queue's own geometry says, read in one frame. */
interface Widths {
	/** The queue's content box: its client width less its inline padding. */
	content: number;
	/** The column gap the grid computed for itself, rather than the one a stylesheet promised. */
	gap: number;
	/** One entry per line of bands, in the order they are read. */
	lines: Line[];
}

/** The sliver of an element the case measures; this project's TypeScript has no DOM lib. */
interface Box {
	clientWidth: number;
	getBoundingClientRect(): { top: number; width: number };
}

/** The layout the queue drew, as the page computes it. */
async function widths(page: Page): Promise<Widths> {
	return page.evaluate(() => {
		const document = (globalThis as unknown as { document: Doc }).document;
		const computed = (
			globalThis as unknown as {
				getComputedStyle(node: unknown): { paddingLeft: string; paddingRight: string; columnGap: string };
			}
		).getComputedStyle;
		const queue = document.querySelector("#board-team .board-queue") as unknown as Box | null;
		if (queue === null) throw new Error("the Needs you queue is not on the page");
		const style = computed(queue);
		const content = queue.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
		const gap = Number.parseFloat(style.columnGap) || 0;
		// Bands that share a top share a line: the grid flowed them into one row.
		const lines = new Map<number, number[]>();
		for (const band of Array.from(document.querySelectorAll("#board-team .board-queue__band"))) {
			const box = band as unknown as Box;
			const top = Math.round(box.getBoundingClientRect().top);
			const row = lines.get(top) ?? [];
			row.push(box.getBoundingClientRect().width);
			lines.set(top, row);
		}
		return {
			content,
			gap,
			lines: Array.from(lines.values()).map((sizes) => ({
				bands: sizes.length,
				covered: sizes.reduce((sum, size) => sum + size, 0) + gap * (sizes.length - 1),
			})),
		};
	});
}

let board: BoardBrowser;

describe.skipIf(CHROME === undefined)("the Needs you queue", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({ lead: LEAD.label, now: clock.now, seed: seedWorkingBoard });
	}, HOOK_MS);

	afterAll(async () => {
		await board?.close();
	}, HOOK_MS);

	test("gives every band the width of the track it sits in", async () => {
		const page = await board.reuse();
		// `reuse()` puts the tab back to the window every case opens at, so this case's width is set
		// after it and not before.
		await page.setViewportSize({ width: WIDE, height: 900 });
		await drawn(page);
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__band", { timeout: PAINT_MS });
		await drawn(page);
		const layout = await widths(page);
		// The fixture files its asks under two bands; a queue that drew none would cover a box it
		// never fills into, and pass for the wrong reason.
		const bands = layout.lines.reduce((sum, line) => sum + line.bands, 0);
		expect(bands).toBeGreaterThan(1);
		expect(layout.content).toBeGreaterThan(0);
		for (const line of layout.lines) {
			// A band that fills its track leaves its line covering the content box to the pixel; a
			// capped one leaves the empty pane this case exists to catch. The tolerance is the
			// browser's sub-pixel rounding of a `1fr` track, not slack for a cap.
			expect(Math.abs(line.covered - layout.content)).toBeLessThanOrEqual(1);
		}
		// And the pane is wide enough for two tracks here, so the bands share a line instead of
		// stacking into one row a metre wide: the floor is what holds the measure a row is read at.
		expect(layout.lines.some((line) => line.bands > 1)).toBe(true);
	});
});
