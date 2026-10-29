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
import { makeClock } from "../../../test/helpers/clock.ts";
import { type Browser, chromium, type Page } from "playwright-core";
import { findChrome } from "../../../scripts/capture/chrome.ts";
import type { Actor } from "../../../lib/board/rules.ts";
import { createStore } from "../../../lib/board/store.ts";
import { advance } from "../../../test/helpers/board-flow.ts";
import type { RosterSession } from "../../../lib/session-roster.ts";
import { serveBoardPage, type ServedBoardPage } from "../../../test/helpers/board-page.ts";

/** The browser this machine has; absent means the whole suite is skipped. */
const CHROME = findChrome();

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const CORE: Actor = { id: "s-core", label: "billing-core" };

/** How long a page gets to show what the fixture holds. */
const PAINT_MS = 10_000;

let directory = "";
let browser: Browser;
let server: ServedBoardPage;
let store: ReturnType<typeof createStore>;

/**
 * The board the page serves: two cards to do, one being worked, and seven finished.
 *
 * Seven rather than six is what puts the Done lane past its fold, which is a lane's
 * state the reader has to click to see.
 */
async function seedBoard(): Promise<void> {
	store = createStore(directory);
	await store.ensure();
	const now = clock.now();
	const todo = [
		{ title: "Export orders as CSV", paths: ["src/reports"] },
		{ title: "Invoice totals round the wrong way", paths: ["src/billing/totals"] },
	];
	for (const [index, spec] of todo.entries()) {
		await store.create({ ...spec, note: "from the support thread" }, LEAD, now - index * 60_000);
	}
	const doing = await store.create(
		{
			title: "Billing webhook accepts orders",
			paths: ["src/billing", "src/api"],
			note: "routes wired",
			priority: "high",
		},
		LEAD,
		now - 120_000,
	);
	await store.mutate(doing.id, { kind: "claim" }, CORE, now - 119_000);
	// A contract and its approval, so the card can be executing: the page draws the plan
	// path from the dialog's ladder, and the lane the gates put it in.
	await store.mutate(
		doing.id,
		{
			kind: "contract",
			artifact: {
				path: "~/.pi/agent/plans/8872d3adda0e/2026-10-26-1105-the-card-dialog-reads-like-the-record-it-carries.md",
			},
			goal: "A webhook order is stored once",
			acceptance: "A retried delivery leaves one order",
			scopeOut: "No refunds",
		},
		CORE,
		now - 119_500,
	);
	await store.mutate(doing.id, { kind: "note", text: "no retries yet" }, CORE, now - 118_000);
	await store.mutate(doing.id, { kind: "approve" }, LEAD, now - 118_500);
	await store.mutate(
		doing.id,
		{
			kind: "move",
			lane: "execute",
			artifact: {
				path: "~/.pi/agent/plans/8872d3adda0e/2026-10-26-1105-the-card-dialog-reads-like-the-record-it-carries.md",
			},
		},
		CORE,
		now - 118_000,
	);
	for (let index = 1; index <= 7; index++) {
		const card = await store.create(
			{ title: `Shipped change ${index}`, paths: ["src/old"] },
			LEAD,
			now - index * 300_000,
		);
		await advance(store, card.id, "done", { owner: CORE, reviewer: LEAD }, now - index * 300_000 + 1_000);
	}
}

/** The store's own path and the repository it belongs to, as the page is told them. */
const WHERE = "~/.pi/agent/board/behaviour";
const ROOT = "/Users/someone/my-pi-agent";
const REPO = "my-pi-agent";

/** One fresh tab on the served page, waited until its lanes have painted. */
async function openPage(): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
	await page.goto(server.url, { waitUntil: "load" });
	await page.waitForSelector("#lane-backlog .board-card", { timeout: PAINT_MS });
	return page;
}

/**
 * The sliver of the DOM the predicates below read.
 *
 * This project's TypeScript has no DOM lib — the client is a string, so nothing here
 * ever compiled against one — and a predicate handed to Playwright is serialized into
 * the page, so it cannot close over a helper either. Each one therefore reaches the
 * document through this shape by name, inside its own body.
 */
interface Doc {
	querySelectorAll(selector: string): ArrayLike<ElementLike>;
	getElementById(id: string): ElementLike | null;
	/** What the tab strip shows: the page's own name, once a frame has painted it. */
	title: string;
}

