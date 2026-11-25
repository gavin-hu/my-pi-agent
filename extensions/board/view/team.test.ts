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
	drawn,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { waitFor } from "../../../test/helpers/process.ts";
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
	test("names the empty sentence by the class the pane draws, under its heads", () => {
		// The queue's paragraph is `board-team__empty`; `board-team__none` is the Agents column's
		// sentence for a session holding nothing, and the two must not answer for each other.
		expect(BOARD_CSS).toContain(".board-queue > .board-team__empty{margin:0}");
		expect(BOARD_CSS).not.toContain(".board-queue > .board-team__none");
	});

	test("draws an ask on the column's own ground, and leaves the tone to the pill", () => {
		// The queue is a list of asks, not a second drawing of the card: the row wears no paper, no
		// lane and no edge, so one card is one ground — the swimlane's — and the queue cannot read
		// as the same card drawn twice.
		expect(BOARD_CSS).not.toMatch(/\.board-queue__row\{[^}]*background/);
		expect(BOARD_CSS).not.toMatch(/\.board-queue__row\{[^}]*--paper:/);
		expect(BOARD_CSS).not.toMatch(/\.board-queue__row\[data-tone="[a-z]+"\]\{--paper:/);
		// The lane is the swimlane's fact, so the row does not claim it either.
		expect(BOARD_CLIENT_JS).not.toContain('row.setAttribute("data-lane"');
		// The tone is still the row's, so a danger row's sentence keeps it.
		expect(BOARD_CLIENT_JS).toContain('row.setAttribute("data-tone", decisionTone(entry.kind));');
	});
});

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** How long this suite's hooks may take: a boot, and a teardown that closes the browser. */
const HOOK_MS = 30_000;

/** The roster the tab draws: two rows, so the agents column has more than a heading. */
const sessions = (now: number): RosterSession[] => [
	{ id: "s-peer", label: "billing-peer", mode: "tui", lastSeen: now - 20_000, mail: 0 },
	// The executing card's owner, under the name its record answers to now: it claimed the card as
	// `billing-core` and the session renamed afterwards, which the card cannot know and the page must.
	{ id: "s-core", label: "billing-core-renamed", mode: "tui", lastSeen: now - 5_000, mail: 0 },
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
		for (const family of ["board-agent", "board-queue__row", "board-row", "board-event", "board-mail"]) {
			rows[family] = Array.from(
				(globalThis as unknown as { document: Doc }).document.querySelectorAll(`#board-team .${family}`),
			).length;
		}
		return { bottoms, lefts, rows };
	});
}

/**
 * A head as the browser draws it: the line it takes, the inks it states, the mark it wears, and the
 * rule under it. Two heads compare through this tuple and never through their x — a lane head and a
 * column's caption sit in different columns — so the rule's colour and the mark's stay out of it,
 * being the lane's role, the point of them.
 */
interface Head {
	height: number;
	font: string;
	color: string;
	countColor: string;
	gap: string;
	padding: string;
	ruleWidth: string;
	mark: string;
	markWidth: number;
}

