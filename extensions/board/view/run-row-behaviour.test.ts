/**
 * The card dialog's reviewed row, driven the way a reader drives it.
 *
 * Split from `dialog-behaviour.test.ts`, which is at its line budget: what a sign's run says is
 * its own question. The clause is `lib/board/round-text.ts`'s body, spliced into the page, so the
 * transcript's card and this dialog print one sentence about one record — and the case here is
 * that the page received that body and asks it the run, not that it spells the words again.
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
		await page.waitForSelector('#lane-done .bf-row[data-card="4"]', { timeout: PAINT_MS });
		await page.click('#lane-done .bf-row[data-card="4"] .bf-row__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		// The record names the tree, and the clause says `the checkout` rather than the path every
		// reader of this repository already knows — the word for where the work lands, which a path
		// cannot say at a glance.
		expect(await page.textContent("#card-dialog-reviewed")).toContain(
			"ran `bun run check` in the checkout (exit 0, main @ 3ccd9cdb)",
		);
	});
});