interface ElementLike {
	textContent: string | null;
	hidden: boolean;
	/** The box a child can overflow: a card whose content spills has the larger scroll width. */
	scrollWidth: number;
	clientWidth: number;
	getAttribute(name: string): string | null;
	/** The last child of the meta's notes chip: the age the ticker rewrites. */
	lastElementChild: ElementLike | null;
}

/** Whether an element the page hides with the `hidden` attribute is hidden. */
async function hidden(page: Page, selector: string): Promise<boolean> {
	return page.$eval(selector, (node) => (node as unknown as ElementLike).hidden);
}

/**
 * The id and class of whatever has focus.
 *
 * The trap moves focus itself, so asserting where it landed is the only way to see it:
 * a page can look modal while the keyboard is behind the scrim.
 */
async function focusedId(page: Page): Promise<string> {
	return page.evaluate(
		() =>
			(
				globalThis as unknown as { document: { activeElement: ElementLike | null } }
			).document.activeElement?.getAttribute("id") ?? "",
	);
}

/** The class list of whatever has focus, when the element has no id of its own. */
async function focusedClass(page: Page): Promise<string> {
	return page.evaluate(
		() =>
			(
				globalThis as unknown as { document: { activeElement: ElementLike | null } }
			).document.activeElement?.getAttribute("class") ?? "",
	);
}

/** The titles a lane currently shows, in the order it shows them. */
async function titlesIn(page: Page, lane: string): Promise<string[]> {
	return page.$$eval(`#lane-${lane} .board-card__title`, (nodes) =>
		Array.from(nodes as ArrayLike<ElementLike>, (node) => node.textContent ?? ""),
	);
}

/** One lane's card count, as the page sees it: a predicate, evaluated in the page. */
async function cardCount(page: Page, lane: string, count: number): Promise<void> {
	await page.waitForFunction(
		({ lane, count }) =>
			(globalThis as unknown as { document: Doc }).document.querySelectorAll(`#lane-${lane} .board-card`).length ===
			count,
		{ lane, count },
		{ timeout: PAINT_MS },
	);
}

