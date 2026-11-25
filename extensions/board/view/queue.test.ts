/**
 * The Needs you column as one list of the seat's own moves, over the four lanes that hold open
 * cards, measured in the browser.
 *
 * What this suite pins is the rule the redesign is: a row exists only for a move nobody else can
 * finish, so the column can never count another person's obligation, and every open card is drawn
 * exactly once — the defect it replaces drew ten cards fourteen times and read `14` over a board
 * whose seat owed nothing. Both sides of every comparison come off the page or the store, so a
 * case cannot pass while the layout drifts under a number written here. It needs a browser; where
 * the machine has none the suite skips, naming PI_CHROME.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import type { Actor } from "../../../lib/workflow/rules.ts";
import type { Card } from "../../../lib/workflow/card.ts";
import type { ElementLike } from "../../../test/helpers/board-dom.ts";
import { UNWRITTEN_MS } from "../../../lib/workflow/round.ts";
import type { RosterSession } from "../../../lib/session-roster.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	drawn,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { waitFor } from "../../../test/helpers/process.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** How long a suite's hooks may take: two boots, and a teardown that closes each browser. */
const HOOK_MS = 30_000;

/** A node with the children these cases query; the DOM lib is not this project's. */
interface Node extends ElementLike {
	querySelector(selector: string): Node | null;
	querySelectorAll(selector: string): ArrayLike<Node>;
}

/** The sliver of the document a case reads, typed the way the page's helpers type it. */
interface TeamDoc {
	querySelector(selector: string): Node | null;
	querySelectorAll(selector: string): ArrayLike<Node>;
	getElementById(id: string): Node | null;
}

/** The four lanes the column carries, in the order it reads them. */
const LANES = ["blocked", "execute", "plan", "backlog"];

/**
 * The bus's records, so the fixture's orphan is the ask it means to be.
 *
 * `ops-gone` is the label the fixture leaves holding a card, and a pid above every host's range is
 * what makes a record gone; without a roster the page cannot know, and the card is only a plan.
 */
const roster = (now: number): RosterSession[] => [
	{ id: "s-lead", label: LEAD.label, mode: "tui", lastSeen: now, mail: 0 },
	{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: now, mail: 0 },
	{ id: "s-gone", label: "ops-gone", mode: "tui", lastSeen: now - 5_000, pid: 999_999_998, mail: 0 },
];

/** What the column drew: its caption, its list, the lanes, and the label over them. */
interface Column {
	caption: string;
	asks: number;
	fold: string;
	lanes: Array<{ key: string; count: number; cards: number; note: string }>;
	label: string;
	empty: string;
}

const column = (page: Page): Promise<Column> =>
	page.evaluate(() => {
		const document = (globalThis as unknown as { document: TeamDoc }).document;
		const root = document.querySelector('#board-team [data-column="active"]');
		if (root === null) throw new Error("the middle column is not on the page");
		const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
		const lanes = Array.from(root.querySelectorAll(".board-team__lanes > [data-lane]")).map((lane) => ({
			key: lane.getAttribute("data-lane") ?? "",
			count: Number(lane.querySelector(".bf-lane__count")?.textContent ?? "0"),
			cards: lane.querySelectorAll(".board-row").length,
			note: lane.querySelector(".board-fold")?.textContent ?? "",
		}));
		return {
			caption: text('#board-team [data-column="active"] > .bf-section__cap'),
			asks: root.querySelectorAll("#team-asks .board-queue__row").length,
			fold: text('#board-team [data-fold="needs-you"]'),
			lanes,
			label: text("#board-team .board-team__board"),
			empty: text("#board-team .board-queue > .board-team__empty"),
		};
	});

/** Every `data-card` the middle column drew, in document order: the lanes, not the ask rows. */
const drawnCards = (page: Page): Promise<string[]> =>
	page.evaluate(() => {
		const document = (globalThis as unknown as { document: TeamDoc }).document;
		return Array.from(
			document.querySelectorAll('#board-team [data-column="active"] [data-card]'),
			(node) => node.getAttribute("data-card") ?? "",
		);
	});

