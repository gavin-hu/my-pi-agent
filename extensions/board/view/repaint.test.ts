/**
 * What a frame repaints: a card whose own record did not move, but whose face prints a fact
 * about another card.
 *
 * A link is stored on the waiting card alone, so the two sentences a face derives from the
 * rest of the board — what the card waits for, and what it holds up — belong to the board
 * rather than to that card's file. Each case here writes to a card in another lane than the
 * face it moves, so the lane being watched holds no card that moved and only the derived
 * facts can tell it that the frame is news.
 *
 * It needs a browser. Where the machine has none the suite skips, naming `PI_CHROME`, so
 * `bun run check` stays green on a runner without Chrome and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Actor } from "../../../lib/board/rules.ts";
import type { BoardStore } from "../../../lib/board/store.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { advance } from "../../../test/helpers/board-flow.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const CORE: Actor = { id: "s-core", label: "billing-core" };

/** The note the waiting card carries, which its reason line falls back to. */
const NOTE = "from the support thread";

let board: BoardBrowser;

/**
 * Two cards waiting on a third, which is executing: the blocker is in a lane of its own, so
 * finishing it, or linking one more card to it, is a write to a lane the reader is not in.
 */
async function seedBoard(store: BoardStore, now: number): Promise<void> {
	await store.create({ title: "Export orders as CSV", paths: ["src/reports"], note: NOTE }, LEAD, now);
	const blocker = await store.create({ title: "Wire retries into the webhook", paths: [] }, CORE, now + 1_000);
	await advance(store, blocker.id, "execute", { owner: CORE }, now + 2_000);
	await store.create({ title: "Invoice totals round the wrong way", paths: [] }, LEAD, now + 3_000);
	// The link a session writes: one id on the waiting card, so the blocker's file is untouched.
	await store.mutate(
		"1",
		{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: [blocker.id] },
		LEAD,
		now + 4_000,
	);
}

describe.skipIf(CHROME === undefined)("a frame", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({ lead: LEAD.label, now: clock.now, seed: seedBoard });
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("repaints a card that gains a card waiting on it", async () => {
		const page = await board.open();
		const holds = () => page.textContent('#lane-execute .board-card[data-card="2"] .board-card__holds');
		await expect(holds()).resolves.toBe("holds up #1 (backlog) Export orders as CSV");
		// A third card is linked to the executing one. That is a write to a card in another
		// lane, and the blocker's own record keeps the revision it had.
		await board.store.mutate(
			"3",
			{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: ["2"] },
			LEAD,
			clock.now() + 10_000,
		);
		// The frame has landed once the edited card's own lane has drawn the reason its link
		// gave it; what is left to prove is that the lane in front of the reader heard too.
		await page.locator('#lane-backlog .board-card[data-card="3"] .board-card__reason').waitFor({ timeout: PAINT_MS });
		await expect(holds()).resolves.toBe(
			"holds up #1 (backlog) Export orders as CSV, #3 (backlog) Invoice totals round the wrong way",
		);
		await page.close();
	});

	test("repaints a card that stops waiting when its blocker is finished", async () => {
		const page = await board.open();
		const reason = () => page.textContent('#lane-backlog .board-card[data-card="1"] .board-card__reason');
		await expect(reason()).resolves.toBe("waits on #2 (execute) Wire retries into the webhook");
		// Another session finishes the blocker: its revision moves and the waiting card's own
		// record does not, so only the derived `waits` can say this frame is news.
		await advance(board.store, "2", "done", { owner: CORE }, clock.now() + 20_000);
		// The Done lane is folded at this fixture's size, so its cards are drawn and hidden.
		await page.locator('#lane-done .board-card[data-card="2"]').waitFor({ state: "attached", timeout: PAINT_MS });
		// It waits on nothing now, so the line is the card's own last note again.
		await expect(reason()).resolves.toBe(NOTE);
		await page.close();
	});
});
