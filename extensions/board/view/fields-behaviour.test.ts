/**
 * The card dialog's ladder values, read the way a reader reads them.
 *
 * Split from `dialog-behaviour.test.ts`, which is at its line budget: whether a value *reads* right
 * is its own question once the row exists. Two of them are facts about what a copy or a listener
 * gets rather than about markup — a list of paths that copied as one word, and a note list whose
 * type claimed an order it does not keep — and one is a pair of stamps that must agree.
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

describe.skipIf(CHROME === undefined)("the card dialog's values", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/values" },
		});
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("copies a paths row as a list", async () => {
		const page = await openPage();
		await page.click("#lane-execute .bf-row__title");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });

		// A copy is the fact this row exists for, so the assertion is a copy: the chips are separate
		// nodes and the separators are text, which is what makes the string read like the transcript's
		// `paths: a, b, c` line. A markup assertion would have passed on the row that concatenated.
		expect(await page.textContent("#card-dialog-path-list")).toBe("src/billing, src/api");

		// The notes are drawn newest first, so the list is unordered and the count rides the heading:
		// an `<ol>` claimed a chronology the order does not keep. This card carries two notes, so the
		// count has something to say.
		expect(await page.$eval("#card-dialog-notes", (node) => node.tagName)).toBe("UL");
		expect(await page.textContent("#card-dialog-note-count")).toContain("2");
	});

	test("stamps both record rows one way", async () => {
		const page = await openPage();
		await page.click("#lane-head-done");
		await page.waitForSelector('#lane-done .bf-row[data-card="4"]', { timeout: PAINT_MS });
		await page.click('#lane-done .bf-row[data-card="4"] .bf-row__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });

		// Both record rows are stamps of one moment, so both lead with the age: `3d by jack` and
		// `3d by gavin · ran …`. One leading with a name and the other with an age read as two kinds
		// of fact, on the two rows a reader compares.
		expect(await page.textContent("#card-dialog-updated")).toMatch(/^(just now|\d+[smhd]) by /);
		expect(await page.textContent("#card-dialog-reviewed")).toMatch(/^(just now|\d+[smhd]) by /);
	});
});
