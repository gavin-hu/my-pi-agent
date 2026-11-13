/**
 * The Team tab's own contracts, held apart from `pages.test.ts`.
 *
 * `pages.test.ts` is named at its height in `test/suite-sizes.test.ts`, so what the tab's
 * fragment must be true of lives here: the shapes it builds from a session's label, and how
 * much line it draws to separate one row from the next — a sentence a stylesheet can promise and
 * only a browser can confirm, because it is a computed border on a drawn element.
 *
 * The first half needs no browser: it is the bundle-side rule the page depends on. The second
 * boots the served page and counts, which is the only way to hold "rows are told from one another
 * by space" to a number, and to see that one card drawn in two places is painted one colour.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { makeClock } from "../../../test/helpers/clock.ts";
import { type Doc, type ElementLike } from "../../../test/helpers/board-dom.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import type { RosterSession } from "../../../lib/session-roster.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { BOARD_CLIENT_JS } from "./client.ts";
import { BOARD_CSS } from "./styles.ts";

describe("the Team tab's label maps", () => {
	test("keys a session's label without inheriting one", () => {
		// A label is a name a session asks for, so a peer may join as `constructor`. On a plain
		// object that key reads as inherited and truthy, so `seen[key]` dropped the owner's row
		// from the list and the queue called the same owner not running; a null prototype has no
		// members to fall back on, which makes "not written" read as not written.
		expect(BOARD_CLIENT_JS).toContain("function labelMap() { return Object.create(null); }");
		for (const map of ["gone", "owners", "seen"]) {
			expect(BOARD_CLIENT_JS).toContain(`var ${map} = labelMap();`);
			expect(BOARD_CLIENT_JS).not.toContain(`var ${map} = {};`);
		}
	});
});

describe("the Team tab's one paper", () => {
	test("paints a decision row on its lane's paper, and leaves the tone to the pill", () => {
		// The row is a `.bf-row` that names its lane, so the lane's paper answers it exactly as it
		// answers the swimlane card under it: a card drawn twice in one column is one colour.
		expect(BOARD_CSS).toMatch(/\.board-decision\{[^}]*--paper:var\(--note-paper\)/);
		// And no rule may paint a row by its kind again — the second legend is what this removed.
		expect(BOARD_CSS).not.toMatch(/\.board-decision\[data-tone="[a-z]+"\]\{--paper:/);
		// The tone is still the row's, so the mark at its edge and a danger row's sentence keep it.
		expect(BOARD_CLIENT_JS).toContain('node.setAttribute("data-lane", card.lane)');
		expect(BOARD_CLIENT_JS).toContain('node.setAttribute("data-tone", tone)');
	});
});

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** How long one case may take: a boot, a reload, and a walk of the tab's boxes. */
const CASE_MS = 30_000;

/** The roster the tab draws: two rows, so the agents column has more than a heading. */
const sessions = (now: number): RosterSession[] => [
	{ id: "s-peer", label: "billing-peer", mode: "tui", lastSeen: now - 20_000, mail: 0 },
	{ id: "s-lead", label: "billing-lead", mode: "tui", lastSeen: now, mail: 0 },
];

/**
 * The tab's boxes, as the browser computes them.
 *
 * A class list rather than a count, so a failure names the element that drew the line the tab
 * promised not to draw. The read is one expression because every element has to be styled on the
 * same frame — a list built across two evaluates could describe two different paints.
 */
interface Census {
	/** One entry per element drawing a bottom border, as `tag.class.class`. */
	bottoms: string[];
	/** One entry per element drawing a left border. */
	lefts: string[];
	/** How many rows each family drew, so a case cannot pass on an empty column. */
	rows: Record<string, number>;
}