let board: BoardBrowser;

describe.skipIf(CHROME === undefined)("the Needs you column", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({ lead: LEAD.label, now: clock.now, roster, seed: seedWorkingBoard });
	}, HOOK_MS);

	afterAll(async () => {
		await board?.close();
	}, HOOK_MS);

	test("draws each open card once, under one caption and one list", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#team-asks .board-queue__row", { timeout: PAINT_MS });
		await drawn(page);
		const cards = await board.store.list();
		const open = cards
			.filter((card) => card.lane !== "done")
			.map((card) => String(card.id))
			.sort();
		const drew = (await drawnCards(page)).sort();
		// The invariant the redesign is: a card is drawn once on this tab — the ask row above it is
		// a line about the card (`data-ask`), not a second drawing of it, and that is the difference
		// the old queue erased when ten cards were drawn fourteen times.
		expect(new Set(drew).size).toBe(drew.length);
		expect(drew).toEqual(open);
		const asked = await page.evaluate(() => {
			const document = (globalThis as unknown as { document: TeamDoc }).document;
			return Array.from(
				document.querySelectorAll("#team-asks .board-queue__row"),
				(row) => row.getAttribute("data-ask") ?? "",
			);
		});
		expect(new Set(asked).size).toBe(asked.length);
		expect(asked.length).toBeGreaterThan(0);
		const seen = await column(page);
		// One caption, and one list under it: the bands are gone, so no second head sits inside.
		expect(seen.caption).toContain("Needs you");
		expect(seen.caption).not.toContain("Unclaimed");
		expect(seen.caption).not.toContain("Stalled");
		expect(seen.lanes.map((lane) => lane.key)).toEqual(LANES);
		expect(seen.asks).toBeGreaterThan(0);
		// The caption's count is what the column asks, and the label over the lanes is their sum:
		// both numbers can be read off the page against the rows they count.
		const sum = seen.lanes.reduce((total, lane) => total + lane.count, 0);
		expect(seen.label).toBe("The board \u00b7 " + sum + " open");
	});

	test("files only the moves the seat can finish, and says each in a pill", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#team-asks .board-queue__row", { timeout: PAINT_MS });
		const filed = await page.$$eval("#team-asks .board-queue__row", (nodes) =>
			Array.from(nodes as ArrayLike<Node>, (row) => ({
				card: row.getAttribute("data-card") ?? "",
				tone: row.getAttribute("data-tone") ?? "",
				pill: row.querySelector(".bf-tag")?.textContent ?? "",
			})),
		);
		// The fixture's two asks: a complete contract nobody has read, and a card left in a session
		// no record answers to. Neither is another person's work, which is the whole membership rule.
		expect(filed.map((row) => row.pill).sort()).toEqual(["needs approval", "owner gone"]);
		expect(filed.map((row) => row.tone).sort()).toEqual(["danger", "warn"]);
		// A card being worked, a plan with no contract, and the pool under it are the lanes' facts,
		// and the queue does not restate one of them.
		const said = await page.$$eval("#team-asks .board-queue__why", (nodes) =>
			Array.from(nodes as ArrayLike<Node>, (node) => node.textContent ?? ""),
		);
		for (const sentence of ["nobody holds it", "no contract yet", "no spot-check yet", "waits on"]) {
			expect(
				said.some((text) => text.includes(sentence)),
				sentence,
			).toBe(false);
		}
	});

	test("asks for a silent execution, and not for one being written to", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#team-asks .board-queue__row", { timeout: PAINT_MS });
		// The fixture's executing card was written to a moment ago, so the seat owes it nothing.
		const fresh = await page.$$eval("#team-asks .board-queue__row", (nodes) =>
			Array.from(nodes as ArrayLike<ElementLike>, (row) => row.getAttribute("data-card") ?? ""),
		);
		expect(fresh).not.toContain("3");
		// A card whose holder has not written for longer than the window is the one ask the page
		// judges for itself, and it names the value it judged with.
		const quiet = await silentExecution();
		await waitFor(async () => (await drawnCards(page)).includes(String(quiet.id)), PAINT_MS);
		const row = await page.evaluate((id: string) => {
			const document = (globalThis as unknown as { document: TeamDoc }).document;
			const node = document.querySelector('#team-asks .board-queue__row[data-ask="' + id + '"]');
			return {
				pill: node?.querySelector(".bf-tag")?.textContent ?? "",
				said: node?.querySelector(".board-queue__why")?.textContent ?? "",
				stamp: node?.querySelector(".board-stamp")?.textContent ?? "",
				tone: node?.getAttribute("data-tone") ?? "",
			};
		}, String(quiet.id));
		// The sentence is the page's, so its age is read against the reader's clock; what a case can
		// hold is the shape the wording promises and the value the decision keyed on.
		expect(row.pill).toBe("no writes");
		expect(row.said).toMatch(/^last write \d+[a-z]+( \d+[a-z]+)? ago$/);
		expect(row.tone).toBe("dim");
		// The sentence carries the age, so the row keeps no second copy of it.
		expect(row.stamp).toBe("");
		expect(quiet.at).toBeLessThan(clock.now() - UNWRITTEN_MS);
	});

	test("keeps a pool past its limit to one line, and still reaches a card by filter", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector('#board-team [data-lane="backlog"]', { timeout: PAINT_MS });
		// The fixture's pool is small enough to draw, so a card of it is on the page.
		const small = await column(page);
		const pool = small.lanes.find((lane) => lane.key === "backlog");
		expect(pool?.cards).toBeGreaterThan(0);
		// Past the limit the lane is its head, its count and a door: four arbitrary cards out of two
		// hundred are noise dressed as information.
		const titles: string[] = [];
		for (let index = 0; index < 11; index++) {
			const card = await board.store.create(
				{ title: "Pool card " + index, paths: ["src/pool"] },
				LEAD,
				clock.now() + index,
			);
			titles.push(card.title);
		}
		await waitFor(async () => (await column(page)).lanes.find((lane) => lane.key === "backlog")?.cards === 0, PAINT_MS);
		const big = (await column(page)).lanes.find((lane) => lane.key === "backlog");
		expect(big?.count).toBe(13);
		expect(big?.note).toBe("13 cards in the pool \u2014 see them on the Board");
		// The filter is a question about a card, so a narrowed pool draws its matches instead.
		await page.fill("#board-filter", titles[0] ?? "");
		await waitFor(async () => (await column(page)).lanes.find((lane) => lane.key === "backlog")?.cards === 1, PAINT_MS);
		await page.fill("#board-filter", "");
		await drawn(page);
	});

	test("folds the list at five rows, and says how many are behind the control", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#team-asks .board-queue__row", { timeout: PAINT_MS });
		// Counted before the writes: the board is the suite's, and an earlier case may have left an
		// ask of its own.
		const opened = (await column(page)).fold;
		const before = opened === "" ? (await column(page)).asks : 0;
		expect(opened).toBe("");
		for (let index = 0; index < 6; index++) await unreadContract(index);
		const behind = before + 6 - 5;
		await waitFor(async () => (await column(page)).fold === "Show " + behind + " more", PAINT_MS);
		const closed = await column(page);
		expect(closed.asks).toBe(5);
		await page.click('#board-team [data-fold="needs-you"]');
		await waitFor(async () => (await column(page)).asks === before + 6, PAINT_MS);
		expect((await column(page)).fold).toBe("Show fewer");
		await page.click('#board-team [data-fold="needs-you"]');
		await waitFor(async () => (await column(page)).asks === 5, PAINT_MS);
	});

	test("says a column with nothing to sign in one sentence", async () => {
		const quiet = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: async (store, now) => {
				// A board with work on it and nothing the seat owes: a pool nobody has looked at, and a
				// plan card whose contract is still being written. Neither is an ask, which is the
				// state the column has to say in one sentence rather than two empty heads.
				await store.create({ title: "Pool card one", paths: ["src/pool"] }, LEAD, now);
				await store.create({ title: "Pool card two", paths: ["src/pool"] }, LEAD, now);
				const card = await store.create({ title: "Fresh plan", paths: ["src/plan"] }, LEAD, now);
				const claimed = await store.mutate(card.id, { kind: "claim" }, { id: "s-core", label: "billing-core" }, now);
				if (!claimed.ok) throw new Error(claimed.error);
			},
		});
		try {
			const page = await quiet.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-team__board", { timeout: PAINT_MS });
			await drawn(page);
			const seen = await column(page);
			expect(seen.asks).toBe(0);
			expect(seen.empty).toBe("nothing to sign");
			// The lanes still draw, and an empty lane that has a neighbour keeps only its count.
			expect(seen.lanes.map((lane) => lane.key)).toEqual(LANES);
			expect(seen.lanes.filter((lane) => lane.cards === 0).length).toBeGreaterThan(0);
		} finally {
			await quiet.close();
		}
	});
});

