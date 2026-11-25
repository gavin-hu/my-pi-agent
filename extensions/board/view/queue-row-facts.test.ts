/**
 * The ask row's facts line: one type, one height, a column the reason starts at, and the owner's
 * state said in words.
 *
 * The row review measured the fault this suite holds fixed: the pill, reason and age were 12px
 * while the kind and the owner inherited the column's 15px, so a row had three things at title
 * size and its sentence was the smallest; a one-line row was 43, 51 or 52px depending on which
 * optional parts a card carried; and the reason followed a variable-width pill and kind, starting
 * 138px apart on two rows. Everything here is computed off the page — sizes, boxes, the reason's
 * left edge — so a stylesheet that looks right and draws wrong fails.
 *
 * It needs a browser; where the machine has none the suite skips, naming PI_CHROME.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import type { RosterSession } from "../../../lib/session-roster.ts";
import { type Doc } from "../../../test/helpers/board-dom.ts";
import { CORE, LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	drawn,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { makeClock } from "../../../test/helpers/clock.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/**
 * The roster the owner cells are read against, one row per state the table names.
 *
 * The claimed card is held by `CORE`, and it is declared live — whose word is `free` and not the
 * state's own name, which is what a cell echoing `data-state` could not pass. A fresh record is
 * live, an aged one quiet, and one whose process is above every host's pid range is gone.
 */
const roster = (now: number): RosterSession[] => [
	// The fixture's two owners under the ids their cards were claimed with (`LEAD.id`/`CORE.id`, which
	// the shape types as optional because a written record may carry nobody's).
	{ id: "s-lead", label: LEAD.label, mode: "tui", lastSeen: now, mail: 0 },
	{ id: "s-core", label: CORE.label, mode: "tui", lastSeen: now, mail: 0 },
	{ id: "s-quiet", label: "ops-quiet", mode: "tui", lastSeen: now - 42 * 60_000, mail: 0 },
	{ id: "s-gone", label: "ops-gone", mode: "tui", lastSeen: now - 5_000, pid: 999_999_998, mail: 0 },
];

/** One boot and one teardown for the suite. */
const HOOK_MS = 30_000;

/** The sliver of an element this suite measures; this project's TypeScript has no DOM lib. */
interface Boxed {
	getBoundingClientRect(): { x: number; top: number; width: number; height: number };
	querySelector(selector: string): Boxed | null;
	textContent: string | null;
	getAttribute?(name: string): string | null;
}

/** One row's facts line: the row's box, the reason's box, and every part's computed type size. */
interface Facts {
	card: string;
	row: { w: number; h: number };
	why: { x: number; w: number; h: number } | null;
	/** Each part's font size, or absent when the card carries no such part. */
	sizes: { pill: string; kind: string; why: string; owner: string; stamp: string };
}

/**
 * Every row's facts line, read once.
 *
 * The fixture carries the shapes that used to disagree: an executing card with a type, a
 * breaking marker and an owner; unassigned cards with no type and no owner; a blocked card with
 * a danger reason; and a wait whose reason is long enough to clamp.
 */
const factsOf = (page: Page): Promise<Facts[]> =>
	page.evaluate(() => {
		const document = (globalThis as unknown as { document: Doc }).document;
		const style = (globalThis as unknown as { getComputedStyle(n: unknown): { fontSize: string } }).getComputedStyle;
		const box = (node: Boxed) => node.getBoundingClientRect();
		const round = (value: number) => Math.round(value * 10) / 10;
		return Array.from(document.querySelectorAll("#board-team .board-queue__row"), (node) => {
			const row = node as unknown as Boxed;
			const why = row.querySelector(".board-queue__why");
			const size = (selector: string) => {
				const found = row.querySelector(selector);
				return found === null ? "" : style(found).fontSize;
			};
			return {
				// The row names its card through the sentence it describes: team-why-<id>.
				card: (row.querySelector?.(".bf-row__title")?.getAttribute?.("aria-describedby") ?? "").replace(
					"team-why-",
					"",
				),
				row: { w: round(box(row).width), h: round(box(row).height) },
				why:
					why === null ? null : { x: Math.round(box(why).x), w: Math.round(box(why).width), h: round(box(why).height) },
				sizes: {
					pill: size(".bf-tag"),
					kind: size(".bf-row__kind"),
					why: size(".board-queue__why"),
					owner: size(".board-owner"),
					stamp: size(".board-stamp"),
				},
			};
		});
	}) as Promise<Facts[]>;

let board: BoardBrowser;