/** The sliver of a head these reads reach, by name inside the page. */
interface HeadNode {
	textContent: string | null;
	nextElementSibling: HeadNode | null;
	getBoundingClientRect(): { y: number; bottom: number; width: number; height: number };
	querySelector(selector: string): HeadNode | null;
	querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

/** One head's paint, for the elements a selector finds on one frame. */
async function heads(page: Page, selector: string): Promise<Head[]> {
	return page.$$eval(selector, (nodes) => {
		const computed = (
			globalThis as unknown as {
				getComputedStyle(node: unknown): {
					color: string;
					gap: string;
					padding: string;
					borderBottomWidth: string;
					font: string;
				};
			}
		).getComputedStyle;
		return Array.from(nodes as ArrayLike<HeadNode>, (head) => {
			const style = computed(head);
			const mark = head.querySelector(".bf-lane__dot");
			const count = head.querySelector(".bf-lane__count, .bf-section__count");
			return {
				height: head.getBoundingClientRect().height,
				font: style.font,
				color: style.color,
				countColor: count === null ? "" : computed(count).color,
				gap: style.gap,
				padding: style.padding,
				ruleWidth: style.borderBottomWidth,
				mark: mark?.textContent ?? "",
				markWidth: Math.round((mark?.getBoundingClientRect().width ?? 0) * 10) / 10,
			};
		});
	});
}

/** How far the box under a head starts below the head's rule. */
async function below(page: Page, selector: string): Promise<number> {
	return page.evaluate((sel) => {
		const document = (globalThis as unknown as { document: { querySelector(selector: string): HeadNode | null } })
			.document;
		const head = document.querySelector(sel);
		if (head === null) throw new Error(`no head at ${sel}`);
		const next = head.nextElementSibling;
		if (next === null) throw new Error(`nothing under ${sel}`);
		return Math.round((next.getBoundingClientRect().y - head.getBoundingClientRect().bottom) * 10) / 10;
	}, selector);
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
	}, HOOK_MS);

	afterAll(async () => {
		await board?.close();
	}, HOOK_MS);

	/** One unclaimed backlog card, written by the board's lead the way a peer's write lands. */
	const unclaimed = async (title: string, index: number): Promise<void> => {
		await board.store.create({ title, paths: ["src/triage"] }, LEAD, clock.now() - index * 1_000);
	};

	/** The asks this suite added, so it can hand them back and leave the board as it found it. */
	const added: Array<{ id: string; owner: { id: string; label: string } }> = [];

	/** One complete contract nobody has read: an ask the seat can sign now, and only it can. */
	const unread = async (title: string, index: number): Promise<void> => {
		const card = await board.store.create({ title, paths: ["src/contract"] }, LEAD, clock.now() - index * 1_000);
		const owner = { id: "s-contract-" + index, label: "contract-" + index };
		const claimed = await board.store.mutate(card.id, { kind: "claim" }, owner, clock.now() - index * 1_000 + 1);
		if (!claimed.ok) throw new Error("unread: " + claimed.error);
		const written = await board.store.mutate(
			card.id,
			{
				kind: "contract",
				artifact: { record: "~/.pi/agent/plans/8872d3adda0e/" + card.id + ".md" },
				goal: "The feature does what the card says",
				acceptance: "A reader can tell it is done",
				scopeOut: "Everything the card does not name",
				verify: "bun run check",
			},
			owner,
			clock.now() - index * 1_000 + 2,
		);
		if (!written.ok) throw new Error("unread: " + written.error);
		added.push({ id: card.id, owner });
	};

	/** The ask list, as drawn: the rows it shows, and what its fold says. */
	async function asks(page: Page): Promise<{ rows: number; fold: string; behind: number }> {
		return page.evaluate(() => {
			const document = (globalThis as unknown as { document: Doc }).document;
			const list = document.querySelector("#team-asks");
			const fold = document.querySelector('#board-team [data-fold="needs-you"]');
			const said = fold?.textContent ?? "";
			return {
				rows: list === null ? 0 : list.querySelectorAll(".board-queue__row").length,
				fold: said,
				// The control says how many rows are behind it, which is the list's own count minus five.
				behind: Number(/\d+/.exec(said)?.[0] ?? "0"),
			};
		});
	}

	test("folds its one list at five rows, and every row says its own reason", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		// Ten more complete contracts arrive the way a peer's write does: the queue is one list of
		// the seat's own moves, so the way past its fold is more asks, not more unowned cards.
		for (let index = 0; index < 10; index++) await unread("Unread contract " + (index + 1), index);
		// Wait for the fold's own count, not for a row: the writes land one at a time, and a redraw
		// between two of them draws six behind the control and reads "Show 1 more".
		await waitFor(async () => (await asks(page)).behind === 6, PAINT_MS);
		const closed = await asks(page);
		// Eleven asks — the fixture's own approval and these ten — of which the list draws five and
		// counts six behind one control.
		expect(closed).toMatchObject({ rows: 5, fold: "Show 6 more", behind: 6 });
		// Every drawn row is described by its own line: the sentence is the row's, not the list's.
		const described = await page.evaluate(() => {
			const document = (globalThis as unknown as { document: Doc }).document;
			const rows = Array.from(document.querySelectorAll("#team-asks .board-queue__row"));
			return rows.map((row) => {
				const title = row.querySelector(".bf-row__title");
				const id = title?.getAttribute("aria-describedby") ?? "";
				return { row: row.getAttribute("data-ask") ?? "", id, said: document.getElementById(id)?.textContent ?? "" };
			});
		});
		expect(described).toHaveLength(5);
		for (const row of described) expect(row.id).toBe("team-why-" + row.row);
		for (const row of described) expect(row.said).toBe("contract ready \u2014 needs approval");
		// One press draws the rest and one more folds them back: nothing is cut, only folded.
		await page.click('#board-team [data-fold="needs-you"]');
		await waitFor(async () => (await asks(page)).rows === 11, PAINT_MS);
		expect(await asks(page)).toMatchObject({ rows: 11, fold: "Show fewer" });
		await page.click('#board-team [data-fold="needs-you"]');
		await waitFor(async () => (await asks(page)).rows === 5, PAINT_MS);
		expect((await asks(page)).rows).toBe(5);
		// Hand the cards back: the board is the suite's, and an owner this fixture never had would
		// draw an extra row in every case that reads the Agents column after this one.
		for (const card of added.splice(0)) {
			const freed = await board.store.mutate(card.id, { kind: "release" }, card.owner, clock.now());
			if (!freed.ok) throw new Error("release: " + freed.error);
		}
	});

	test("separates its rows with space, and draws no rule on one", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .bf-section__cap", { timeout: PAINT_MS });
		await drawn(page);
		const { bottoms, lefts, rows } = await census(page);
		// The families this fixture fills: two agents, a decision (the executing card has not been
		// spot-checked), its swimlane row, and the history the seeded moves left behind.
		for (const family of ["board-agent", "board-queue__row", "board-row", "board-event"]) {
			expect(rows[family] ?? 0, family).toBeGreaterThan(0);
		}
		expect(bottoms.filter((name) => name.includes(".bf-row"))).toEqual([]);
		// A tag is a chip in a sentence here, not a path in a list: no bar, no rule.
		expect(lefts).toEqual([]);
	});

	test("keeps one rule for each caption, and no more", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .bf-section__cap", { timeout: PAINT_MS });
		await drawn(page);
		const { bottoms } = await census(page);
		// Three columns and two panes: the tab's five landmarks, and the only lines it draws.
		expect(bottoms).toHaveLength(5);
		expect(bottoms.filter((name) => !name.includes(".bf-section__cap"))).toEqual([]);
	});

	test("draws the board's lane head as its own caption, so a tab switch moves nothing", async () => {
		const page = await board.reuse();
		// A reload reopens the tab the URL names, so the board half is asked for rather than assumed.
		await page.click("#tab-board");
		await page.waitForSelector(".board-lane .board-row", { timeout: PAINT_MS });
		await drawn(page);
		const lanes = await heads(page, ".board-lane .bf-lane__head");
		expect(lanes).toHaveLength(5);
		const laneBelow = await below(page, '.board-lane[data-lane="backlog"] .bf-lane__head');
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .bf-section__cap", { timeout: PAINT_MS });
		await drawn(page);
		const captions = await heads(page, "#board-team .bf-section__cap");
		const captionBelow = await below(page, '#board-team .board-team__column[data-column="agents"] .bf-section__cap');
		// The caption's 8px is the head's own margin, not a re-tuning of the column: the sections
		// under it still sit on the tab's 12px, so nothing else on the page moved.
		const sectionsBelow = await below(page, '#board-team .bf-section[data-pane="waiting"]');
		// One shape, so a reader toggling tabs cannot see the row move or darken: each tab's own
		// heads agree with each other, and the captions agree with the lane heads they answer to.
		expect(new Set(lanes.map((head) => JSON.stringify(head))).size, "the lane heads disagree").toBe(1);
		expect(new Set(captions.map((head) => JSON.stringify(head))).size, "the captions disagree").toBe(1);
		expect(captions[0]).toEqual(lanes[0]);
		// The mark is drawn, not reserved: an empty span still takes the gap on its right, so the
		// word started after a hole nothing had drawn in it.
		expect(lanes[0]?.mark).toBe("\u25a0");
		expect(lanes[0]?.markWidth).toBeGreaterThan(4);
		// The first card sits on the board's own 8px below the rule, not the column's 12.
		expect(laneBelow).toBe(8);
		expect(captionBelow).toBe(laneBelow);
		expect(sectionsBelow).toBe(12);
	});

	test("leaves one card one ground: the swimlane's, and no paper of the queue's own", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
		await drawn(page);
		// The ground is not composited, so two elements on one token compute one string: the paint
		// is read, not inferred from the stylesheet.
		const paint = await page.evaluate(() => {
			const document = (globalThis as unknown as { document: Doc }).document;
			const computed = (
				globalThis as unknown as {
					getComputedStyle(node: ElementLike): { backgroundColor: string };
				}
			).getComputedStyle;
			// A row names its card with `data-ask` and a card with `data-card`: an ask is a line
			// about a card, not a second drawing of it, and the id is how the two are compared.
			const read = (node: ElementLike, hook: string) => ({
				card: node.getAttribute(hook),
				paper: computed(node).backgroundColor,
			});
			const rows = Array.from(document.querySelectorAll("#board-team .board-queue__row")).map((node) =>
				read(node, "data-ask"),
			);
			const cards = Array.from(document.querySelectorAll("#board-team .bf-lane .board-row")).map((node) =>
				read(node, "data-card"),
			);
			// The card this fixture puts in both places: the one whose contract nobody has read, so
			// the queue says the seat must sign it and its swimlane draws the card itself.
			const shared = rows.find((row) => cards.some((card) => card.card === row.card)) ?? null;
			const pill = document.querySelector("#board-team .board-queue__row .bf-tag");
			return {
				row: shared,
				card: shared === null ? null : (cards.find((card) => card.card === shared.card) ?? null),
				pill: { text: pill?.textContent ?? "", classes: (pill as unknown as { className: string })?.className ?? "" },
			};
		});
		expect(paint.card).not.toBeNull();
		// One card, one ground: the queue's row is transparent, so the only paper a card has on
		// this tab is the lane's.
		expect(paint.row?.paper).toBe("rgba(0, 0, 0, 0)");
		expect(paint.card?.paper).not.toBe(paint.row?.paper);
		// The pill is what says why, in a word and a tone: the row has no paper left to say it. The
		// shared card is the fixture's unread contract, so the word is the seat's own move.
		expect(paint.pill.text).toBe("needs approval");
		expect(paint.pill.classes).toContain("bf-tone--warn");
	});

	test("draws one row for a session that renamed after claiming a card", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-agent", { timeout: PAINT_MS });
		await drawn(page);
		const { rows } = await census(page);
		// Four rows: three sessions, and the label the fixture leaves holding a card no record answers
		// to. The fixture's executing card is owned by `s-core`, whose record answers to
		// `billing-core-renamed`; a card that kept the label its claim wrote would draw a fifth row
		// here — that dead name, as an owner nothing answers to.
		expect(rows["board-agent"]).toBe(4);
		const labels = await page.$$eval("#board-team .board-agent", (nodes) =>
			Array.from(nodes as ArrayLike<ElementLike>).map(
				(node) => (node as unknown as { textContent: string | null }).textContent ?? "",
			),
		);
		expect(labels.filter((text) => text.includes("billing-core-renamed"))).toHaveLength(1);
	});
});
