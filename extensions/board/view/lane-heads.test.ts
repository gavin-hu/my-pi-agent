/**
 * The lane head on the pane's edge.
 *
 * The board has one scroll box — the shell's main pane (`styles.ts`, and the same rule the team
 * tab states) — so a lane head pins inside its own column. A sticky box can only travel within
 * its containing block, and a lane's box is as tall as its own rows: a lane of two cards gave its
 * head 283px of travel and then carried it off the top of the screen, leaving a lane name the
 * reader had to scroll back for. The row stretches instead, so every lane is as tall as the
 * board and every head rides the pane's edge for the whole scroll.
 *
 * The stylesheet half runs anywhere; the two behavioural cases need a browser and skip without
 * one, naming `PI_CHROME`, like the suites beside them.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { type BoardBrowser, BOARD_CHROME as CHROME, openBoardBrowser } from "../../../test/helpers/board-browser.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { BOARD_CSS } from "./styles.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** How many extra cards the tall lane holds — enough to stand well past the window's height. */
const TALL_LANE = 20;

/**
 * The boxes this suite measures, and the pane's own scroll.
 *
 * A predicate is serialized into the page and this project's TypeScript has no DOM lib, so the
 * sliver it reaches is declared here rather than imported from one.
 */
interface Boxed {
	querySelector(selector: string): Boxed | null;
	getBoundingClientRect(): { top: number; height: number };
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	getAttribute(name: string): string | null;
}

/** What the page says about its lanes at one scroll offset. */
interface Lanes {
	/** The pane's top edge, which is what a pinned head is measured against. */
	paneTop: number;
	/** How far the pane has scrolled, and how far it can. */
	scrolled: number;
	scrollable: number;
	lanes: Array<{ lane: string; height: number; headTop: number; listOverflow: number }>;
	/** The head's own paint, so a card passing under it cannot be seen through it. */
	headFill: string;
}

/** The board as the page draws it, after scrolling the pane to `fraction` of its end. */
async function readLanes(page: Page, fraction: number): Promise<Lanes> {
	return page.evaluate((part) => {
		const dom = globalThis as unknown as {
			document: { querySelector(selector: string): Boxed | null; querySelectorAll(selector: string): ArrayLike<Boxed> };
			getComputedStyle(node: Boxed): { backgroundColor: string; overflowY: string };
		};
		const pane = dom.document.querySelector(".bf-app__main");
		if (pane === null) throw new Error("no pane");
		pane.scrollTop = Math.round((pane.scrollHeight - pane.clientHeight) * part);
		const lanes = Array.from(dom.document.querySelectorAll(".bf-lane.board-lane")).map((lane) => {
			const head = lane.querySelector(".bf-lane__head");
			const list = lane.querySelector(".bf-lane__list");
			return {
				lane: lane.getAttribute("data-lane") ?? "",
				height: Math.round(lane.getBoundingClientRect().height),
				headTop: Math.round((head?.getBoundingClientRect().top ?? 0) * 100) / 100,
				listOverflow: list === null ? 0 : list.scrollHeight - list.clientHeight,
			};
		});
		const head = dom.document.querySelector(".bf-lane.board-lane .bf-lane__head") as Boxed | null;
		return {
			paneTop: Math.round(pane.getBoundingClientRect().top),
			scrolled: Math.round(pane.scrollTop),
			scrollable: Math.round(pane.scrollHeight - pane.clientHeight),
			lanes,
			headFill: head === null ? "" : dom.getComputedStyle(head).backgroundColor,
		};
	}, fraction);
}

let board: BoardBrowser;

describe("the lane head on the board page", () => {
	test("stretches the lanes row, so a lane is as tall as the board", () => {
		// The row starts its items and each lane is its own content's height: that is the whole
		// cause, so the rule that follows from it is held as a string as well as rendered.
		expect(BOARD_CSS).toContain(".board-lanes{display:flex;flex-wrap:nowrap;gap:var(--space-4);align-items:stretch}");
		expect(BOARD_CSS).toContain(".board-lane .bf-lane__head{position:sticky;top:0");
	});
});

describe.skipIf(CHROME === undefined)("the lane head on the served page", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: async (store, now) => {
				await seedWorkingBoard(store, now);
				// One lane far taller than the window, which is the board this rule is for: a lane
				// holding two cards says nothing about a head that has to travel.
				for (let index = 1; index <= TALL_LANE; index++) {
					await store.create(
						{ title: `Pooled change ${index}`, paths: ["extensions/board/view/styles.ts"] },
						LEAD,
						now - index * 60_000,
					);
				}
			},
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/lane-heads" },
		});
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("rides the pane's edge while a long lane scrolls past it", async () => {
		const page = await board.reuse();
		const top = await readLanes(page, 0);
		// The fixture has to be the board this case is about, or it proves nothing.
		expect(top.scrollable).toBeGreaterThan(500);
		const tallest = Math.max(...top.lanes.map((lane) => lane.height));
		expect(tallest).toBeGreaterThan(top.scrollable);

		const end = await readLanes(page, 1);
		expect(end.scrolled).toBe(end.scrollable);
		// Every head, including the four quiet lanes' — a lane of two cards used to be 1 267px
		// above the top of the screen at this offset.
		expect(end.lanes.map((lane) => lane.headTop)).toEqual(end.lanes.map(() => end.paneTop));
		expect(end.lanes.map((lane) => lane.lane)).toEqual(["backlog", "plan", "execute", "blocked", "done"]);
	});

	test("gives no lane a scroll box of its own, and paints the head over what passes under it", async () => {
		const page = await board.reuse();
		const read = await readLanes(page, 0.5);
		// One scroll box is the board's stated rule, so the fix must not be five scrollbars: every
		// lane is as tall as the board and its list has nothing left to scroll.
		expect(read.lanes.map((lane) => lane.listOverflow)).toEqual(read.lanes.map(() => 0));
		expect(new Set(read.lanes.map((lane) => lane.height)).size).toBe(1);
		// A pinned head is only a landmark if the row travelling beneath it is hidden: a
		// transparent head would leave a card's text over the lane's name.
		expect(read.headFill).not.toBe("transparent");
		expect(read.headFill).not.toMatch(/rgba\(\d+, \d+, \d+, 0?\.\d+\)/);
	});
});
