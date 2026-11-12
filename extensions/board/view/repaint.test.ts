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
import type { Page } from "playwright-core";
import type { Actor } from "../../../lib/board/rules.ts";
import type { BoardStore } from "../../../lib/board/store.ts";
import { type Doc, type ElementLike, focusedId } from "../../../test/helpers/board-dom.ts";
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

/** The ids wearing the change mark, in the order the page draws them. */
async function changed(page: Page): Promise<string[]> {
	return page.$$eval("[data-changed]", (nodes) =>
		Array.from(nodes as ArrayLike<ElementLike>, (node) => node.getAttribute("data-card") ?? ""),
	);
}

/**
 * Wait until exactly these cards wear the mark.
 *
 * The window is one and a half seconds against a per-frame poll, so the wait is on the
 * attribute rather than on a sleep: a mark that never arrived and a mark already cleared
 * are the same picture by the time a fixed wait is over.
 */
async function marks(page: Page, ids: readonly string[]): Promise<void> {
	await page.waitForFunction(
		(expected) => {
			const nodes = (globalThis as unknown as { document: Doc }).document.querySelectorAll("[data-changed]");
			return (
				nodes.length === expected.length &&
				Array.from(nodes).every((node, at) => node.getAttribute("data-card") === expected[at])
			);
		},
		ids,
		{ timeout: PAINT_MS },
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
		const page = await board.reuse();
		// The other half of a link is the reason line's, after a middot: one row for one edge.
		const holds = () => page.textContent('#lane-execute .board-row[data-card="2"] .bf-row__reason');
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
		await page.locator('#lane-backlog .board-row[data-card="3"] .bf-row__reason').waitFor({ timeout: PAINT_MS });
		await expect(holds()).resolves.toContain(
			"holds up #1 (backlog) Export orders as CSV, #3 (backlog) Invoice totals round the wrong way",
		);
	});

	test("stamps every age in an open record, so the record's clock moves", async () => {
		const page = await board.reuse();
		// The record is filled once per frame, and a frame arrives only when a card moves — so an
		// age written as text froze where its last frame caught it, while the face behind it ticked.
		await page.click('#lane-execute .board-row[data-card="2"] .bf-row__title');
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
		await page.click('#lane-backlog .board-row[data-card="1"] .bf-row__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(
			await page.$$eval("#card-dialog-notes [data-at]", (nodes) =>
				nodes.map((node) => node.getAttribute("data-at") ?? ""),
			),
		).not.toEqual([]);
	});

	test("returns Esc's focus to the card after a frame rebuilt its lane", async () => {
		const page = await board.reuse();
		await page.click('#lane-backlog .board-row[data-card="1"] .bf-row__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		// A peer's note on another card of the same lane rebuilds the lane the open record came from:
		// the node the dialog was opened from is gone by the time Esc looks for it.
		await board.store.mutate("3", { kind: "note", text: "read by a peer" }, LEAD, clock.now() + 30_000);
		await page.locator('#lane-backlog .board-row[data-card="3"] .bf-row__reason').waitFor({ timeout: PAINT_MS });
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
		const stamp = await page.$eval('#lane-backlog .board-row[data-card="4"] .bf-row__reason [data-at]', (node) => ({
			at: node.getAttribute("data-at"),
			wording: node.getAttribute("data-at-title"),
			sentence: node.getAttribute("data-at-sentence"),
			text: node.textContent ?? "",
		}));
		expect(stamp.wording).toBe("offered {age} — nobody took it");
		expect(stamp.sentence).toBe("1");
		expect(stamp.at).not.toBeNull();
		expect(stamp.text).toMatch(/^offered .+ — nobody took it$/);
		// And the line is that sentence once, not once plus a stale copy beside it.
		expect((await page.textContent('#lane-backlog .board-row[data-card="4"] .bf-row__reason'))?.trim()).toMatch(
			/^offered .+ — nobody took it$/,
		);
	});

	test("repaints a card that stops waiting when its blocker is finished", async () => {
		const page = await board.reuse();
		const reason = () => page.textContent('#lane-backlog .board-row[data-card="1"] .bf-row__reason');
		await expect(reason()).resolves.toBe("waits on #2 (execute) Wire retries into the webhook");
		// Another session finishes the blocker: its revision moves and the waiting card's own
		// record does not, so only the derived `waits` can say this frame is news.
		await advance(board.store, "2", "done", { owner: CORE }, clock.now() + 20_000);
		// The Done lane is folded at this fixture's size, so its cards are drawn and hidden.
		await page.locator('#lane-done .board-row[data-card="2"]').waitFor({ state: "attached", timeout: PAINT_MS });
		// It waits on nothing now, so the line is the card's own last note again.
		await expect(reason()).resolves.toBe(NOTE);
	});

	test("marks the card that moved and the one that just arrived, and then lets the mark go", async () => {
		const page = await board.reuse();
		// A first frame is the whole board to somebody who just opened it, and marks nothing:
		// every card wearing the mark would say no more than the board itself does.
		expect(await changed(page)).toEqual([]);
		await board.store.mutate("3", { kind: "note", text: "read by a peer" }, LEAD, clock.now() + 10_000);
		await marks(page, ["3"]);
		// A card that has just arrived is news in the same way, and the one that moved before it
		// keeps the revision it had — so the mark is the card the frame is about, not the pile.
		await board.store.create({ title: "Settle refunds nightly", paths: [] }, LEAD, clock.now() + 11_000);
		await marks(page, ["5"]);
		// The window is a breath, not a state: the board goes quiet and the mark leaves with it.
		await marks(page, []);
	});

	test("marks a moved card with a ring the note's paper cannot swallow", async () => {
		const page = await board.reuse();
		// Execute's own paper is the accent's soft tone, so a fill would have painted this card the
		// colour it already is and the mark would have said nothing. The mark is a ring for that
		// reason, and this case reads the computed style rather than the attribute: a rule that
		// loses to the paper at equal specificity — whatever order the two land in — fails here.
		const card = '#lane-execute .board-row[data-card="%s"]';
		// A card of this case's own, walked to Execute: the seeded blocker has been finished by an
		// earlier case, and the lane the mark has to survive on is the one whose paper is the accent.
		const executing = await board.store.create(
			{ title: "Settle refunds nightly", paths: [] },
			CORE,
			clock.now() + 39_000,
		);
		await advance(board.store, executing.id, "execute", { owner: CORE }, clock.now() + 39_500);
		const selector = card.replace("%s", executing.id);
		await page.locator(selector).waitFor({ timeout: PAINT_MS });
		// The card arrived a moment ago, so it is news itself: wait for its ring to go, so what this
		// case reads is the card at rest rather than the mark it was born with.
		await page.waitForFunction(
			(selector) => {
				const node = (globalThis as unknown as { document: Doc }).document.querySelector(selector);
				if (node === null) return false;
				const style = (
					globalThis as unknown as { getComputedStyle(node: ElementLike): { outlineStyle: string } }
				).getComputedStyle(node);
				return style.outlineStyle === "none";
			},
			selector,
			{ timeout: PAINT_MS },
		);
		const read = (selector: string) =>
			page.$eval(selector, (node) => {
				const style = (
					globalThis as unknown as {
						getComputedStyle(node: ElementLike): {
							backgroundColor: string;
							outlineColor: string;
							outlineStyle: string;
							outlineWidth: string;
							outlineOffset: string;
						};
					}
				).getComputedStyle(node);
				return {
					background: style.backgroundColor,
					outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
					outlineColor: style.outlineColor,
					offset: style.outlineOffset,
				};
			});
		const resting = await read(selector);
		// The note is the holder's: a card in a lane with an owner refuses anyone else's, and this card
		// was walked to Execute by billing-core.
		await board.store.mutate(executing.id, { kind: "note", text: "read by a peer" }, CORE, clock.now() + 40_000);
		// This card's own attribute, not the set: the frame that carries the note may still be the one
		// that carried the card's arrival, and the mark is about this card either way.
		await page.waitForFunction(
			(selector) => {
				const node = (globalThis as unknown as { document: Doc }).document.querySelector(selector);
				return node !== null && node.getAttribute("data-changed") === "true";
			},
			selector,
			{ timeout: PAINT_MS },
		);
		const marked = await read(selector);
		// The paper is the lane's, before and after: the mark does not repaint the identity of the
		// card it marks, which is also what keeps it visible on the lane whose paper is its colour.
		expect(marked.background).toBe(resting.background);
		expect(marked.outline).toBe("2px solid " + marked.outlineColor);
		expect(marked.outlineColor).not.toBe(marked.background);
		expect(marked.offset).toBe("-2px");
		// And the state leaves no ring behind once the window closes.
		await page.waitForFunction(
			(selector) => {
				const node = (globalThis as unknown as { document: Doc }).document.querySelector(selector);
				return node !== null && node.getAttribute("data-changed") === null;
			},
			selector,
			{ timeout: PAINT_MS },
		);
		expect((await read(selector)).outline).toBe(resting.outline);
	});

	test("keeps the reader's card when a frame rebuilds its lane", async () => {
		const page = await board.reuse();
		// j walks the drawn cards and reads the focused one, so a frame that took the focus
		// would restart the walk at the first card rather than moving on from this one.
		await page.keyboard.press("j");
		expect(await focusedId(page)).toBe("card-title-1");
		await board.store.mutate("3", { kind: "note", text: "read by a peer" }, LEAD, clock.now() + 10_000);
		await page.locator('#lane-backlog .board-row[data-card="3"] .bf-row__reason').waitFor({ timeout: PAINT_MS });
		// The lane was rebuilt whole, and the id outlived the node it named.
		expect(await focusedId(page)).toBe("card-title-1");
		await page.keyboard.press("j");
		expect(await focusedId(page)).toBe("card-title-3");
	});
});
