/**
 * The filter box, driven the way a reader types in it.
 *
 * Split from `behaviour.test.ts`, which is at its line budget: what a query answers is its own
 * question. The page runs `MATCHES_QUERY_JS`, the spliced body of `matchesQuery`, so the id is
 * already answered there — the case here is that the box reaches that body and the card the ref
 * names is the only row left, not that the rule spells itself again.
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
import { type Doc, type ElementLike } from "../../../test/helpers/board-dom.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import { makeClock } from "../../../test/helpers/clock.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** The board the suite reads. */
let board: BoardBrowser;

/** The suite's one tab, its document reloaded for each case. */
const openPage = (): Promise<Page> => board.reuse();

describe.skipIf(CHROME === undefined)("the filter box", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/filter" },
		});
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("finds a card by the number a transcript line printed", async () => {
		const page = await openPage();
		// `#1` is the ref the row prints and a note quotes; no other field on that card spells it,
		// so a row here is the id being read and nothing else.
		await page.fill("#board-filter", "#1");
		await page.waitForFunction(
			() => {
				const document = (globalThis as unknown as { document: Doc }).document;
				return (
					document.querySelectorAll("#lane-backlog .board-row").length === 1 &&
					document.querySelectorAll("#lane-execute .board-row").length === 0
				);
			},
			undefined,
			{ timeout: PAINT_MS },
		);
		const titles = await page.$$eval("#lane-backlog .bf-row__title", (nodes) =>
			Array.from(nodes as ArrayLike<ElementLike>, (node) => node.textContent ?? ""),
		);
		expect(titles).toEqual(["Export orders as CSV"]);
	});
});
