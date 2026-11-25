/**
 * The card dialog's reviewed row and the merge beside it, driven the way a reader drives it.
 *
 * Split from `dialog-behaviour.test.ts`, which is at its line budget: what a sign's run says, and
 * which commit carried it, is its own question. The run's clause is `lib/workflow/round-text.ts`'s
 * body, spliced into the page, so the transcript's card and this dialog print one sentence about
 * one record — and the case here is that the page received that body and asks it the run, not that
 * it spells the words again. The landing is a rung of its own for the same reason the transcript
 * gives it a line: the facts are a sign, where it ran, and what that became.
 *
 * It needs a browser; where the machine has none it skips, naming `PI_CHROME`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import type { ElementLike } from "../../../test/helpers/board-dom.ts";
import { makeClock } from "../../../test/helpers/clock.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** The board the suite reads. */
let board: BoardBrowser;

/** The suite's one tab, its document reloaded for each case. */
const openPage = (): Promise<Page> => board.reuse();

describe.skipIf(CHROME === undefined)("the card dialog's reviewed row", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/run-row" },
		});
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("says which tree the spot-check's run was taken in, and the branch and commit there", async () => {
		const page = await openPage();
		await page.click("#lane-head-done");
		await page.waitForSelector('#lane-done .bf-row[data-card="6"]', { timeout: PAINT_MS });
		await page.click('#lane-done .bf-row[data-card="6"] .bf-row__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		// The record names the tree, and the clause says `the checkout` rather than the path every
		// reader of this repository already knows — the word for where the work lands, which a path
		// cannot say at a glance.
		expect(await page.textContent("#card-dialog-reviewed")).toContain(
			"ran `bun run check` in the checkout (exit 0, main @ 3ccd9cdb)",
		);
	});

	test("names the merge the close recorded, and draws the run whole", async () => {
		const page = await openPage();
		await page.click("#lane-head-done");
		await page.waitForSelector('#lane-done .bf-row[data-card="6"]', { timeout: PAINT_MS });
		await page.click('#lane-done .bf-row[data-card="6"] .bf-row__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });

		// The two rows name different commits on purpose, and this case holds both so neither can be
		// "corrected" into agreement: `reviewed` carries the sha the spot-check verified (`3ccd9cdb`),
		// while `landed` is the merge that carried it (`9a7d2e0`). A case asserting one value in both
		// would pass while hiding the very confusion this row exists to end — a finished card that
		// could not say which commit it became. The word and the seven-character slice are the
		// transcript's, so one fact has one spelling on both surfaces.
		expect(await page.textContent("#card-dialog-reviewed")).toContain("main @ 3ccd9cdb");
		expect(await page.textContent("#card-dialog-landed")).toBe("9a7d2e0");

		// The defect this row replaces was never a missing string: the merge sat in the DOM the whole
		// time, drawn wider than its cell and clipped, so a text assertion was green on a row nobody
		// could read to the end. This case measures instead — the run's clause now wraps, and no rung of
		// the ladder overflows the cell it is drawn in.
		for (const id of ["#card-dialog-reviewed", "#card-dialog-landed"]) {
			const measured = await page.evaluate((selector) => {
				const doc = globalThis as unknown as {
					document: { querySelector(selector: string): ElementLike | null };
				};
				const row = doc.document.querySelector(selector) as unknown as {
					scrollWidth: number;
					clientWidth: number;
				} | null;
				return row === null ? undefined : { scroll: row.scrollWidth, client: row.clientWidth };
			}, id);
			expect(measured, id).toBeDefined();
			expect(measured && measured.scroll <= measured.client, id).toBe(true);
		}
	});
});
