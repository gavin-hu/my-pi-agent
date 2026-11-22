/**
 * The card dialog's plan row, driven the way a reader drives it.
 *
 * Split from `dialog-behaviour.test.ts`, which is at its line budget: what the record says about
 * a stored path is its own question. The row names the plan and puts the whole path on the title:
 * a plan's file name is what identifies it, while the store's key and the plans prefix are the
 * part a 570px cell cannot spend — the transcript prints the path whole because a terminal line
 * can hold it, and this row elided it from the front, so the name was the half that went.
 *
 * It needs a browser; where the machine has none it skips, naming `PI_CHROME`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { shortenPath } from "../../../lib/format.ts";
import { type Doc, hidden } from "../../../test/helpers/board-dom.ts";
import { CORE, LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import { makeClock } from "../../../test/helpers/clock.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** The board the suite reads. */
let board: BoardBrowser;

/** The suite's one tab, its document reloaded for each case. */
const openPage = (): Promise<Page> => board.reuse();

describe.skipIf(CHROME === undefined)("the card dialog's plan row", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/plan-row" },
		});
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("names the plan by its file, and keeps the whole path on the title", async () => {
		const now = clock.now();
		const store = board.store;
		const under = join(homedir(), ".pi/agent/plans/8872d3adda0e/2026-11-11-1500-written-under-home.md");
		// The page's own string, from the page's own rule: `shortenPath` normalizes separators, so a
		// hand-built `~` prefix would carry this platform's and never match on Windows.
		const shortened = shortenPath(under, homedir());
		// The row is the name; the path is on the title, shortened against the home the frame carries
		// so the two surfaces spell a plan one way.
		const named = (path: string): string => path.split(/[\\/]/).pop() ?? "";
		const outside = "/opt/elsewhere/2026-11-11-1500-written-outside-home.md";
		const contract = (record: string) => ({
			kind: "contract" as const,
			artifact: { record },
			goal: "One goal",
			acceptance: "One test",
			scopeOut: "Nothing else",
		});
		const row = (page: Page, expected: string): Promise<unknown> =>
			page.waitForFunction(
				(want) =>
					((globalThis as unknown as { document: Doc }).document.getElementById("card-dialog-plan")?.textContent ??
						"") === want,
				expected,
				{ timeout: PAINT_MS },
			);
		try {
			const page = await openPage();
			await page.click('#lane-backlog .board-row[data-card="1"] .bf-row__title');
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });

			await store.mutate("1", { kind: "claim" }, CORE, now);
			await store.mutate("1", contract(under), CORE, now);
			await row(page, named(under));
			// The whole path, elided from the row, is one hover away — shortened the way the transcript
			// shortens it, so the two surfaces name one plan.
			expect(await page.getAttribute("#card-dialog-plan", "title")).toBe(shortened);
			// A contract that names no command draws no verify rung — the label leaves with the
			// value, which an optional row inside a block of required lines left behind.
			expect(await hidden(page, "#card-dialog-verify")).toBe(true);
			expect(await hidden(page, "#card-dialog-verify-label")).toBe(true);

			await store.mutate("1", contract(outside), CORE, now);
			await row(page, named(outside));
			// A path outside the home is left exactly as recorded, because there is nothing to elide.
			expect(await page.getAttribute("#card-dialog-plan", "title")).toBe(outside);
		} finally {
			// The card goes back to the pool. A released card keeps the contract it recorded, which
			// the gates allow and the dialog suite's own cases already rely on.
			await store.mutate("1", { kind: "release" }, CORE, now);
		}
	});
});
