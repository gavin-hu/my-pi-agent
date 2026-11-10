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
import { focusedId } from "../../../test/helpers/board-dom.ts";
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
	// And one card offered to a team that never took it: its reason line is the one sentence on the
	// page with an age inside it, which is what the ticker has to keep honest.
	const offered = await store.create({ title: "Refunds land in the wrong currency", paths: [] }, LEAD, now + 5_000);
	await store.mutate(offered.id, { kind: "offer" }, LEAD, now + 6_000);
}

describe.skipIf(CHROME === undefined)("a frame", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({ lead: LEAD.label, now: clock.now, seed: seedBoard });
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("repaints a card that gains a card waiting on it", async () => {
		const page = await board.reuse();
		// The other half of a link is the reason line's, after a middot: one row for one edge.
		const holds = () => page.textContent('#lane-execute .board-card[data-card="2"] .board-card__reason');
		await expect(holds()).resolves.toContain("holds up #1 (backlog) Export orders as CSV");
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
		await expect(holds()).resolves.toContain(
			"holds up #1 (backlog) Export orders as CSV, #3 (backlog) Invoice totals round the wrong way",
		);
	});

	test("stamps every age in an open record, so the record's clock moves", async () => {
		const page = await board.reuse();
		// The record is filled once per frame, and a frame arrives only when a card moves — so an
		// age written as text froze where its last frame caught it, while the face behind it ticked.
		await page.click('#lane-execute .board-card[data-card="2"] .board-card__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		const titles = await page.$$eval("#board-card-dialog [data-at]", (nodes) =>
			nodes.map((node) => node.getAttribute("data-at-title") ?? ""),
		);
		expect(titles).toContain("in this lane {age}");
		expect(titles).toContain("approved {age}");
		expect(titles).toContain("updated {age}");
		// The lane age rides the state line the head already draws, as the middot it always was.
		expect(await page.textContent("#card-dialog-since")).toMatch(/^ · \S+$/);
		// A note's stamp is one too, on the card that carries a note.
		await page.keyboard.press("Escape");
		await page.waitForSelector("#board-card-dialog", { state: "hidden", timeout: PAINT_MS });
		await page.click('#lane-backlog .board-card[data-card="1"] .board-card__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(
			await page.$$eval("#card-dialog-notes [data-at]", (nodes) =>
				nodes.map((node) => node.getAttribute("data-at") ?? ""),
			),
		).not.toEqual([]);
	});

	test("returns Esc's focus to the card after a frame rebuilt its lane", async () => {
		const page = await board.reuse();
		await page.click('#lane-backlog .board-card[data-card="1"] .board-card__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		// A peer's note on another card of the same lane rebuilds the lane the open record came from:
		// the node the dialog was opened from is gone by the time Esc looks for it.
		await board.store.mutate("3", { kind: "note", text: "read by a peer" }, LEAD, clock.now() + 30_000);
		await page.locator('#lane-backlog .board-card[data-card="3"] .board-card__reason').waitFor({ timeout: PAINT_MS });
		await page.keyboard.press("Escape");
		await page.waitForSelector("#board-card-dialog", { state: "hidden", timeout: PAINT_MS });
		// The id outlives the node: focus lands on the rebuilt title button, not on the document.
		expect(await focusedId(page)).toBe("card-title-1");
	});

	test("stamps a reason line whose sentence carries an age", async () => {
		const page = await board.reuse();
		// One sentence on the board has an age inside it, so it is a sentence stamp rather than a
		// plain node: the ticker that moves the meta's age re-reads this whole line, and no frame has
		// to arrive for it to stay true.
		const stamp = await page.$eval(
			'#lane-backlog .board-card[data-card="4"] .board-card__reason [data-at]',
			(node) => ({
				at: node.getAttribute("data-at"),
				wording: node.getAttribute("data-at-title"),
				sentence: node.getAttribute("data-at-sentence"),
				text: node.textContent ?? "",
			}),
		);
		expect(stamp.wording).toBe("offered {age} — nobody took it");
		expect(stamp.sentence).toBe("1");
		expect(stamp.at).not.toBeNull();
		expect(stamp.text).toMatch(/^offered .+ — nobody took it$/);
		// And the line is that sentence once, not once plus a stale copy beside it.
		expect((await page.textContent('#lane-backlog .board-card[data-card="4"] .board-card__reason'))?.trim()).toMatch(
			/^offered .+ — nobody took it$/,
		);
	});

	test("repaints a card that stops waiting when its blocker is finished", async () => {
		const page = await board.reuse();
		const reason = () => page.textContent('#lane-backlog .board-card[data-card="1"] .board-card__reason');
		await expect(reason()).resolves.toBe("waits on #2 (execute) Wire retries into the webhook");
		// Another session finishes the blocker: its revision moves and the waiting card's own
		// record does not, so only the derived `waits` can say this frame is news.
		await advance(board.store, "2", "done", { owner: CORE }, clock.now() + 20_000);
		// The Done lane is folded at this fixture's size, so its cards are drawn and hidden.
		await page.locator('#lane-done .board-card[data-card="2"]').waitFor({ state: "attached", timeout: PAINT_MS });
		// It waits on nothing now, so the line is the card's own last note again.
		await expect(reason()).resolves.toBe(NOTE);
	});
});