/** One complete contract nobody has read, drawn as an ask the seat can sign now. */
async function unreadContract(index: number): Promise<void> {
	const owner: Actor = { id: "s-unread-" + index, label: "unread-" + index };
	const record = "~/.pi/agent/plans/8872d3adda0e/unread-" + index + ".md";
	const card = await board.store.create(
		{ title: "Unread contract " + index, paths: ["src/unread"] },
		LEAD,
		clock.now() + index,
	);
	const claim = await board.store.mutate(card.id, { kind: "claim" }, owner, clock.now() + index);
	if (!claim.ok) throw new Error(claim.error);
	const contract = await board.store.mutate(
		card.id,
		{
			kind: "contract",
			artifact: { record },
			goal: "The feature does what the card says",
			acceptance: "A reader can tell it is done",
			scopeOut: "Everything the card does not name",
			verify: "bun run check",
		},
		owner,
		clock.now() + index,
	);
	if (!contract.ok) throw new Error(contract.error);
}

/** An execution nobody has written to for longer than the window: the ask the page judges itself. */
async function silentExecution(): Promise<{ id: string; at: number }> {
	const owner: Actor = { id: "s-silent", label: "silent-holder" };
	const record = "~/.pi/agent/plans/8872d3adda0e/silent.md";
	const at = clock.now() - UNWRITTEN_MS - 6 * 60_000;
	const card: Card = await board.store.create({ title: "Quiet execution", paths: ["src/quiet"] }, LEAD, at);
	const steps: Array<Parameters<BoardBrowser["store"]["mutate"]>[1]> = [
		{ kind: "claim" },
		{
			kind: "contract",
			artifact: { record },
			goal: "The feature does what the card says",
			acceptance: "A reader can tell it is done",
			scopeOut: "Everything the card does not name",
			verify: "bun run check",
		},
	];
	for (const [index, op] of steps.entries()) {
		const done = await board.store.mutate(card.id, op, owner, at + index * 1_000);
		if (!done.ok) throw new Error(done.error);
	}
	const approved = await board.store.mutate(card.id, { kind: "approve", artifact: { record } }, LEAD, at + 3_000);
	if (!approved.ok) throw new Error(approved.error);
	const moved = await board.store.mutate(
		card.id,
		{ kind: "move", lane: "execute", artifact: { record } },
		owner,
		at + 4_000,
	);
	if (!moved.ok) throw new Error(moved.error);
	return { id: card.id, at: at + 4_000 };
}
