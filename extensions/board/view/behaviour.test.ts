/**
 * The board page, driven the way a reader drives it.
 *
 * `pages.test.ts` holds what a reader cannot see — no card text in the document, no
 * `innerHTML`, no write surface. This holds what the page *does*, which no type checker
 * sees: a card opens from its title and closes on Esc, the filter narrows the lanes, the
 * Done lane folds and unfolds, a card another session writes arrives without a reload,
 * and the footer says what the store holds. Every assertion reads the shipped ids and
 * classes, so a rewrite of the template strings that keeps the contract keeps this green.
 *
 * It needs a browser. Where the machine has none the suite skips, naming `PI_CHROME`, so
 * `bun run check` stays green on a runner without Chrome and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { makeClock } from "../../../test/helpers/clock.ts";
import type { Actor } from "../../../lib/board/rules.ts";
import { boardConfig } from "../../../lib/board/config.ts";
import { createStore } from "../../../lib/board/store.ts";
import { advance } from "../../../test/helpers/board-flow.ts";
import { type Doc, type ElementLike, focusedClass, hidden } from "../../../test/helpers/board-dom.ts";
import { CORE, LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import type { RosterSession } from "../../../lib/session-roster.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { serveBoardPage } from "../../../test/helpers/board-page.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** How long a case that boots a page, waits out a heartbeat, and filters twice may take. */
const CASE_MS = 30_000;

/** The board the suite reads, its browser, and the place a test writes beside its cards. */
let board: BoardBrowser;
let store: ReturnType<typeof createStore>;
let directory = "";

/** The store's own path and the repository it belongs to, as the page is told them. */
const WHERE = "~/.pi/agent/board/behaviour";
const ROOT = "/Users/someone/my-pi-agent";
const REPO = "my-pi-agent";

/**
 * The suite's one tab, its document reloaded for every case.
 *
 * A reload is what makes a case start clean: no stream, no repaint in flight, no filter,
 * fold, tab, mark, or focus survives it. The tab itself does, because a boot's expensive
 * half is the tab rather than the load, so `reuse()` puts the one tab-level fact — the
 * viewport — back and reloads. Nothing here closes it: `afterAll` closes the browser.
 */
const openPage = (): Promise<Page> => board.reuse();

/** The titles a lane currently shows, in the order it shows them. */
async function titlesIn(page: Page, lane: string): Promise<string[]> {
	return page.$$eval(`#lane-${lane} .bf-row__title`, (nodes) =>
		Array.from(nodes as ArrayLike<ElementLike>, (node) => node.textContent ?? ""),
	);
}

/** One lane's row count, as the page sees it: a predicate, evaluated in the page. */
async function rowCount(page: Page, lane: string, count: number): Promise<void> {
	await page.waitForFunction(
		({ lane, count }) =>
			(globalThis as unknown as { document: Doc }).document.querySelectorAll(`#lane-${lane} .bf-row`).length === count,
		{ lane, count },
		{ timeout: PAINT_MS },
	);
}

