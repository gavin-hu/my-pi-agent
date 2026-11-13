/**
 * A card's kind on the page: the label the face wears, the same label in the record, and the
 * lead's queue — drawn once, in `render.ts`, so the three cannot disagree.
 *
 * `pages.test.ts` holds the class contract, which already compares the names with the
 * stylesheet; this holds what a reader sees — the label, the breaking half inside it, and the
 * nothing a card that recorded neither draws. It needs a browser, so it skips without one,
 * naming `PI_CHROME`, and the stylesheet half runs either way.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BoardBrowser, BOARD_CHROME as CHROME, openBoardBrowser } from "../../../test/helpers/board-browser.ts";
import { type Doc, type ElementLike } from "../../../test/helpers/board-dom.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { BOARD_CLIENT_JS } from "./client.ts";
import { BOARD_CSS } from "./styles.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

let board: BoardBrowser;

describe("the kind on the card face", () => {
	test("is a quiet word, with its breaking marker inside the same label", () => {
		expect(BOARD_CLIENT_JS).toContain('el("span", "bf-row__kind", card.type === undefined ? "" : card.type)');
		expect(BOARD_CLIENT_JS).toContain('el("span", "bf-row__breaking", "breaking")');
		// A kind is a field the card carries: a word, not a second pill, and no colour of its
		// own — so the one pill on a row stays the person.
		expect(BOARD_CSS).toMatch(/\.bf-row__kind\{[^}]*color:var\(--dim\)/);
		expect(BOARD_CSS).not.toMatch(/\.bf-row__kind\{[^}]*border:/);
		expect(BOARD_CSS).not.toMatch(/\.bf-row__kind\{[^}]*color:var\(--(warn|danger|accent)\)/);
		// Breaking is the half a release must say out loud, so it is the coloured one.
		expect(BOARD_CSS).toMatch(/\.bf-row__breaking\{[^}]*color:var\(--warn\)/);
		// Every width keeps it in two lines rather than an ellipsis after the first two words: the
		// clamp is the card shape's own now, not a phone override.
		expect(BOARD_CSS).toMatch(/\.bf-row__title\{[^}]*-webkit-line-clamp:2/);
	});
});

describe.skipIf(CHROME === undefined)("the kind on the served page", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/kind" },
		});
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("labels the executing card with its kind, and breaks it inside the label", async () => {
		const page = await board.reuse();
		const top = "#lane-execute .board-row .board-row__top";
		expect(await page.$eval(`${top} .bf-row__kind`, (node) => node.textContent)).toBe("feature \u00b7 breaking");
		// The word keeps the record's own case: the row's chrome is mono and quiet, and a kind
		// that shouted would read as a second mark beside the person's.
		expect(
			await page.$eval(
				`${top} .bf-row__kind`,
				(node) =>
					(
						globalThis as unknown as { getComputedStyle(node: ElementLike): { textTransform: string } }
					).getComputedStyle(node).textTransform,
			),
		).toBe("none");
	});

	test("draws no kind on a card that recorded none", async () => {
		const page = await board.reuse();
		const card = '#lane-backlog .board-row[data-card="1"]';
		expect(await page.$$eval(`${card} .bf-row__kind`, (nodes) => nodes.length)).toBe(0);
	});

	test("wears the same label in the lead's queue", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#panel-team:not([hidden]) .board-queue__row", { timeout: 5_000 });
		const labels = await page.$$eval("#panel-team .board-queue__row .bf-row__kind", (nodes) =>
			Array.from(nodes as ArrayLike<ElementLike>, (node) => node.textContent ?? ""),
		);
		expect(labels).toContain("feature \u00b7 breaking");
	});

	test("is a word the filter box matches, so a label a reader sees finds its card", async () => {
		// The executing card's title has no `feature` in it: the only thing that answers is the
		// kind it recorded, which is the point of teaching `matchesQuery` the word.
		const page = await board.reuse();
		await page.fill("#board-filter", "feature");
		await page.waitForFunction(
			() => {
				const document = (globalThis as unknown as { document: Doc }).document;
				return (
					document.querySelectorAll("#lane-execute .board-row").length === 1 &&
					document.querySelectorAll("#lane-backlog .board-row").length === 0
				);
			},
			undefined,
			{ timeout: 5_000 },
		);
	});
});