describe.skipIf(CHROME === undefined)("the served page", () => {
	beforeAll(async () => {
		directory = mkdtempSync(join(tmpdir(), "pi-board-page-"));
		await seedBoard();
		// The shipped page over this store: the one boot a caller outside the extension needs.
		server = await serveBoardPage({
			store,
			now: clock.now,
			display: { repo: REPO, root: ROOT, where: WHERE },
		});
		browser = await chromium.launch({ executablePath: CHROME, headless: true });
	});

	afterAll(async () => {
		await browser?.close();
		await server?.close();
		if (directory !== "") rmSync(directory, { recursive: true, force: true });
	});

	test("draws each lane with the cards the store holds", async () => {
		const page = await openPage();
		expect((await titlesIn(page, "backlog")).sort()).toEqual([
			"Export orders as CSV",
			"Invoice totals round the wrong way",
		]);
		expect(await titlesIn(page, "execute")).toEqual(["Billing webhook accepts orders"]);
		// Past six finished cards the lane starts folded, so its cards are in the document
		// but hidden: a reader clicks the head to see them.
		expect(await page.$eval("#lane-head-done", (node) => node.getAttribute("aria-expanded"))).toBe("false");
		expect(await hidden(page, "#lane-done")).toBe(true);
		await page.close();
	});

	test("names itself in the tab, and links the mark the header draws", async () => {
		const page = await openPage();
		// A tab is read from a strip of other tabs: the repository's own name tells two boards
		// apart, and the count is the reason a tab is read at all. Both need the store, so the
		// client paints them; the head's `board` is what a tab shows before the first frame.
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

		// And the browser draws it under the page's own CSP: an icon it refused, or a URI it
		// could not parse, would report no width at all.
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
		await page.close();
	});

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

	test("reads the card as a ladder of facts, one row each", async () => {
		const page = await openPage();
		await page.click("#lane-execute .board-card__title");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-id")).toBe("#3");
		// The age is the page's own clock, not the seed's, so only its shape is asserted.
		expect(await page.textContent("#card-dialog-updated")).toMatch(/^\d+[mhd]$|^\d+d$/);
		expect(await page.textContent("#card-dialog-by")).toBe("billing-core");
		expect(await page.textContent("#card-dialog-priority")).toBe("high");
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

		// The notes are the record: each sentence with its attribution under it, and the
		// section's heading carries the count. Body size is a stylesheet claim, held by
		// `pages.test.ts` where the CSS is.
		expect(await page.$$eval("#card-dialog-notes .board-dialog__note", (nodes) => nodes.length)).toBe(2);
		expect(await page.$$eval("#card-dialog-notes .board-dialog__note-foot", (nodes) => nodes.length)).toBe(2);
		expect(await page.textContent("#card-dialog-note-count")).toContain("2");
		expect(await page.$$eval("#card-dialog-path-list .board-dialog__path", (nodes) => nodes.length)).toBe(2);
		await page.close();
	});

	test("says how long the card has been in its lane", async () => {
		// The fixture files a note and a plan against the doing card after the claim, so
		// `updatedAt` and the lane entry are different moments: the row that says how long
		// the lane has held cannot be reading the last write.
		const page = await openPage();
		await page.click('#lane-execute .board-card__title:text-is("Billing webhook accepts orders")');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-lane")).toMatch(/^execute · /);
		expect(await hidden(page, "#card-dialog-lane-label")).toBe(false);
		// A card nobody has taken says the same about the lane it was born in.
		await page.keyboard.press("Escape");
		await page.click('#lane-backlog .board-card__title:text-is("Export orders as CSV")');
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-lane")).toMatch(/^backlog · /);
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
			// The face says it too, and names the card rather than its id: a lead reading a lane
			// decides on that, and the dialog was the only place it lived.
			expect(await page.textContent('#lane-backlog .board-card[data-card="1"] .board-card__holds')).toBe(
				"holds up #2 (backlog) Invoice totals round the wrong way",
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

	test("filters on a note's words, which the tool's query reads too", async () => {
		const page = await openPage();
		// Nothing on the card's face says "retries": the word lives in a note, and the
		// filter runs the module's own predicate rather than a copy of it.
		await page.fill("#board-filter", "retries");
		await cardCount(page, "execute", 1);
		expect(await titlesIn(page, "execute")).toEqual(["Billing webhook accepts orders"]);
		await cardCount(page, "backlog", 0);
		await page.close();
	});

	test("narrows the lanes from the one filter box", async () => {
		const page = await openPage();
		await page.fill("#board-filter", "invoice");
		await cardCount(page, "backlog", 1);
		expect(await titlesIn(page, "backlog")).toEqual(["Invoice totals round the wrong way"]);
		expect(await titlesIn(page, "execute")).toEqual([]);
		// Clearing it puts the board back: the filter is a view, never a store read.
		await page.fill("#board-filter", "");
		await cardCount(page, "backlog", 2);
		await page.close();
	});

	test("folds Done past six cards, and unfolds it on a click", async () => {
		const page = await openPage();
		await page.click("#lane-head-done");
		await cardCount(page, "done", 7);
		expect(await hidden(page, "#lane-done")).toBe(false);
		expect(await page.$eval("#lane-head-done", (node) => node.getAttribute("aria-expanded"))).toBe("true");

		await page.click("#lane-head-done");
		expect(await hidden(page, "#lane-done")).toBe(true);
		await page.close();
	});

	test("switches lanes from the picker when the board is one column", async () => {
		const page = await openPage();
		await page.setViewportSize({ width: 860, height: 900 });
		await page.waitForTimeout(200);
		expect(await page.isVisible("#board-picker")).toBe(true);
		// The picker names the lane it is showing through aria-pressed, and the other lanes are
		// out of the document's flow: one column, one lane.
		expect(await page.$eval('[data-picker-lane="backlog"]', (n) => n.getAttribute("aria-pressed"))).toBe("true");
		await page.click('[data-picker-lane="execute"]');
		// The picker shows one tray; a lane's list is the fold's own state, so the wait is on the
		// section a reader sees rather than on the list inside it.
		await page.waitForFunction(
			() =>
				(
					globalThis as unknown as {
						document: { querySelector(selector: string): { hidden: boolean } | null };
					}
				).document.querySelector('.board-lane[data-lane="backlog"]')?.hidden === true,
			undefined,
			{ timeout: PAINT_MS },
		);
		expect(await page.isVisible('.board-lane[data-lane="execute"]')).toBe(true);
		expect(await page.$eval('[data-picker-lane="execute"]', (n) => n.getAttribute("aria-pressed"))).toBe("true");
		expect(await page.$eval('[data-picker-lane="backlog"]', (n) => n.getAttribute("aria-pressed"))).toBe("false");
		await page.close();
	});

	test("names a lane's count in words, so the heading is not one glued word", async () => {
		const page = await openPage();
		expect(
			await page.$eval('.board-lane[data-lane="backlog"] .board-lane__head', (n) => n.getAttribute("aria-label")),
		).toBe("Backlog, 2 cards");
		// A pulled lane says the limit the pill prints as `0/3`.
		expect(
			await page.$eval('.board-lane[data-lane="plan"] .board-lane__head', (n) => n.getAttribute("aria-label")),
		).toBe("Plan, 0 of 3");

		// A filtered lane names what it shows against the cards it holds, not the limit.
		await page.fill("#board-filter", "invoice");
		await cardCount(page, "backlog", 1);
		expect(
			await page.$eval('.board-lane[data-lane="backlog"] .board-lane__head', (n) => n.getAttribute("aria-label")),
		).toBe("Backlog, 1 of 2");

		// The Team tab's two captions carry their count the same way.
		await page.fill("#board-filter", "");
		await page.keyboard.press("t");
		const captions = await page.$$eval(".board-team__caption", (nodes) =>
			Array.from(nodes as ArrayLike<ElementLike>, (node) => node.getAttribute("aria-label") ?? ""),
		);
		expect(captions[0]).toMatch(/^Needs a decision, \d+$/);
		expect(captions[1]).toMatch(/^Teammates, \d+$/);
		await page.close();
	});

	test("says when the filter matches nothing, and gives the way back", async () => {
		const page = await openPage();
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
		await cardCount(page, "backlog", 2);
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
		await page.close();
	});

	test("says what a card's age is, on the hover, and keeps it honest", async () => {
		const page = await openPage();
		const age = await page.$eval("#lane-execute .board-card .board-card__meta [data-at]", (n) => ({
			text: n.textContent ?? "",
			title: n.getAttribute("title") ?? "",
		}));
		// The text is the compact age the row needs; the hover is the same fact in a sentence.
		expect(age.text).toMatch(/^\d+[mhd]$|^now$/);
		expect(age.title).toMatch(/^updated (just now|\d+[mhd] ago)$/);
		await page.close();
	});

	test("wears its priority and its paths as fields, not as prose", async () => {
		const page = await openPage();
		// The executing card is the seeded one with a priority, so its meta line is the case.
		expect(
			await page.$eval("#lane-execute .board-card .board-card__meta .bf-chip--outline", (n) => n.textContent),
		).toBe("high");
		// A path is a value a reader types, so it wears the dialog's mono face on the card too.
		const mono = await page.$eval("#lane-execute .board-card .board-card__paths .bf-chip", (n) =>
			(globalThis as unknown as { getComputedStyle(node: ElementLike): { fontFamily: string } })
				.getComputedStyle(n)
				.fontFamily.toLowerCase(),
		);
		expect(mono).toContain("mono");
		await page.close();
	});

	test("names the hints behind its +N chip, and lists them for a reader who never hovers", async () => {
		const hints = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"];
		const added = await store.create({ title: "A card with five hints", paths: hints }, CORE, clock.now());
		try {
			const page = await openPage();
			const card = `.board-card[data-card="${added.id}"]`;
			await page.waitForSelector(`${card} .board-card__paths`, { timeout: PAINT_MS });

			// The chip used to be a bare count: the hints past the third lived only in the dialog.
			const rest = await page.$eval(`${card} .board-card__paths .bf-chip[aria-hidden="true"]`, (node) => ({
				text: node.textContent ?? "",
				title: node.getAttribute("title") ?? "",
			}));
			expect(rest.text).toBe("+2");
			expect(rest.title).toBe("src/d.ts\nsrc/e.ts");

			// And they are in the list, as text a screen reader reads and the title describes.
			const listed = await page.$$eval(`${card} .board-card__paths .sr-only`, (nodes) =>
				Array.from(nodes as ArrayLike<ElementLike>, (node) => node.textContent ?? ""),
			);
			expect(listed).toEqual(["src/d.ts", "src/e.ts"]);
			expect(await page.getAttribute(`${card} .board-card__title`, "aria-describedby")).toBe(`card-paths-${added.id}`);
			await page.close();
		} finally {
			await store.mutate(added.id, { kind: "drop" }, CORE, clock.now());
		}
	});

	test("describes the reason a clamped card cannot show, so the keyboard reaches it", async () => {
		const page = await openPage();
		// The reason line clamps, and its whole sentence is only on a hover title, which j/k
		// never shows: the title button carries the same line as its description, so focusing
		// it — by walking or by Tab — says the sentence a reader came for.
		const id = await page.$eval("#lane-execute .board-card", (node) => node.getAttribute("data-card") ?? "");
		const line = `.board-card[data-card="${id}"] .board-card__reason`;
		const reason = await page.textContent(line);
		expect(reason ?? "").not.toBe("");
		expect(await page.getAttribute(`.board-card[data-card="${id}"] .board-card__title`, "aria-describedby")).toContain(
			`card-reason-${id}`,
		);
		expect(await page.textContent(`#card-reason-${id}`)).toBe(reason ?? "");
		await page.focus(`.board-card[data-card="${id}"] .board-card__title`);
		expect(await focusedClass(page)).toContain("board-card__title");
		await page.close();
	});

	test("says how many notes a card carries, and the last note's age only when it adds a fact", async () => {
		// A note is itself a write, so the newest note is usually the newest stamp on the card:
		// printing its age beside the updated one gave the meta line two identical bare numbers.
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
		// Two days on, so the claim's stamp and the note's read as different ages: the fixture's
		// clock is fixed, and a difference of minutes would round to the same day count.
		await store.mutate(busy.id, { kind: "claim" }, CORE, clock.now() + 2 * 86_400_000);
		try {
			const page = await openPage();
			const quietChip = `.board-card[data-card="${quiet.id}"] .board-card__notes`;
			await page.waitForSelector(quietChip, { timeout: PAINT_MS });
			expect(await page.textContent(quietChip)).toBe("1 note");
			// No stamp of its own, so nothing to keep honest and nothing to hover for.
			expect(await page.$$eval(`${quietChip} [data-at]`, (nodes) => nodes.length)).toBe(0);

			// A later write that is not a note leaves the two ages saying different things, so
			// the note's own earns its place: it says when the conversation went quiet, which
			// the card's updated stamp cannot.
			const busyChip = `.board-card[data-card="${busy.id}"] .board-card__notes`;
			const updated = await page.textContent(`.board-card[data-card="${busy.id}"] .board-card__meta [data-at]`);
			const written = await page.textContent(busyChip);
			expect(written).toMatch(/^1 note \u00b7 \d+[a-z]+$/);
			expect(written).not.toBe(`1 note \u00b7 ${updated}`);
			expect(await page.$eval(`${busyChip} [data-at]`, (node) => node.getAttribute("data-at-title") ?? "")).toBe(
				"last note {age} by billing-core",
			);

			// A card nobody has annotated draws nothing at all rather than "0 notes".
			const bare = await store.create({ title: "A card with no history", paths: [] }, CORE, clock.now());
			try {
				await page.waitForSelector(`.board-card[data-card="${bare.id}"]`, { timeout: PAINT_MS });
				expect(
					await page.$$eval(`.board-card[data-card="${bare.id}"] .board-card__notes`, (nodes) => nodes.length),
				).toBe(0);
			} finally {
				await store.mutate(bare.id, { kind: "drop" }, CORE, clock.now());
			}
			await page.close();
		} finally {
			await store.mutate(busy.id, { kind: "drop" }, CORE, clock.now());
			await store.mutate(quiet.id, { kind: "drop" }, CORE, clock.now());
		}
	});

	test("reads a note as the Markdown it was typed as, and refuses a target it should", async () => {
		// A note is the one field the page hands to a parser, so what it may become is worth
		// pinning: the kit's inline renderer appends text and four atoms, and a link is made
		// only for a target its policy allows.
		const note =
			"see `retry.ts` and **do not** widen MAX_TRIES — https://example.com/notes and [x](javascript:alert(1))";
		const added = await store.create({ title: "A card with Markdown in a note", paths: [], note }, CORE, clock.now());
		try {
			const page = await openPage();
			await page.click(`.board-card[data-card="${added.id}"] .board-card__title`);
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });

			const text = `#card-dialog-notes .board-dialog__note-text`;
			// The atoms the note asked for, and their text without the delimiters that made them.
			expect(await page.$$eval(`${text} code`, (nodes) => nodes.map((node) => node.textContent))).toEqual(["retry.ts"]);
			expect(await page.$$eval(`${text} strong`, (nodes) => nodes.map((node) => node.textContent))).toEqual(["do not"]);
			const links = await page.$$eval(`${text} a`, (nodes) =>
				nodes.map((node) => ({ text: node.textContent ?? "", href: node.getAttribute("href") ?? "" })),
			);
			expect(links).toEqual([{ text: "https://example.com/notes", href: "https://example.com/notes" }]);
			// The renderer is the dialog's own: the page's globals stay the runtime's bodies, so a
			// fragment cannot reach a helper the dialog happens to carry.
			expect(await page.evaluate(() => typeof (globalThis as unknown as { renderInline?: unknown }).renderInline)).toBe(
				"undefined",
			);
			// The refused target is still readable, as the text it was: no anchor was made for it.
			expect(await page.textContent(text)).toContain("[x](javascript:alert(1))");
			expect(await page.$$eval(`${text} [href^="javascript:"]`, (nodes) => nodes.length)).toBe(0);
			await page.keyboard.press("Escape");
			await page.close();
		} finally {
			await store.mutate(added.id, { kind: "drop" }, CORE, clock.now());
		}
	});

	test("marks the card the reader is on, and the ones they have read", async () => {
		const page = await openPage();
		const markOf = (id: string): Promise<{ current: string | null; visited: string | null }> =>
			page.$eval(`.board-card[data-card="${id}"]`, (node) => ({
				current: node.getAttribute("data-current"),
				visited: node.getAttribute("data-visited"),
			}));

		// j lands on the first drawn card, and the mark follows focus rather than the key.
		await page.keyboard.press("j");
		expect(await markOf("1")).toEqual({ current: "true", visited: null });

		// Opening it is reading it, and Esc leaves the reader where they were rather than
		// at the top of the lane.
		await page.keyboard.press("Enter");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		await page.keyboard.press("Escape");
		expect(await markOf("1")).toEqual({ current: "true", visited: "true" });

		// The next step moves the mark one card on and leaves the read one behind it, which
		// is the place a wrap used to lose.
		await page.keyboard.press("j");
		expect(await markOf("1")).toEqual({ current: null, visited: "true" });
		expect(await markOf("2")).toEqual({ current: "true", visited: null });

		// k walks back, and the card is current again with its read mark intact.
		await page.keyboard.press("k");
		expect(await markOf("1")).toEqual({ current: "true", visited: "true" });
		await page.close();
	});

	test("keeps a 24px target and a whole lane switch on a phone", async () => {
		const page = await openPage();
		// The fold control is the head's only action, and the height a pointer aims at is the box.
		const toggle = await (await page.$("#lane-head-plan"))?.boundingBox();
		expect(Math.round(toggle?.height ?? 0)).toBeGreaterThanOrEqual(24);

		// A finished card's id opens its record from the Team tab's strip.
		await page.keyboard.press("t");
		const doneId = await (await page.$(".board-team__id"))?.boundingBox();
		expect(Math.round(doneId?.height ?? 0)).toBeGreaterThanOrEqual(24);

		// 320px: the five lane buttons wrap, so none of them — least of all the pressed one — is
		// out of reach without a sideways scroll nobody can see.
		await page.keyboard.press("t");
		await page.setViewportSize({ width: 320, height: 720 });
		await page.waitForTimeout(200);
		const picker = await page.evaluate(() => {
			const box = (
				globalThis as unknown as { document: { getElementById(id: string): ElementLike | null } }
			).document.getElementById("board-picker");
			return { scrollWidth: box?.scrollWidth ?? 0, clientWidth: box?.clientWidth ?? 0 };
		});
		expect(picker.scrollWidth).toBeLessThanOrEqual(picker.clientWidth + 1);
		await page.close();
	});

	test("says an offer nobody took, in the words the queue uses", async () => {
		// The offer is `team`'s verb; what the page owes a lead is the age, because that is
		// the difference between nobody having looked and nobody taking it.
		const now = clock.now();
		await store.mutate("1", { kind: "offer" }, LEAD, now - 45_000);
		try {
			const page = await openPage();
			const reason = await page.$eval('#lane-backlog .board-card[data-card="1"] .board-card__reason', (node) => ({
				text: node.textContent ?? "",
				tone: node.className,
			}));
			// The age is the browser's clock against the fixture's fixed one, so the test pins
			// the sentence's shape and the fact; the age rule itself is `formatAge`'s own unit
			// test, which is the only place it can be pinned without a clock.
			expect(reason.text).toMatch(/^offered \d+[a-z] ago \u2014 nobody took it$/);
			expect(reason.tone).toContain("board-card__reason");
			await page.close();
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
						(globalThis as unknown as { document: Doc }).document.querySelectorAll("#lane-backlog .board-card__title"),
					).some((node) => node.textContent === "A card another session added"),
				undefined,
				{ timeout: PAINT_MS },
			);
		} finally {
			await store.mutate(added.id, { kind: "drop" }, CORE, clock.now());
			await page.close();
		}
	});

	test("keeps a path longer than the card inside it, and the whole value on its title", async () => {
		const page = await openPage();
		// A path with no break opportunity, longer than any lane: a one-line, nowrap chip used to
		// spill out of the card and over the lane beside it.
		const path = `src/billing/reconciliation/legacy-adapter/compat/shim/${"x".repeat(90)}/index.ts`;
		const added = await store.create({ title: "A card with a long hint", paths: [path] }, CORE, clock.now());
		try {
			const chip = page.locator(`.board-card[data-card="${added.id}"] .board-card__paths .bf-chip`);
			await chip.waitFor({ timeout: PAINT_MS });
			expect(await chip.getAttribute("title")).toBe(path);
			const spills = await page.$$eval(".board-card", (cards) =>
				Array.from(cards as ArrayLike<ElementLike>)
					.filter((card) => card.scrollWidth > card.clientWidth + 1)
					.map((card) => card.getAttribute("data-card") ?? "?"),
			);
			expect(spills).toEqual([]);
		} finally {
			await store.mutate(added.id, { kind: "drop" }, CORE, clock.now());
			await page.close();
		}
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
		expect(await footer()).toContain(`my-pi-agent · store ${WHERE}`);
		expect(await footer()).toContain("10 cards");
		expect(await footer()).not.toContain("could not be read");
		// The name fits the line; the path is the hover, which is what tells two clones apart.
		expect(await page.getAttribute("#board-where", "title")).toBe(ROOT);

		// A file this build cannot read is counted beside the size, and named on the hover with
		// the reason the store refused it: a count alone is a fact a reader cannot act on.
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
			expect(await footer()).toContain("1 card could not be read");
			const title = (await page.getAttribute("#board-where", "title")) ?? "";
			expect(title).toContain(ROOT);
			expect(title).toContain("0099.json");
			expect(title).toContain("not a card record");
		} finally {
			rmSync(unreadable, { force: true });
			await page.close();
		}
	});

	test("folds the owners a bus has no record of, and the ids past the strip's sixth", async () => {
		// A board with a long history: three labels that finished their work and are gone, one
		// that still holds a card, and two sessions that are here. The three are history — the
		// list only grows, which is why the page states them once — and the holder is the row the
		// fold must not take, because the queue is reporting its work as free.
		const folder = mkdtempSync(join(tmpdir(), "pi-board-history-"));
		const history = createStore(folder);
		await history.ensure();
		const at = clock.now();
		// The bus's own clock, moved by hand: a heartbeat rewrites `lastSeen` without changing one
		// printed fact, which is the frame that must leave the roster where the reader put it.
		let beat = 0;
		const gone = ["billing-old", "billing-older", "billing-oldest"].map((label, index) => ({
			id: `s-gone-${index}`,
			label,
		}));
		for (const [index, owner] of gone.entries()) {
			// Seven finished cards in all, so the strip has one id past the sixth it shows.
			const cards = index === 0 ? 3 : 2;
			for (let n = 0; n < cards; n++) {
				const card = await history.create(
					{ title: `${owner.label} shipped ${n}`, paths: [] },
					owner,
					at - index * 1_000,
				);
				await advance(history, card.id, "done", { owner, reviewer: LEAD }, at - index * 1_000 + 1);
			}
		}
		const holder: Actor = { id: "s-holder", label: "billing-holder" };
		const held = await history.create({ title: "A card nobody answers for", paths: [] }, holder, at);
		await history.mutate(held.id, { kind: "claim" }, holder, at);

		const sessions = (when: number): RosterSession[] => [
			{
				id: "s-lead",
				label: "team-lead",
				mode: "tui",
				lastSeen: when - 10_000 + beat,
				mail: 0,
				watching: { armed: true, wake: true },
			},
			{ id: "s-peer", label: "billing-peer", mode: "tui", lastSeen: when - 20_000 + beat, mail: 0 },
		];
		const long = await serveBoardPage({
			store: history,
			now: clock.now,
			roster: sessions,
			display: { repo: REPO, root: ROOT, where: WHERE },
		});
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		try {
			await page.goto(`${long.url}&view=team`, { waitUntil: "load" });
			const rows = () => page.$$eval(".board-team__mate", (nodes) => nodes.length);
			const foldFocus = () =>
				page.evaluate(
					() =>
						(
							globalThis as unknown as { document: { activeElement: ElementLike | null } }
						).document.activeElement?.getAttribute("data-fold") ?? "",
				);
			await page.waitForSelector(".board-team__tail", { timeout: PAINT_MS });

			// Two live rows, the one absent owner that holds a card, and one row for the three that
			// are only history: a panel of six people drawn as four rows.
			expect(await rows()).toBe(4);
			expect((await page.textContent(".board-team__tail"))?.trim()).toBe("3 owners with no record · 7 done");
			expect(await page.getAttribute(".board-team__tail", "aria-expanded")).toBe("false");
			// The absent owner that holds a card is a row of its own, not part of the history: the
			// queue is saying its work is free, and that sentence needs a name beside it.
			expect(await page.textContent(".board-team__roster")).toContain("billing-holder");
			expect(await page.textContent(".board-team__roster")).toContain("1 held");
			// The caption counts people, not rows, so the fold does not change it.
			const caption = () =>
				page.$$eval(".board-team__caption", (nodes) =>
					Array.from(nodes as ArrayLike<ElementLike>, (node) => node.getAttribute("aria-label") ?? ""),
				);
			expect((await caption())[1]).toBe("Teammates, 6");

			// The strip shows six ids and folds the seventh behind its own count.
			expect(await page.$eval("#team-done-ids", (node) => (node as unknown as ElementLike).hidden)).toBe(true);
			expect((await page.textContent(".board-team__fold"))?.trim()).toBe("7 cards");
			expect(await page.getAttribute(".board-team__fold", "aria-expanded")).toBe("false");

			// Opening the history draws the rows it stood for, and puts focus back on the control
			// that was repainted rather than on the document.
			await page.click(".board-team__tail");
			expect(await rows()).toBe(7);
			expect(await page.getAttribute(".board-team__tail", "aria-expanded")).toBe("true");
			expect(await foldFocus()).toBe("team-roster");

			await page.click(".board-team__fold");
			expect(await page.$eval("#team-done-ids", (node) => (node as unknown as ElementLike).hidden)).toBe(false);
			expect(await page.getAttribute(".board-team__fold", "aria-expanded")).toBe("true");
			expect(await foldFocus()).toBe("team-done");

			// A filter is a view of the rows, so it unfolds the history and shows the owners that
			// match instead of saying nobody does.
			await page.fill("#board-filter", "billing-old");
			await page.waitForFunction(
				() => (globalThis as unknown as { document: Doc }).document.querySelectorAll(".board-team__mate").length === 3,
				undefined,
				{ timeout: PAINT_MS },
			);
			expect(await page.$(".board-team__tail")).toBeNull();
			expect((await caption())[1]).toBe("Teammates, 3 of 6");

			// A frame that changes nothing in the roster leaves the reader's fold — and the focus on
			// it — exactly where they left them. The signature carries the minute a quiet row's age
			// falls in, not the raw stamp the bus moves every ten seconds.
			const peopleSig = () =>
				page.$eval(".board-team__group + .board-team__group", (node) => node.getAttribute("data-sig"));
			const frameWith = async (title: string) => {
				// The frame that lands is one the roster does not print, so the footer is what says it
				// arrived: the Team tab is showing, and a lane's card is in a panel that is hidden.
				const was = await page.textContent("#board-where");
				await history.create({ title, paths: [] }, LEAD, clock.now());
				await page.waitForFunction(
					(previous) =>
						((globalThis as unknown as { document: Doc }).document.getElementById("board-where")?.textContent ?? "") !==
						previous,
					was,
					{ timeout: PAINT_MS },
				);
			};
			await page.fill("#board-filter", "");
			await page.waitForSelector(".board-team__tail", { timeout: PAINT_MS });
			await page.click(".board-team__tail");
			expect(await page.getAttribute(".board-team__tail", "aria-expanded")).toBe("false");
			const settled = await peopleSig();

			// A heartbeat: ten seconds on the bus, and not one printed fact.
			beat += 10_000;
			await frameWith("A card in the pool");
			expect(await peopleSig()).toBe(settled);
			expect(await page.getAttribute(".board-team__tail", "aria-expanded")).toBe("false");
			expect(await foldFocus()).toBe("team-roster");

			// Past a minute the printed age moves a unit, so the row is redrawn: a bucket, not a mute.
			beat += 120_000;
			await frameWith("Another card in the pool");
			expect(await peopleSig()).not.toBe(settled);
		} finally {
			await page.close();
			await long.close();
			rmSync(folder, { recursive: true, force: true });
		}
	});
});
