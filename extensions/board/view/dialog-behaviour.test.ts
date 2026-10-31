/**
 * The card dialog driven the way a reader drives it.
 *
 * `dialog.test.ts` holds what a reader cannot see — the ids it needs, the CSS that draws it,
 * and the one rule each half decides from. This holds what it does: a card opens from its
 * title or anywhere on it, the record says why the card sits where it does and what it
 * promised, a blocked or unsigned card says so, and the keyboard the dialog keeps.
 *
 * It is its own suite because it is its own surface: the page's suite was at its line budget,
 * and the record is a job that had grown one assertion at a time inside it. It reads one
 * fixture (`test/helpers/board-fixture.ts`) and one set of DOM reads
 * (`test/helpers/board-dom.ts`), so a change to the dialog lands in one place.
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
import { type Doc, type ElementLike, focusedClass, focusedId, hidden } from "../../../test/helpers/board-dom.ts";
import { CORE, LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import { makeClock } from "../../../test/helpers/clock.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** The board the suite reads. */
let board: BoardBrowser;
let store: BoardBrowser["store"];

/** One fresh tab on the served page, waited until its lanes have painted. */
const openPage = (): Promise<Page> => board.open();

describe.skipIf(CHROME === undefined)("the card dialog in a browser", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			// The page prints who signed, so the board names `billing-lead` as its lead.
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/dialog" },
		});
		store = board.store;
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("opens a card from its title, and Esc closes it", async () => {
		const page = await openPage();
		await page.click("#lane-execute .board-card__title");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-title")).toBe("Billing webhook accepts orders");
		expect(await page.textContent("#card-dialog-owner")).toContain("billing-core");
		expect(await page.textContent("#card-dialog-state")).toContain("Execute");

		await page.keyboard.press("Escape");
		expect(await hidden(page, "#board-card-dialog")).toBe(true);
		await page.close();
	});

	test("keeps Tab and Shift+Tab inside the card dialog", async () => {
		const page = await openPage();
		await page.click("#lane-execute .board-card__title");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });

		// The panel is the close button's container and the dialog's first focusable, so a
		// browser's own backwards step from Close had no sibling to land on and walked out
		// behind the scrim. The trap moves focus itself, in both directions.
		await page.focus("#card-dialog-close");
		await page.keyboard.press("Shift+Tab");
		expect(await focusedClass(page)).toContain("board-dialog__panel");
		expect(await hidden(page, "#board-card-dialog")).toBe(false);

		await page.keyboard.press("Tab");
		expect(await focusedId(page)).toBe("card-dialog-close");
		await page.keyboard.press("Tab");
		expect(await focusedClass(page)).toContain("board-dialog__panel");
		await page.close();
	});

	test("keeps the board's own keys out of a dialog", async () => {
		const page = await openPage();
		await page.keyboard.press("j");
		await page.keyboard.press("Enter");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		const opened = await page.textContent("#card-dialog-title");

		// The slash used to pull focus into the filter behind the scrim, leaving the dialog
		// above a field the reader was typing into.
		await page.keyboard.press("/");
		expect(await page.inputValue("#board-filter")).toBe("");
		expect(await focusedClass(page)).toContain("board-dialog__panel");

		// `t` used to switch the tab underneath an open record.
		await page.keyboard.press("t");
		expect(await hidden(page, "#panel-team")).toBe(true);

		// `?` used to stack the sheet over the card, so one Esc then closed both.
		await page.keyboard.press("?");
		expect(await hidden(page, "#keys-dialog")).toBe(true);

		// The keys that move inside it still work, and Esc still closes the record.
		await page.keyboard.press("j");
		expect(await page.textContent("#card-dialog-title")).not.toBe(opened);
		await page.keyboard.press("Escape");
		expect(await hidden(page, "#board-card-dialog")).toBe(true);
		await page.close();
	});

	test("opens a card from anywhere on it, and a drag is not a click", async () => {
		const page = await openPage();
		// The meta line is not the title, and it is inside the card: the whole card is the door.
		await page.click('#lane-backlog .board-card[data-card="1"] .board-card__meta');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-id")).toBe("#1");
		await page.keyboard.press("Escape");
		expect(await hidden(page, "#board-card-dialog")).toBe(true);

		// Selecting a line to copy ends in a click on the card; that click must not open it. A
		// button's own text is not selectable, so the drag is over the reason line, which is
		// prose and is what a reader copies.
		const line = await page.$('#lane-backlog .board-card[data-card="1"] .board-card__reason');
		const box = await line?.boundingBox();
		if (box === undefined || box === null) throw new Error("the reason line has no box to drag across");
		await page.mouse.move(box.x + 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
		await page.mouse.up();
		expect(await hidden(page, "#board-card-dialog")).toBe(true);
		await page.close();
	});

	test("reads the card in the order a reader acts on it, one fact a row", async () => {
		const page = await openPage();
		await page.click("#lane-execute .board-card__title");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-id")).toBe("#3");
		// The head keeps what the face led with — the person, the order — so nothing is lost.
		expect(await page.textContent("#card-dialog-owner")).toContain("billing-core");
		expect(await page.textContent("#card-dialog-priority")).toBe("high");
		// The page's own clock, so the shape only — and the author rides the same row.
		expect(await page.textContent("#card-dialog-updated")).toMatch(/^(\d+[mhd]|now) by billing-core$/);
		// A card with no link and no landing has no row, label included: an empty value
		// under a label reads as a missing fact instead of an absent one.
		expect(await hidden(page, "#card-dialog-landed")).toBe(true);
		expect(await hidden(page, "#card-dialog-landed-label")).toBe(true);
		expect(await hidden(page, "#card-dialog-depends")).toBe(true);
		expect(await hidden(page, "#card-dialog-depends-label")).toBe(true);

		// The plan keeps the whole path in the tooltip, so a long one cannot hide anything
		// once the row clamps it. The clamp itself is stylesheet data, held with the rest of
		// the CSS in `pages.test.ts`; whether *this* browser actually overflowed the row is
		// font metrics, which is why the runner and the laptop answered differently.
		const plan = await page.$eval(
			"#card-dialog-plan",
			(node) => (node as unknown as ElementLike).getAttribute("title") ?? "",
		);
		expect(plan).toContain("2026-10-26-1105-the-card-dialog-reads-like-the-record-it-carries.md");

		// The notes are the record, newest first — a note is why a card is opened — each
		// attributed under it, and the heading carries the count. Body size is CSS data.
		expect(await page.$$eval("#card-dialog-notes .board-dialog__note", (nodes) => nodes.length)).toBe(2);
		expect(await page.$$eval("#card-dialog-notes .board-dialog__note-foot", (nodes) => nodes.length)).toBe(2);
		expect(await page.textContent("#card-dialog-notes .board-dialog__note-text")).toBe("no retries yet");
		expect(await page.textContent("#card-dialog-note-count")).toContain("2");
		expect(await page.$$eval("#card-dialog-path-list .board-dialog__path", (nodes) => nodes.length)).toBe(2);

		// The reason the card face prints is here too, whole and in its kind's tone: what the
		// card is owed next, which is what a reader opens the record to find.
		expect(await page.textContent("#card-dialog-reason")).toBe("executing \u2014 no spot-check yet");
		expect(await page.getAttribute("#card-dialog-reason", "data-tone")).toBe("muted");
		expect(await hidden(page, "#card-dialog-reason")).toBe(false);

		// The contract is a block of its own rather than four rungs: the promise reads whole,
		// and the approval is the signature under it, in the tone the board gives a sign.
		expect(await hidden(page, "#card-dialog-contract-section")).toBe(false);
		expect(await page.textContent("#card-dialog-goal")).toBe("A webhook order is stored once");
		expect(await page.textContent("#card-dialog-acceptance")).toBe("A retried delivery leaves one order");
		expect(await page.textContent("#card-dialog-scope-out")).toBe("No refunds");
		expect(await page.textContent("#card-dialog-sign")).toMatch(/^approved by billing-lead \u00b7 \d+[a-z]$/);
		expect(await page.getAttribute("#card-dialog-sign", "data-tone")).toBe("warn");
		expect(await hidden(page, "#card-dialog-sign")).toBe(false);
		// And no row in the record carries the promise a second time.
		expect(await page.textContent("#card-dialog-record-section")).not.toContain("A webhook order is stored once");
		await page.close();
	});

	test("says what a blocked or unsigned card is waiting for, and leaves a signed one to the signature", async () => {
		// The two states the dialog used to draw nothing about: a plan card whose contract
		// nobody has approved, and one parked on a decision. It borrows a pool card and gives
		// it back in the `finally` — a released card keeps its contract, which the gates allow.
		const now = clock.now();
		await store.mutate("2", { kind: "claim" }, CORE, now);
		try {
			await store.mutate(
				"2",
				{
					kind: "contract",
					artifact: { path: "2.md" },
					goal: "Totals round once at the boundary",
					acceptance: "A test says so",
					scopeOut: "No currency work",
				},
				CORE,
				now,
			);
			const page = await openPage();
			await page.click('#lane-plan .board-card[data-card="2"] .board-card__title');
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
			// The face's sentence, in warn: a person has to read the wording before this moves.
			expect(await page.textContent("#card-dialog-reason")).toBe("contract ready \u2014 needs approval");
			expect(await page.getAttribute("#card-dialog-reason", "data-tone")).toBe("warn");
			// The promise is drawn whether or not it is signed; the missing signature line is the
			// answer to whether anybody has read it.
			expect(await hidden(page, "#card-dialog-contract-section")).toBe(false);
			expect(await page.textContent("#card-dialog-scope-out")).toBe("No currency work");
			expect(await hidden(page, "#card-dialog-sign")).toBe(true);

			// Once the lead has read the wording, the sentence the reason line would print is the
			// signature under the contract, so the line steps aside: one fact, said once.
			await store.mutate("2", { kind: "approve" }, LEAD, now);
			await page.waitForSelector("#card-dialog-sign:not([hidden])", { timeout: PAINT_MS });
			expect(await page.textContent("#card-dialog-sign")).toMatch(/^approved by billing-lead \u00b7 \d+[a-z]$/);
			expect(await hidden(page, "#card-dialog-reason")).toBe(true);

			// Parked on a decision, the line is the block's own sentence, in the refusal's tone.
			await store.mutate(
				"2",
				{ kind: "move", lane: "blocked", blocker: "decision", blockedBy: "waiting on the gateway owner" },
				CORE,
				now,
			);
			await page.waitForFunction(
				() =>
					((globalThis as unknown as { document: Doc }).document.getElementById("card-dialog-reason")?.textContent ??
						"") === "waiting on the gateway owner",
				undefined,
				{ timeout: PAINT_MS },
			);
			expect(await page.getAttribute("#card-dialog-reason", "data-tone")).toBe("danger");
			await page.close();
		} finally {
			await store.mutate("2", { kind: "move", lane: "plan" }, CORE, now);
			await store.mutate("2", { kind: "release" }, CORE, now);
		}
	});

	test("says nobody took an offer, in the queue's words", async () => {
		// An offer is a bus event that leaves one field behind, and the dialog says it the way
		// the face and the lead's queue do, from one body.
		const now = clock.now();
		await store.mutate("1", { kind: "offer" }, LEAD, now - 45_000);
		try {
			const page = await openPage();
			await page.click('#lane-backlog .board-card[data-card="1"] .board-card__title');
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
			expect(await page.textContent("#card-dialog-reason")).toMatch(/^offered \d+[a-z] ago \u2014 nobody took it$/);
			expect(await page.getAttribute("#card-dialog-reason", "data-tone")).toBe("muted");
			// A pool card holds no promise yet, so the contract takes its heading with it.
			expect(await hidden(page, "#card-dialog-contract-section")).toBe(true);
			await page.keyboard.press("Escape");
			await page.close();
		} finally {
			// A claim answers the offer; the release then leaves the card as the fixture had it.
			await store.mutate("1", { kind: "claim" }, LEAD, now);
			await store.mutate("1", { kind: "release" }, LEAD, now);
		}
	});

	test("dates a landing beside the commit it landed as", async () => {
		const page = await openPage();
		await page.click("#lane-head-done");
		await page.waitForSelector('#lane-done .board-card[data-card="4"]', { timeout: PAINT_MS });
		await page.click('#lane-done .board-card[data-card="4"] .board-card__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-landed")).toMatch(/^4af1b4a \u00b7 \d+[a-z]$/);
		expect(await page.getAttribute("#card-dialog-landed", "title")).toBe("4af1b4a");
		// The reason line's `✓ done by billing-core · landed 4af1b4a` is that rung and the head's
		// own owner chip, so it steps aside; a finished card that landed no commit has no rung and
		// keeps the line, because nothing below says who finished it.
		expect(await hidden(page, "#card-dialog-reason")).toBe(true);

		await page.keyboard.press("Escape");
		await page.click('#lane-done .board-card[data-card="5"] .board-card__title');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await hidden(page, "#card-dialog-landed")).toBe(true);
		expect(await page.textContent("#card-dialog-reason")).toBe("\u2713 done by billing-core");
		expect(await hidden(page, "#card-dialog-reason")).toBe(false);
		await page.close();
	});

	test("says how long the card has held its lane, in the head", async () => {
		// The age belongs beside the lane word: the lane's own name cannot say how long, and
		// the updated stamp cannot either — a note moves that stamp without moving the card.
		const page = await openPage();
		await page.click('#lane-execute .board-card__title:text-is("Billing webhook accepts orders")');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-state")).toMatch(/^Execute · (\d+[mhd]|now)$/);
		expect(await page.$("#card-dialog-lane")).toBeNull();
		// A card nobody has taken says the same about the lane it was born in.
		await page.keyboard.press("Escape");
		await page.click('#lane-backlog .board-card__title:text-is("Export orders as CSV")');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-state")).toMatch(/^Backlog · (\d+[mhd]|now)$/);
		await page.close();
	});

	test("shows a card's own cost: the cards waiting on it", async () => {
		// A link is stored on the waiting card alone, so the blocker's dialog can only say
		// this by being handed the answer the graph computed.
		const now = clock.now();
		await store.mutate(
			"2",
			{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: ["1"] },
			LEAD,
			now,
		);
		try {
			const page = await openPage();
			// The face says it too, on the reason's own line, naming the card rather than its id.
			expect(await page.textContent('#lane-backlog .board-card[data-card="1"] .board-card__reason')).toContain(
				"· holds up #2 (backlog) Invoice totals round the wrong way",
			);
			expect(await page.textContent('#lane-backlog .board-card[data-card="2"] .board-card__reason')).toBe(
				"waits on #1 (backlog) Export orders as CSV",
			);

			await page.click('#lane-backlog .board-card__title:text-is("Export orders as CSV")');
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
			expect(await page.textContent("#card-dialog-dependents")).toBe("#2 (backlog) Invoice totals round the wrong way");
			expect(await hidden(page, "#card-dialog-dependents-label")).toBe(false);
			// The same card waits on nothing, so that row is absent rather than empty.
			expect(await hidden(page, "#card-dialog-depends")).toBe(true);
			await page.keyboard.press("Escape");

			// The dependent's own dialog says the other direction, from the same link.
			await page.click('#lane-backlog .board-card__title:text-is("Invoice totals round the wrong way")');
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
			expect(await page.textContent("#card-dialog-depends")).toBe("#1 (backlog) Export orders as CSV");
			expect(await hidden(page, "#card-dialog-dependents")).toBe(true);
			await page.close();
		} finally {
			await store.mutate(
				"2",
				{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: [] },
				LEAD,
				now,
			);
		}
	});

	test("walks to the next card with j, and says where it landed", async () => {
		const page = await openPage();
		await page.click("#lane-backlog .board-card__title");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		// Three, not ten: the seven finished cards sit in the folded Done lane, and the
		// step walks the board as it is drawn.
		const first = await page.textContent("#card-dialog-where");
		expect(first).toMatch(/^card 1 of 3: /);
		const opened = await page.textContent("#card-dialog-title");
		expect(first).toBe(`card 1 of 3: ${opened}`);

		await page.keyboard.press("j");
		const second = await page.textContent("#card-dialog-where");
		expect(second).toMatch(/^card 2 of 3: /);
		expect(await page.textContent("#card-dialog-title")).not.toBe(opened);
		// The dialog is still open: a step moves the record, it does not close it.
		expect(await hidden(page, "#board-card-dialog")).toBe(false);

		await page.keyboard.press("j");
		expect(await page.textContent("#card-dialog-where")).toMatch(/^card 3 of 3: /);
		// It wraps, and k walks back the way it came.
		await page.keyboard.press("j");
		expect(await page.textContent("#card-dialog-where")).toBe(first);
		await page.keyboard.press("k");
		expect(await page.textContent("#card-dialog-where")).toMatch(/^card 3 of 3: /);
		await page.keyboard.press("Escape");
		expect(await hidden(page, "#board-card-dialog")).toBe(true);
		await page.close();
	});
});
