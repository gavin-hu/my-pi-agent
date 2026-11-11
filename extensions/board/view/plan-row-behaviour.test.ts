/**
 * The card dialog's plan row, driven the way a reader drives it.
 *
 * Split from `dialog-behaviour.test.ts`, which is at its line budget: what the record says about
 * a stored path is its own question. The page spells a plan the way the transcript does — one
 * `shortenPath`, against the home the frame carries — so a reader who copies the row gets a path
 * the plan tools still take, and a path outside that home is left exactly as recorded.
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

	test("spells a plan under the home with a tilde, and leaves one outside it alone", async () => {
		const now = clock.now();
		const store = board.store;
		const under = join(homedir(), ".pi/agent/plans/8872d3adda0e/2026-11-11-1500-written-under-home.md");
		// The page's own string, from the page's own rule: `shortenPath` normalizes separators, so a
		// hand-built `~` prefix would carry this platform's and never match on Windows.
		const shortened = shortenPath(under, homedir());
		const outside = "/opt/elsewhere/2026-11-11-1500-written-outside-home.md";
		const contract = (path: string) => ({
			kind: "contract" as const,
			artifact: { path },
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
			await page.click('#lane-backlog .board-card[data-card="1"] .board-card__title');
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });

			await store.mutate("1", { kind: "claim" }, CORE, now);
			await store.mutate("1", contract(under), CORE, now);
			await row(page, shortened);
			// The tooltip says the same thing, because the text is what a reader copies.
			expect(await page.getAttribute("#card-dialog-plan", "title")).toBe(shortened);
			// A contract that names no command draws no verify rung — the label leaves with the
			// value, which an optional row inside a block of required lines left behind.
			expect(await hidden(page, "#card-dialog-verify")).toBe(true);
			expect(await hidden(page, "#card-dialog-verify-label")).toBe(true);

			await store.mutate("1", contract(outside), CORE, now);
			await row(page, outside);
			expect(await page.textContent("#card-dialog-plan")).toBe(outside);
		} finally {
			// The card goes back to the pool. A released card keeps the contract it recorded, which
			// the gates allow and the dialog suite's own cases already rely on.
			await store.mutate("1", { kind: "release" }, CORE, now);
		}
	});
});