async function census(page: Page): Promise<Census> {
	return page.evaluate(() => {
		const document = (globalThis as unknown as { document: Doc }).document;
		const root = document.getElementById("board-team") as unknown as {
			querySelectorAll(selector: string): ArrayLike<ElementLike>;
		} | null;
		if (root === null) throw new Error("the Team tab is not on the page");
		const computed = (
			globalThis as unknown as {
				getComputedStyle(node: ElementLike): {
					borderBottomStyle: string;
					borderBottomWidth: string;
					borderLeftStyle: string;
					borderLeftWidth: string;
				};
			}
		).getComputedStyle;
		const bottoms: string[] = [];
		const lefts: string[] = [];
		for (const node of Array.from(root.querySelectorAll("*"))) {
			const element = node as unknown as { tagName: string; className: string };
			const name = `${element.tagName.toLowerCase()}${element.className ? "." + String(element.className).trim().split(/\s+/).join(".") : ""}`;
			const style = computed(node);
			if (style.borderBottomStyle !== "none" && Number.parseFloat(style.borderBottomWidth) > 0) bottoms.push(name);
			if (style.borderLeftStyle !== "none" && Number.parseFloat(style.borderLeftWidth) > 0) lefts.push(name);
		}
		const rows: Record<string, number> = {};
		for (const family of ["board-agent", "board-decision", "board-row", "board-event", "board-mail"]) {
			rows[family] = Array.from(
				(globalThis as unknown as { document: Doc }).document.querySelectorAll(`#board-team .${family}`),
			).length;
		}
		return { bottoms, lefts, rows };
	});
}

describe.skipIf(CHROME === undefined)("the Team tab's ink", () => {
	let board: BoardBrowser;

	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			roster: sessions,
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/team-ink" },
		});
	}, CASE_MS);

	afterAll(async () => {
		await board?.close();
	}, CASE_MS);

	test(
		"separates its rows with space, and draws no rule on one",
		async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .bf-section__cap", { timeout: PAINT_MS });
			await page.waitForTimeout(100);
			const { bottoms, lefts, rows } = await census(page);
			// The families this fixture fills: two agents, a decision (the executing card has not been
			// spot-checked), its swimlane row, and the history the seeded moves left behind.
			for (const family of ["board-agent", "board-decision", "board-row", "board-event"]) {
				expect(rows[family] ?? 0, family).toBeGreaterThan(0);
			}
			expect(bottoms.filter((name) => name.includes(".bf-row"))).toEqual([]);
			// A tag is a chip in a sentence here, not a path in a list: no bar, no rule.
			expect(lefts).toEqual([]);
		},
		CASE_MS,
	);

	test(
		"keeps one rule for each caption, and no more",
		async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .bf-section__cap", { timeout: PAINT_MS });
			await page.waitForTimeout(100);
			const { bottoms } = await census(page);
			// Three columns and three panes: the tab's six landmarks, and the only lines it draws.
			expect(bottoms).toHaveLength(6);
			expect(bottoms.filter((name) => !name.includes(".bf-section__cap"))).toEqual([]);
		},
		CASE_MS,
	);

	test(
		"tints one card once, in the queue and in the swimlane under it",
		async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-decision", { timeout: PAINT_MS });
			await page.waitForTimeout(100);
			// The ground is not composited, so two elements on one token compute one string: the paint
			// is read, not inferred from the stylesheet.
			const paint = await page.evaluate(() => {
				const document = (globalThis as unknown as { document: Doc }).document;
				const computed = (
					globalThis as unknown as {
						getComputedStyle(node: ElementLike): { backgroundColor: string };
					}
				).getComputedStyle;
				const read = (node: ElementLike) => ({
					card: node.getAttribute("data-card"),
					lane: node.getAttribute("data-lane"),
					paper: computed(node).backgroundColor,
				});
				const rows = Array.from(document.querySelectorAll("#board-team .board-decision"), read);
				const cards = Array.from(document.querySelectorAll("#board-team .bf-lane .board-row"), read);
				// The card this fixture puts in both places: the executing one, which nobody has
				// spot-checked, so the queue and its swimlane draw the same id.
				const shared = rows.find((row) => cards.some((card) => card.card === row.card)) ?? null;
				const pill = document.querySelector("#board-team .board-decision .bf-tag");
				return {
					row: shared,
					card: shared === null ? null : (cards.find((card) => card.card === shared.card) ?? null),
					pill: { text: pill?.textContent ?? "", classes: (pill as unknown as { className: string })?.className ?? "" },
				};
			});
			expect(paint.row?.lane).toBe("execute");
			expect(paint.card).not.toBeNull();
			// One card, one ground: this is the whole change, and it is only true of a computed paper.
			expect(paint.row?.paper).toBe(paint.card?.paper);
			// The paper stopped saying the why, so the pill still has to: its word and its tone.
			expect(paint.pill.text).toBe("needs review");
			expect(paint.pill.classes).toContain("bf-tone--warn");
		},
		CASE_MS,
	);
});
