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
	test("names the empty sentence by the class the pane draws, and spans the queue with it", () => {
		// The queue's paragraph is `board-team__empty`; `board-team__none` is the Agents column's
		// line for a label nothing answers to. The span is what a wrong name hides: with `auto-fit`
		// a lone item already takes the row, because the tracks without one collapse — the day the
		// queue holds a second item, or the template stops collapsing, it is one track wide.
		expect(BOARD_CSS).toContain(".board-queue > .board-team__empty{grid-column:1 / -1}");
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

/** How long one case may take: a boot, a reload, and a walk of the tab's boxes. */
const CASE_MS = 30_000;

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
	}, CASE_MS);

	afterAll(async () => {
		await board?.close();
	}, CASE_MS);

	/** One unclaimed backlog card, written by the board's lead the way a peer's write lands. */
	const unclaimed = async (title: string, index: number): Promise<void> => {
		await board.store.create({ title, paths: ["src/triage"] }, LEAD, clock.now() - index * 1_000);
	};

	/** Each band: its label, the rows it drew, and what its head says besides the count. */
	async function bands(page: Page): Promise<Array<{ label: string; rows: number; said: string; fold: string }>> {
		return page.$$eval("#board-team .board-queue__band", (nodes) =>
			Array.from(nodes as ArrayLike<HeadNode>, (band) => {
				const inside = band as unknown as { querySelectorAll(selector: string): ArrayLike<ElementLike> };
				return {
					label: band.querySelector("span")?.textContent ?? "",
					rows: Array.from(inside.querySelectorAll(".board-queue__row")).length,
					said: band.querySelector(".board-queue__said")?.textContent ?? "",
					fold: band.querySelector(".board-fold")?.textContent ?? "",
				};
			}),
		);
	}

	/** How far a band's head sits below the pane head's box: the pin offset, read as drawn. */
	const headGap = (page: Page) =>
		page.evaluate(() => {
			const document = (globalThis as unknown as { document: Doc }).document;
			const pane = document.querySelector('[data-pane="needs-you"] .bf-section__cap');
			const band = document.querySelector("#board-team .board-queue__band .bf-lane__head");
			const box = (node: ElementLike | null) =>
				(
					node as unknown as { getBoundingClientRect(): { y: number; height: number } } | null
				)?.getBoundingClientRect() ?? { y: 0, height: 0 };
			return {
				pane: Math.round(box(pane).y * 10) / 10,
				band: Math.round(box(band).y * 10) / 10,
				gap: Math.round((box(band).y - box(pane).y - box(pane).height) * 10) / 10,
			};
		});

	test(
		"folds a band at five rows, and says what all its rows share once",
		async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
			// Ten more unclaimed cards arrive the way a peer's write does, so the band is past its fold.
			for (let index = 0; index < 10; index++) await unclaimed(`Triage item ${index + 1}`, index);
			await page.waitForSelector('#board-team [data-fold="team-band-claim"]', { timeout: PAINT_MS });
			const closed = (await bands(page)).find((band) => band.label === "Unclaimed");
			// The count in the head is what says the rest exists, and the rows are five.
			expect(closed?.rows).toBe(5);
			expect(closed?.fold).toBe("+7 more");
			// The sentence every row in the band shared is printed once, in the band's head.
			expect(closed?.said).toBe("nobody holds it");
			const repeated = await page.$$eval(
				"#board-team .board-queue__why",
				(nodes) =>
					Array.from(nodes as ArrayLike<ElementLike>).filter(
						(node) => (node.textContent ?? "").trim() === "nobody holds it",
					).length,
			);
			expect(repeated).toBe(0);
			// A row with no line of its own is still described: it points at the head that said it. The
			// read is the claim band's own, because the tab draws a signature band above it.
			const described = await page.evaluate(() => {
				const document = (globalThis as unknown as { document: Doc }).document;
				type Node = ElementLike & {
					querySelector(selector: string): ElementLike | null;
				};
				const band = Array.from(document.querySelectorAll("#board-team .board-queue__band"))
					.map((node) => node as unknown as Node)
					.find((node) => (node.querySelector("span")?.textContent ?? "") === "Unclaimed");
				const title = band?.querySelector(".board-queue__title .bf-row__title") ?? null;
				const id = title?.getAttribute("aria-describedby") ?? "";
				return { id, said: document.getElementById(id)?.textContent ?? "" };
			});
			expect(described.id).toBe("team-said-claim");
			expect(described.said).toBe("nobody holds it");
			// One press draws the rest and one more folds them back: nothing is cut, only folded.
			await page.click('#board-team [data-fold="team-band-claim"]');
			await page.waitForTimeout(100);
			const open = (await bands(page)).find((band) => band.label === "Unclaimed");
			expect(open?.rows).toBe(12);
			expect(open?.fold).toBe("show fewer");
			await page.click('#board-team [data-fold="team-band-claim"]');
			await page.waitForTimeout(100);
			expect((await bands(page)).find((band) => band.label === "Unclaimed")?.rows).toBe(5);
		},
		CASE_MS,
	);

	test(
		"pins a band's head under the pane's, and keeps it there while the rows go by",
		async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-queue__band .bf-lane__head", { timeout: PAINT_MS });
			const before = await headGap(page);
			await page.evaluate(() => {
				const main = (globalThis as unknown as { document: Doc }).document.querySelector(".bf-app__main");
				if (main !== null) (main as unknown as { scrollTop: number }).scrollTop = 400;
			});
			await page.waitForTimeout(100);
			const after = await headGap(page);
			// The band's head starts against the pane head's rule — the pane's own gap apart — and stays
			// exactly there once the column has scrolled, so a reader three rows in still knows whose
			// move it is: the head did not move, and the gap did not open.
			expect(before.gap).toBeGreaterThanOrEqual(0);
			expect(before.gap).toBeLessThanOrEqual(8);
			expect(after.gap).toBe(before.gap);
			expect(after.band).toBe(before.band);
		},
		CASE_MS,
	);

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
			for (const family of ["board-agent", "board-queue__row", "board-row", "board-event"]) {
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
		"draws the board's lane head as its own caption, so a tab switch moves nothing",
		async () => {
			const page = await board.reuse();
			// A reload reopens the tab the URL names, so the board half is asked for rather than assumed.
			await page.click("#tab-board");
			await page.waitForSelector(".board-lane .board-row", { timeout: PAINT_MS });
			await page.waitForTimeout(100);
			const lanes = await heads(page, ".board-lane .bf-lane__head");
			expect(lanes).toHaveLength(5);
			const laneBelow = await below(page, '.board-lane[data-lane="backlog"] .bf-lane__head');
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .bf-section__cap", { timeout: PAINT_MS });
			await page.waitForTimeout(100);
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
		},
		CASE_MS,
	);

	test(
		"leaves one card one ground: the swimlane's, and no paper of the queue's own",
		async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
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
					paper: computed(node).backgroundColor,
				});
				const rows = Array.from(document.querySelectorAll("#board-team .board-queue__row"), read);
				const cards = Array.from(document.querySelectorAll("#board-team .bf-lane .board-row"), read);
				// The card this fixture puts in both places: the executing one, which nobody has
				// spot-checked, so the queue and its swimlane draw the same id.
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
			// The pill is what says why, in a word and a tone: the row has no paper left to say it.
			expect(paint.pill.text).toBe("needs review");
			expect(paint.pill.classes).toContain("bf-tone--warn");
		},
		CASE_MS,
	);

	test(
		"takes a column per band on a wide window, and gives a phone the whole title",
		async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-queue__band", { timeout: PAINT_MS });
			// How many different lines the bands start on: one is a row of columns, three is a stack.
			const lines = () =>
				page.$$eval("#board-team .board-queue__band", (nodes) => {
					const tops = Array.from(nodes as ArrayLike<ElementLike & { getBoundingClientRect(): { top: number } }>).map(
						(node) => Math.round(node.getBoundingClientRect().top / 100),
					);
					return [...new Set(tops)].length;
				});
			// A 2K window has the width for a column of asks per band, so the queue is three lines
			// tall instead of nine and no row is a metre wide.
			const bands = await page.$$eval("#board-team .board-queue__band", (nodes) => nodes.length);
			expect(bands).toBeGreaterThan(1);
			await page.setViewportSize({ width: 2560, height: 900 });
			await page.waitForTimeout(100);
			expect(await lines()).toBe(1);
			// A phone stacks them, and the title stops being one elided line: it takes the row's whole
			// width and wraps, which is the one thing a 375px row can still do for a long name.
			await page.setViewportSize({ width: 420, height: 900 });
			await page.waitForTimeout(100);
			expect(await lines()).toBe(bands);
			const cut = await page.$$eval(
				"#board-team .board-queue__row .bf-row__title",
				(nodes) =>
					Array.from(nodes as ArrayLike<ElementLike & { scrollWidth: number; clientWidth: number }>).filter(
						(node) => node.scrollWidth > node.clientWidth + 1,
					).length,
			);
			expect(cut).toBe(0);
			await page.setViewportSize({ width: 1280, height: 900 });
		},
		CASE_MS,
	);

	test(
		"draws one row for a session that renamed after claiming a card",
		async () => {
			const page = await board.reuse();
			await page.click("#tab-team");
			await page.waitForSelector("#board-team .board-agent", { timeout: PAINT_MS });
			await page.waitForTimeout(100);
			const { rows } = await census(page);
			// Three sessions, three rows. The fixture's executing card is owned by `s-core`, whose record
			// answers to `billing-core-renamed`; a card that kept the label its claim wrote would draw a
			// fourth row here — that dead name, as an owner nothing answers to.
			expect(rows["board-agent"]).toBe(3);
			const labels = await page.$$eval("#board-team .board-agent", (nodes) =>
				Array.from(nodes as ArrayLike<ElementLike>).map(
					(node) => (node as unknown as { textContent: string | null }).textContent ?? "",
				),
			);
			expect(labels.filter((text) => text.includes("billing-core-renamed"))).toHaveLength(1);
		},
		CASE_MS,
	);
});