describe.skipIf(CHROME === undefined)("the ask row's facts", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({ lead: LEAD.label, now: clock.now, seed: seedWorkingBoard, roster });
	}, HOOK_MS);

	afterAll(async () => {
		await board?.close();
	}, HOOK_MS);

	for (const width of [1280, 1440] as const) {
		test(`sets one type on the facts line at ${width}`, async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
			await page.setViewportSize({ width, height: 900 });
			await drawn(page);
			const rows = await factsOf(page);
			// The fixture files two asks: a contract nobody has read, and a card whose holder is gone.
			// One carries a kind and a breaking marker, the other carries neither, which is the spread
			// this suite measures a type size and a height across.
			expect(rows.length).toBeGreaterThan(1);
			for (const row of rows) {
				// Every part a card carries is the same size; a part it does not carry is absent.
				const sizes = Object.entries(row.sizes).filter(([, size]) => size !== "");
				expect(sizes.length, `card ${row.card}`).toBeGreaterThan(1);
				for (const [part, size] of sizes) expect(size, `card ${row.card} ${part}`).toBe("12px");
			}
			// A one-line reason makes every row the same height, whatever optional parts it has:
			// before the fix these were 43 (neither), 51 (a kind) and 52 (an owner). The fixture
			// files two asks, and the row that carries a kind wraps its sentence first — so the
			// height is held on the one-line rows there are, and the parts' type size above is the
			// assertion that covers both.
			const oneLine = rows.filter((row) => row.why !== null && row.why.h <= 16);
			expect(oneLine.length, `one-line rows at ${width}`).toBeGreaterThanOrEqual(1);
			const heights = [...new Set(oneLine.map((row) => row.row.h))];
			expect(Math.max(...heights) - Math.min(...heights), `one-line height spread at ${width}`).toBeLessThanOrEqual(1);
			expect(Math.min(...heights), `one-line heights at ${width}`).toBeGreaterThanOrEqual(44);
		});

		test(`starts every reason at one x at ${width}`, async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
			await page.setViewportSize({ width, height: 900 });
			await drawn(page);
			const xs = (await factsOf(page)).flatMap((row) => (row.why === null ? [] : [row.why.x]));
			expect(xs.length).toBeGreaterThanOrEqual(2);
			// The labels are a track, so the sentence's left edge is a column rather than a function
			// of how wide the pill and the kind happen to be (the spread was 138px before this).
			expect(Math.max(...xs) - Math.min(...xs), `reason starts at ${width}`).toBeLessThanOrEqual(4);
		});
	}

	test("says the owner's state in the table's words, on both columns that print it", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-owner", { timeout: PAINT_MS });
		const read = await page.evaluate(() => {
			const document = (globalThis as unknown as { document: Doc }).document;
			// The published table itself, so neither expectation below restates a word: a second map in
			// either surface fails against this, which is the drift this case exists to stop.
			const word = (globalThis as unknown as { bfBoard: { stateWord: Record<string, string> } }).bfBoard.stateWord;
			const text = (node: Boxed | null) => (node?.textContent ?? "").trim();
			const cells = Array.from(document.querySelectorAll("#board-team .board-queue__row .board-owner"), (node) => {
				const cell = node as unknown as Boxed;
				const dot = cell.querySelector(".board-dot");
				return {
					label: text(cell),
					state: dot?.getAttribute?.("data-state") ?? "",
					dotHidden: dot?.getAttribute?.("aria-hidden") ?? "",
					title: cell.getAttribute?.("title") ?? "",
					name: cell.getAttribute?.("aria-label") ?? "",
				};
			});
			const pills = Array.from(document.querySelectorAll("#board-team .board-agent"), (node) => {
				const card = node as unknown as Boxed;
				const pill = card.querySelector(".board-agent__state");
				return {
					who: text(card.querySelector(".board-agent__name")),
					state: pill?.getAttribute?.("data-state") ?? "",
					word: text(pill),
				};
			});
			return { word, cells, pills };
		});
		// The rows carrying no owner render an empty placeholder, which says nothing and is left be.
		const owners = read.cells.filter((cell) => cell.state !== "");
		expect(owners.length, "owner cells carrying a dot").toBeGreaterThan(0);
		for (const cell of owners) {
			const state = read.word[cell.state];
			expect(state, `state ${cell.state} is in the published table`).toBeDefined();
			// The name and the word — never the word alone, which would lose whose state it is.
			expect(cell.title, `title for ${cell.label}`).toBe(`${cell.label}, ${state}`);
			expect(cell.name, `accessible name for ${cell.label}`).toBe(`${cell.label}, ${state}`);
			// The dot is the colour and the word is the state, so the dot stays decoration.
			expect(cell.dotHidden, `dot for ${cell.label}`).toBe("true");
		}
		// One of the states read here spells its word otherwise (`live` reads "free"), so a cell that
		// echoed `data-state` instead of asking the table would fail the equality above.
		expect(
			owners.some((cell) => read.word[cell.state] !== cell.state),
			"a word that is not its state's name",
		).toBe(true);
		// The Agents column prints the same table, so the same state is one word on both surfaces.
		expect(read.pills.length, "agent pills").toBeGreaterThan(1);
		for (const pill of read.pills) {
			const state = read.word[pill.state];
			expect(state, `agent state ${pill.state} is in the published table`).toBeDefined();
			// A quiet pill prints the word and then its age, so the word is where the pill starts.
			expect(pill.word.startsWith(state), `${pill.who}: "${pill.word}" starts with "${state}"`).toBe(true);
		}
		const words = new Set(read.pills.map((pill) => read.word[pill.state]));
		expect(words.size, "the roster shows more than one state").toBeGreaterThan(1);
	});

	test("gives a phone the reason a full line", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
		await page.setViewportSize({ width: 420, height: 900 });
		await drawn(page);
		const rows = await factsOf(page);
		const withReason = rows.filter((row) => row.why !== null);
		expect(withReason.length).toBeGreaterThan(1);
		for (const row of withReason) {
			// The labels and the age keep the first line and the sentence takes the width beneath it,
			// so its box is the row's width rather than the strip the labels left over.
			expect(Math.abs((row.why?.w ?? 0) - row.row.w), `card ${row.card}`).toBeLessThanOrEqual(1);
		}
		// The signature row's reason is the 29-character sentence that used to clamp into two 99px
		// lines: on its own line it is one.
		const signature = rows.find((row) => row.sizes.kind !== "");
		expect(signature?.why?.h ?? 0).toBeLessThanOrEqual(16);
	});
});