describe.skipIf(CHROME === undefined)("the served page", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			// The page prints who signed, so the board names `billing-lead` as its lead.
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: REPO, root: ROOT, where: WHERE },
		});
		store = board.store;
		directory = board.directory;
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("draws each lane with the rows the store holds", async () => {
		const page = await openPage();
		expect((await titlesIn(page, "backlog")).sort()).toEqual([
			"Export orders as CSV",
			"Invoice totals round the wrong way",
		]);
		expect(await titlesIn(page, "execute")).toEqual(["Billing webhook accepts orders"]);
		// Past six finished cards the lane starts folded, so its rows are in the document but hidden: a reader clicks the head to see them.
		expect(await page.$eval("#lane-head-done", (node) => node.getAttribute("aria-expanded"))).toBe("false");
		expect(await hidden(page, "#lane-done")).toBe(true);
		// A folded lane wears the rail the stylesheet draws and the narrow layout sizes.
		expect(await page.getAttribute('.bf-lane[data-lane="done"]', "data-folded")).toBe("true");
	});

	test("names itself in the tab, and links the mark the header draws", async () => {
		const page = await openPage();
		// A tab is read from a strip of other tabs: the repository's own name tells two boards apart, and the count is the reason a tab is read at
		// all. Both need the store, so the client paints them; the head's `board` is what a tab shows before the first frame.
		await page.waitForFunction(
			() => (globalThis as unknown as { document: Doc }).document.title.includes("open"),
			undefined,
			{ timeout: PAINT_MS },
		);
		expect(await page.title()).toBe("board · my-pi-agent · 3 open");

		// The mark is the one the header draws, as a `data:` URI the page's own CSP allows.
		const icons = await page.$$eval('link[rel="icon"]', (nodes) =>
			Array.from(nodes as ArrayLike<ElementLike>, (node) => node.getAttribute("href") ?? ""),
		);
		expect(icons).toHaveLength(2);
		for (const href of icons) expect(href.startsWith("data:image/svg+xml,")).toBe(true);

		// And the browser draws it under the page's own CSP: an icon it refused, or a URI it could not parse, would report no width at all.
		const drawn = await page.evaluate(
			() =>
				new Promise<number>((resolve) => {
					const doc = globalThis as unknown as {
						document: { querySelector(selector: string): ElementLike | null };
						Image: new () => {
							naturalWidth: number;
							src: string;
							onload: (() => void) | null;
							onerror: (() => void) | null;
						};
					};
					const image = new doc.Image();
					image.onload = () => resolve(image.naturalWidth);
					image.onerror = () => resolve(0);
					image.src = doc.document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? "";
				}),
		);
		expect(drawn).toBeGreaterThan(0);
	});

	test("switches the two tabs from the keyboard, with one in the Tab order", async () => {
		const page = await openPage();
		// One stop in the Tab order: the selected tab. The other is reached with an arrow.
		expect(await page.$eval("#tab-board", (node) => node.getAttribute("tabindex"))).toBe("0");
		expect(await page.$eval("#tab-team", (node) => node.getAttribute("tabindex"))).toBe("-1");
		expect(await page.$eval("#tab-board", (node) => node.getAttribute("aria-selected"))).toBe("true");

		await page.focus("#tab-board");
		await page.keyboard.press("ArrowRight");
		expect(await hidden(page, "#panel-team")).toBe(false);
		expect(await page.$eval("#tab-team", (node) => node.getAttribute("aria-selected"))).toBe("true");
		expect(
			await page.evaluate(() =>
				(
					globalThis as unknown as { document: { activeElement: ElementLike | null } }
				).document.activeElement?.getAttribute("id"),
			),
		).toBe("tab-team");

		// Home goes back to the first tab, and it is the selected one again.
		await page.keyboard.press("Home");
		expect(await hidden(page, "#panel-team")).toBe(true);
		expect(await page.$eval("#tab-board", (node) => node.getAttribute("aria-selected"))).toBe("true");
	});

	test("filters on a note's words, which the tool's query reads too", async () => {
		const page = await openPage();
		// Nothing on the card's face says "retries": the word lives in a note, and the filter runs the module's own predicate rather than a copy of
		// it.
		await page.fill("#board-filter", "retries");
		await rowCount(page, "execute", 1);
		expect(await titlesIn(page, "execute")).toEqual(["Billing webhook accepts orders"]);
		await rowCount(page, "backlog", 0);
	});

	test("narrows the lanes from the one filter box", async () => {
		const page = await openPage();
		await page.fill("#board-filter", "invoice");
		await rowCount(page, "backlog", 1);
		expect(await titlesIn(page, "backlog")).toEqual(["Invoice totals round the wrong way"]);
		expect(await titlesIn(page, "execute")).toEqual([]);
		// Clearing it puts the board back: the filter is a view, never a store read.
		await page.fill("#board-filter", "");
		await rowCount(page, "backlog", 2);
	});

	test("folds Done past six cards, and unfolds it on a click", async () => {
		const page = await openPage();
		await page.click("#lane-head-done");
		await rowCount(page, "done", 7);
		expect(await hidden(page, "#lane-done")).toBe(false);
		expect(await page.$eval("#lane-head-done", (node) => node.getAttribute("aria-expanded"))).toBe("true");
		expect(await page.getAttribute('.bf-lane[data-lane="done"]', "data-folded")).toBe("false");

		await page.click("#lane-head-done");
		expect(await hidden(page, "#lane-done")).toBe(true);
	});

	test("switches lanes from the tab rail when the board is one column", async () => {
		const page = await openPage();
		await page.setViewportSize({ width: 860, height: 900 });
		await page.waitForTimeout(200);
		expect(await page.isVisible("#board-picker")).toBe(true);
		// The rail is one button per lane, and it names the lane it is showing through aria-pressed; the other lanes are out of the document's flow:
		// one column, one lane.
		expect(await page.$$eval("#board-picker .bf-tabs__item", (nodes) => nodes.length)).toBe(5);
		expect(await page.$eval('#board-picker [data-picker-lane="backlog"]', (n) => n.getAttribute("aria-pressed"))).toBe(
			"true",
		);
		await page.click('#board-picker [data-picker-lane="execute"]');
		// The rail shows one lane; a lane's list is the fold's own state, so the wait is on the section a reader sees rather than on the list inside
		// it.
		await page.waitForFunction(
			() =>
				(
					globalThis as unknown as {
						document: { querySelector(selector: string): { hidden: boolean } | null };
					}
				).document.querySelector('.bf-lane[data-lane="backlog"]')?.hidden === true,
			undefined,
			{ timeout: PAINT_MS },
		);
		expect(await page.isVisible('.bf-lane[data-lane="execute"]')).toBe(true);
		expect(await page.$eval('#board-picker [data-picker-lane="execute"]', (n) => n.getAttribute("aria-pressed"))).toBe(
			"true",
		);
		expect(await page.$eval('#board-picker [data-picker-lane="backlog"]', (n) => n.getAttribute("aria-pressed"))).toBe(
			"false",
		);
	});

	test("names a lane's count in words, so the heading is not one glued word", async () => {
		const page = await openPage();
		const head = (lane: string) => `.bf-lane[data-lane="${lane}"] .bf-lane__head`;
		expect(await page.getAttribute(head("backlog"), "aria-label")).toBe("Backlog, 2 cards");
		// A pulled lane says the limit the pill prints as `0/3`.
		expect(await page.textContent('.bf-lane[data-lane="plan"] .bf-lane__count')).toBe("0/3");
		expect(await page.getAttribute(head("plan"), "aria-label")).toBe("Plan, 0 of 3");

		// A filtered lane names what it shows against the rows it holds, not the limit.
		await page.fill("#board-filter", "invoice");
		await rowCount(page, "backlog", 1);
		expect(await page.textContent('.bf-lane[data-lane="backlog"] .bf-lane__count')).toBe("1/2");
		expect(await page.getAttribute(head("backlog"), "aria-label")).toBe("Backlog, 1 of 2");

		// The Team tab's three columns count themselves the same way, each in its own noun.
		await page.fill("#board-filter", "");
		await page.click("#tab-team");
		const captions = await page.$$eval(".bf-section__cap", (nodes) =>
			Array.from(nodes as ArrayLike<ElementLike>, (node) => node.getAttribute("aria-label") ?? ""),
		);
		// The team page carries more sections than it once did (a needs-you queue and a waiting queue sit beside the three columns), so each caption
		// is found by its name.
		expect(captions.some((caption) => /^Agents, \d+ agents?$/.test(caption))).toBe(true);
		expect(captions.some((caption) => /^Active work, \d+ cards?$/.test(caption))).toBe(true);
		expect(captions.some((caption) => /^Activity, \d+ rows?$/.test(caption))).toBe(true);
	});

	test("says when the filter matches nothing, and gives the way back", async () => {
		// Cases share one page: start from the board view with no filter.
		const page = await openPage();
		await page.click("#tab-board");
		await page.fill("#board-filter", "");
		await page.fill("#board-filter", "zzzznomatch");
		await page.waitForFunction(
			() =>
				(
					globalThis as unknown as { document: { getElementById(id: string): { hidden: boolean } | null } }
				).document.getElementById("board-no-cards")?.hidden === false,
			undefined,
			{ timeout: PAINT_MS },
		);
		// One statement instead of five empty trays, naming the reader's own words.
		expect(await page.textContent("#board-no-cards-title")).toBe("No card matches \u201czzzznomatch\u201d");
		expect(await hidden(page, "#board-lanes")).toBe(true);

		await page.click("#board-no-match-clear");
		await rowCount(page, "backlog", 2);
		expect(await page.inputValue("#board-filter")).toBe("");
		expect(await hidden(page, "#board-no-cards")).toBe(true);
		expect(await hidden(page, "#board-lanes")).toBe(false);
		// The way back is also the way to keep typing: the field has the keyboard again.
		expect(
			await page.evaluate(() =>
				(
					globalThis as unknown as { document: { activeElement: ElementLike | null } }
				).document.activeElement?.getAttribute("id"),
			),
		).toBe("board-filter");
	});

	test("says what a card's age is, on the hover, and keeps it honest", async () => {
		const page = await openPage();
		const age = await page.$eval("#lane-execute .bf-row .bf-row__meta [data-at]", (n) => ({
			text: n.textContent ?? "",
			title: n.getAttribute("title") ?? "",
		}));
		// The text is the compact age the row needs; the hover is the same fact in a sentence.
		expect(age.text).toMatch(/^\d+[mhd]$|^now$/);
		expect(age.title).toMatch(/^updated (just now|\d+[mhd] ago)$/);
	});

	test("wears its kind, its priority and its paths as fields, not as prose", async () => {
		const page = await openPage();
		// The executing card is the seeded one with a priority, so its head is the case: what kind of work it is leads, the order it is in sits beside
		// it, and who holds the card is a plain name on the note's last line, not the chip a path wears.
		const top = "#lane-execute .bf-row .board-row__top";
		expect(await page.$eval(`${top} .bf-row__kind`, (n) => n.textContent)).toBe("feature \u00b7 breaking");
		expect(await page.$eval(`${top} .board-row__priority`, (n) => n.textContent)).toBe("high");
		expect(await page.$eval("#lane-execute .bf-row .board-row__owner", (n) => n.textContent)).toBe("billing-core");
		// A path is a value a reader types, so it wears the dialog's mono face on the row too.
		const mono = await page.$eval("#lane-execute .bf-row .board-row__paths .bf-tag", (n) =>
			(globalThis as unknown as { getComputedStyle(node: ElementLike): { fontFamily: string } })
				.getComputedStyle(n)
				.fontFamily.toLowerCase(),
		);
		expect(mono).toContain("mono");
	});

	test("names the hints behind its +N chip, and lists them for a reader who never hovers", async () => {
		const hints = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"];
		const added = await store.create({ title: "A card with five hints", paths: hints }, CORE, clock.now());
		try {
			const page = await openPage();
			const card = `.bf-row[data-card="${added.id}"]`;
			await page.waitForSelector(`${card} .board-row__paths`, { timeout: PAINT_MS });

			// The marker trails the row as a count, and the hints past the third live in the dialog until a reader hovers it — one per line, as the
			// tag's title.
			const rest = await page.$eval(`${card} .board-row__paths .bf-tag[aria-hidden="true"]`, (node) => ({
				text: node.textContent ?? "",
				title: node.getAttribute("title") ?? "",
			}));
			expect(rest.text).toBe("+2");
			expect(rest.title).toBe("src/d.ts\nsrc/e.ts");

			// And they are in the list, as text a screen reader reads and the title describes.
			const listed = await page.$$eval(`${card} .board-row__paths .sr-only`, (nodes) =>
				Array.from(nodes as ArrayLike<ElementLike>, (node) => node.textContent ?? ""),
			);
			expect(listed).toEqual(["src/d.ts", "src/e.ts"]);
			expect(await page.getAttribute(`${card} .bf-row__title`, "aria-describedby")).toBe(`card-paths-${added.id}`);
		} finally {
			await store.mutate(added.id, { kind: "drop" }, CORE, clock.now());
		}
	});

	test("draws the state on the face and repeats it in the card's description, so the keyboard reaches it", async () => {
		const page = await openPage();
		// The face draws the state a card owes somebody, and the title button carries the same sentence as its description, so focusing it — by walking
		// or by Tab — says what the card still needs without opening it.
		const id = await page.$eval("#lane-execute .bf-row", (node) => node.getAttribute("data-card") ?? "");
		const line = `.bf-row[data-card="${id}"] .bf-row__reason`;
		const reason = await page.textContent(line);
		expect(reason ?? "").not.toBe("");
		expect(await page.getAttribute(line, "data-tone")).toBe("muted");
		expect(await page.getAttribute(`.bf-row[data-card="${id}"] .bf-row__title`, "aria-describedby")).toContain(
			`card-reason-${id}`,
		);
		expect(await page.textContent(`#card-reason-${id}`)).toBe(reason ?? "");
		await page.focus(`.bf-row[data-card="${id}"] .bf-row__title`);
		expect(await focusedClass(page)).toContain("bf-row__title");
	});

	test("says how many notes a card carries, and the last note's age only when it adds a fact", async () => {
		// A note is itself a write, so the newest note is usually the newest stamp on the card: printing its age beside the updated one gave the
		// meta line two identical bare numbers.
		const quiet = await store.create(
			{ title: "A card whose note was its last write", paths: [], note: "one note" },
			CORE,
			clock.now(),
		);
		const busy = await store.create(
			{ title: "A card written again after its note", paths: [], note: "one note" },
			CORE,
			clock.now(),
		);
		// Two days on, so the claim's stamp and the note's read as different ages: the fixture's clock is fixed, and a difference of minutes would
		// round to the same day count.
		await store.mutate(busy.id, { kind: "claim" }, CORE, clock.now() + 2 * 86_400_000);
		try {
			const page = await openPage();
			const quietChip = `.bf-row[data-card="${quiet.id}"] .board-row__notes`;
			await page.waitForSelector(quietChip, { timeout: PAINT_MS });
			expect(await page.textContent(quietChip)).toBe("1 note");
			// No stamp of its own, so nothing to keep honest and nothing to hover for.
			expect(await page.$$eval(`${quietChip} [data-at]`, (nodes) => nodes.length)).toBe(0);

			// A later write that is not a note leaves the two ages saying different things, so the note's own earns its place: it says when the
			// conversation went quiet, which the card's updated stamp cannot.
			const busyChip = `.bf-row[data-card="${busy.id}"] .board-row__notes`;
			const updated = await page.textContent(`.bf-row[data-card="${busy.id}"] .bf-row__meta [data-at]`);
			const written = await page.textContent(busyChip);
			expect(written).toMatch(/^1 note \u00b7 \d+[a-z]+$/);
			expect(written).not.toBe(`1 note \u00b7 ${updated}`);
			expect(await page.$eval(`${busyChip} [data-at]`, (node) => node.getAttribute("data-at-title") ?? "")).toBe(
				"last note {age} by billing-core",
			);

			// A card nobody has annotated draws nothing at all rather than "0 notes".
			const bare = await store.create({ title: "A card with no history", paths: [] }, CORE, clock.now());
			try {
				await page.waitForSelector(`.bf-row[data-card="${bare.id}"]`, { timeout: PAINT_MS });
				expect(await page.$$eval(`.bf-row[data-card="${bare.id}"] .board-row__notes`, (nodes) => nodes.length)).toBe(0);
			} finally {
				await store.mutate(bare.id, { kind: "drop" }, CORE, clock.now());
			}
		} finally {
			await store.mutate(busy.id, { kind: "drop" }, CORE, clock.now());
			await store.mutate(quiet.id, { kind: "drop" }, CORE, clock.now());
		}
	});

	test("reads a note as the Markdown it was typed as, and refuses a target it should", async () => {
		// A note is the one field the page hands to a parser, so what it may become is worth pinning: the kit's inline renderer appends text and
		// four atoms, and a link is made only for a target its policy allows.
		const note =
			"see `retry.ts` and **do not** widen MAX_TRIES — https://example.com/notes and [x](javascript:alert(1))";
		const added = await store.create({ title: "A card with Markdown in a note", paths: [], note }, CORE, clock.now());
		try {
			const page = await openPage();
			await page.click(`.bf-row[data-card="${added.id}"] .bf-row__title`);
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });

			const text = `#card-dialog-notes .board-dialog__note-text`;
			// The atoms the note asked for, and their text without the delimiters that made them.
			expect(await page.$$eval(`${text} code`, (nodes) => nodes.map((node) => node.textContent))).toEqual(["retry.ts"]);
			expect(await page.$$eval(`${text} strong`, (nodes) => nodes.map((node) => node.textContent))).toEqual(["do not"]);
			const links = await page.$$eval(`${text} a`, (nodes) =>
				nodes.map((node) => ({ text: node.textContent ?? "", href: node.getAttribute("href") ?? "" })),
			);
			expect(links).toEqual([{ text: "https://example.com/notes", href: "https://example.com/notes" }]);
			// The renderer is the dialog's own: the page's globals stay the runtime's bodies, so a fragment cannot reach a helper the dialog happens to
			// carry.
			expect(await page.evaluate(() => typeof (globalThis as unknown as { renderInline?: unknown }).renderInline)).toBe(
				"undefined",
			);
			// The refused target is still readable, as the text it was: no anchor was made for it.
			expect(await page.textContent(text)).toContain("[x](javascript:alert(1))");
			expect(await page.$$eval(`${text} [href^="javascript:"]`, (nodes) => nodes.length)).toBe(0);
			await page.keyboard.press("Escape");
		} finally {
			await store.mutate(added.id, { kind: "drop" }, CORE, clock.now());
		}
	});

	test("marks the card the reader is on, and the ones they have read", async () => {
		const page = await openPage();
		const markOf = (id: string): Promise<{ current: string | null; visited: string | null }> =>
			page.$eval(`.bf-row[data-card="${id}"]`, (node) => ({
				current: node.getAttribute("data-current"),
				visited: node.getAttribute("data-visited"),
			}));

		// j lands on the first drawn card, and the mark follows focus rather than the key.
		await page.keyboard.press("j");
		expect(await markOf("1")).toEqual({ current: "true", visited: null });

		// Opening it is reading it, and Esc leaves the reader where they were rather than at the top of the lane.
		await page.keyboard.press("Enter");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		await page.keyboard.press("Escape");
		expect(await markOf("1")).toEqual({ current: "true", visited: "true" });

		// The next step moves the mark one card on and leaves the read one behind it, which is the place a wrap used to lose.
		await page.keyboard.press("j");
		expect(await markOf("1")).toEqual({ current: null, visited: "true" });
		expect(await markOf("2")).toEqual({ current: "true", visited: null });

		// k walks back, and the card is current again with its read mark intact.
		await page.keyboard.press("k");
		expect(await markOf("1")).toEqual({ current: "true", visited: "true" });
	});

	test("keeps a 24px target and a whole lane switch on a phone", async () => {
		const page = await openPage();
		// The fold control is the head's only action, and the height a pointer aims at is the box.
		const toggle = await (await page.$("#lane-head-plan"))?.boundingBox();
		expect(Math.round(toggle?.height ?? 0)).toBeGreaterThanOrEqual(24);

		// 320px: the five lane buttons wrap, so none of them — least of all the pressed one — is out of reach without a sideways scroll nobody can
		// see. The picker is the Board tab's, so this stays on it rather than leaving the tab switch for a tab that has no picker.
		await page.setViewportSize({ width: 320, height: 720 });
		await page.waitForTimeout(200);
		const picker = await page.evaluate(() => {
			const box = (
				globalThis as unknown as { document: { getElementById(id: string): ElementLike | null } }
			).document.getElementById("board-picker");
			return { scrollWidth: box?.scrollWidth ?? 0, clientWidth: box?.clientWidth ?? 0 };
		});
		expect(picker.scrollWidth).toBeLessThanOrEqual(picker.clientWidth + 1);
	});

	test("says an offer nobody took, in the words the queue uses", async () => {
		// The offer is `team`'s verb; what the page owes a lead is the age, because that is the difference between nobody having looked and nobody
		// taking it.
		const now = clock.now();
		await store.mutate("1", { kind: "offer" }, LEAD, now - 45_000);
		try {
			const page = await openPage();
			const reason = await page.$eval('#lane-backlog .bf-row[data-card="1"] .bf-row__reason', (node) => ({
				text: node.textContent ?? "",
				tone: node.getAttribute("data-tone"),
			}));
			// The age is the browser's clock against the fixture's fixed one, so the test pins the sentence's shape and the fact; the age rule itself
			// is `formatAge`'s own unit test, which is the only place it can be pinned without a clock.
			expect(reason.text).toMatch(/^offered \d+[a-z] ago \u2014 nobody took it$/);
			// An offer is merely true of the card: the tone table draws it muted, not urgent.
			expect(reason.tone).toBe("muted");
		} finally {
			// A claim answers the offer; the release then leaves the card as the fixture had it.
			await store.mutate("1", { kind: "claim" }, LEAD, now);
			await store.mutate("1", { kind: "release" }, LEAD, now);
		}
	});

	test("shows a card another session writes, without a reload", async () => {
		const page = await openPage();
		const added = await store.create({ title: "A card another session added", paths: [] }, CORE, clock.now());
		try {
			await page.waitForFunction(
				() =>
					Array.from(
						(globalThis as unknown as { document: Doc }).document.querySelectorAll("#lane-backlog .bf-row__title"),
					).some((node) => node.textContent === "A card another session added"),
				undefined,
				{ timeout: PAINT_MS },
			);
		} finally {
			await store.mutate(added.id, { kind: "drop" }, CORE, clock.now());
		}
	});

	test("keeps a path longer than the row inside it, and the whole value on its title", async () => {
		const page = await openPage();
		// A path with no break opportunity, longer than any lane: a one-line, nowrap tag used to spill out of the row and over the lane beside it.
		const path = `src/billing/reconciliation/legacy-adapter/compat/shim/${"x".repeat(90)}/index.ts`;
		const added = await store.create({ title: "A card with a long hint", paths: [path] }, CORE, clock.now());
		try {
			const chip = page.locator(`.bf-row[data-card="${added.id}"] .board-row__paths .bf-tag`);
			await chip.waitFor({ timeout: PAINT_MS });
			expect(await chip.getAttribute("title")).toBe(path);
			const spills = await page.$$eval(".bf-row", (rows) =>
				Array.from(rows as ArrayLike<ElementLike>)
					.filter((row) => row.scrollWidth > row.clientWidth + 1)
					.map((row) => row.getAttribute("data-card") ?? "?"),
			);
			expect(spills).toEqual([]);
		} finally {
			await store.mutate(added.id, { kind: "drop" }, CORE, clock.now());
		}
	});

	test("names the repository in the header and the root on its hover", async () => {
		const page = await openPage();
		// The toolbar's one permanent fact is the board it is a board of: the file says it, so it is readable before a frame arrives, and the client
		// keeps it true from the snapshot. The seat the page is served as is not a fact about the cards, and the page no longer says it.
		expect(await page.textContent("#board-repo")).toBe(REPO);
		expect(await page.getAttribute("#board-repo", "title")).toBe(ROOT);
		expect(await page.$("#board-me")).toBeNull();
		expect(await page.textContent("header")).not.toContain("team-lead");
	});

	test("names the store, its cards, and its size in the footer — and what it could not read", async () => {
		const page = await openPage();
		const footer = () => page.textContent("#board-where");
		await page.waitForFunction(
			() =>
				(
					(globalThis as unknown as { document: Doc }).document.getElementById("board-where")?.textContent ?? ""
				).includes("cards"),
			undefined,
			{ timeout: PAINT_MS },
		);
		// The name is the header's fact, so the footer starts with the store: one owner per fact.
		expect(await footer()).toContain(`store ${WHERE}`);
		expect(await footer()).not.toContain(REPO);
		expect(await footer()).toContain("10 cards");
		expect(await footer()).not.toContain("could not be read");
		// Nothing is refused, so the line has no second statement to make on hover.
		expect(await page.getAttribute("#board-where", "title")).toBeNull();

		// A file this build cannot read is counted beside the size, and named on the hover with the reason the store refused it: a count alone is a
		// fact a reader cannot act on.
		const unreadable = join(directory, "cards", "0099.json");
		writeFileSync(unreadable, JSON.stringify({ v: 2, id: "99", title: "From a newer build" }));
		try {
			await page.waitForFunction(
				() =>
					(
						(globalThis as unknown as { document: Doc }).document.getElementById("board-where")?.textContent ?? ""
					).includes("could not be read"),
				undefined,
				{ timeout: PAINT_MS },
			);
			expect(await footer()).toContain("1 file could not be read");
			const title = (await page.getAttribute("#board-where", "title")) ?? "";
			expect(title).not.toContain(ROOT);
			expect(title).toContain("0099.json");
			expect(title).toContain("not a card record");
		} finally {
			rmSync(unreadable, { force: true });
		}
	});

	test(
		"pins the lead first, folds the owners nothing answers to, and keeps a frame still",
		async () => {
			// A long history: three labels that finished and are gone, one that still holds a card, and the two sessions that are here.
			const folder = mkdtempSync(join(tmpdir(), "pi-board-history-"));
			// The lead is a configured name, not whoever happened to claim a card: the pin is read from the config.
			const history = createStore(folder, { config: boardConfig({ lead: "team-lead" }) });
			await history.ensure();
			const at = clock.now();
			// A heartbeat rewrites `lastSeen` without changing one printed fact; mail is a fact the roster's signature does watch.
			let beat = 0;
			let mail = 0;
			const gone = ["billing-old", "billing-older", "billing-oldest"].map((label, index) => ({
				id: `s-gone-${index}`,
				label,
			}));
			for (const [index, owner] of gone.entries()) {
				const cards = index === 0 ? 3 : 2;
				for (let n = 0; n < cards; n++) {
					const card = await history.create(
						{ title: `${owner.label} shipped ${n}`, paths: [] },
						owner,
						at - index * 1_000,
					);
					await advance(history, card.id, "done", { owner }, at - index * 1_000 + 1);
				}
			}
			const holder: Actor = { id: "s-holder", label: "billing-holder" };
			const held = await history.create({ title: "A card nobody answers for", paths: [] }, holder, at);
			await history.mutate(held.id, { kind: "claim" }, holder, at);

			const sessions = (when: number): RosterSession[] => [
				{ id: "s-peer", label: "billing-peer", mode: "tui", lastSeen: when - 20_000 + beat, mail },
				{
					id: "s-lead",
					label: "team-lead",
					mode: "tui",
					lastSeen: when - 10_000 + beat,
					mail: 0,
					watching: { armed: true, wake: true },
				},
			];
			const long = await serveBoardPage({
				store: history,
				now: clock.now,
				roster: sessions,
				waiting: () => [
					{
						id: "m-1",
						from: "s-peer",
						fromLabel: "billing-peer",
						kind: "handoff",
						to: ["billing-holder"],
						text: "take the unowned card",
						at: at - 240_000,
					},
				],
				display: { repo: REPO, root: ROOT, where: WHERE },
			});
			const page = await board.tab(`${long.url}&view=team`);
			try {
				await page.waitForSelector(".board-agent", { timeout: PAINT_MS });
				const rows = () => page.$$eval(".board-agent", (nodes) => nodes.length);
				const names = () =>
					page.$$eval(".board-agent__name", (nodes) =>
						Array.from(nodes as ArrayLike<ElementLike>, (node) => node.textContent ?? ""),
					);
				// The lead is the first row however the bus orders them, and it says so.
				expect((await names())[0]).toBe("team-lead");
				expect(await page.getAttribute(".board-agent", "data-lead")).toBe("1");
				expect(await rows()).toBe(4);
				const history = '.board-fold[data-fold="team-history"]';
				expect((await page.textContent(history))?.trim()).toBe("3 owners with no record · 7 done");
				expect(await page.getAttribute(history, "aria-expanded")).toBe("false");
				// The waiting row carries its recipient's state, which is the point of drawing it.
				expect(await page.textContent(".board-mail")).toContain("billing-peer");
				expect(await page.textContent(".board-mail")).toContain("billing-holder");
				expect(await page.getAttribute(".board-mail .board-dot", "data-state")).toBe("absent");

				// A frame that changes nothing in a column leaves its fold alone: a live row prints no age, so a heartbeat is not in the signature.
				const agentsSig = () =>
					page.$eval('.board-team__column[data-column="agents"]', (node) => node.getAttribute("data-sig"));
				const settled = await agentsSig();
				beat += 10_000;
				await page.waitForTimeout(1_100);
				expect(await agentsSig()).toBe(settled);

				// The filter narrows cards, so the roster stands still: only the middle column empties, and the fold stays shut.
				await page.fill("#board-filter", "billing-old");
				await page.waitForSelector('[data-pane="needs-you"]:has-text("nothing matches")', { timeout: PAINT_MS });
				expect(await rows()).toBe(4);
				expect(await page.getAttribute(history, "aria-expanded")).toBe("false");
				expect(await agentsSig()).toBe(settled);

				// Mail is a fact the column does not print, and the roster's own chip is: it arrives on the next frame without anyone reloading.
				await page.fill("#board-filter", "");
				mail = 1;
				await page.waitForFunction(
					() =>
						(
							(globalThis as unknown as { document: Doc }).document.querySelector(".board-agent__mail")?.textContent ??
							""
						).includes("1 mail"),
					undefined,
					{ timeout: PAINT_MS },
				);
				expect(await agentsSig()).not.toBe(settled);
			} finally {
				await long.close();
				rmSync(folder, { recursive: true, force: true });
			}
		},
		CASE_MS,
	);
});
