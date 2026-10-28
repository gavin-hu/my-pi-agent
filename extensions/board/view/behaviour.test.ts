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
			path: "~/.pi/agent/plans/8872d3adda0e/2026-10-26-1105-the-card-dialog-reads-like-the-record-it-carries.md",
			goal: "A webhook order is stored once",
			acceptance: "A retried delivery leaves one order",
			scopeOut: "No refunds",
		},
		CORE,
		now - 119_500,
	);
	await store.mutate(doing.id, { kind: "note", text: "no retries yet" }, CORE, now - 118_000);
	await store.mutate(doing.id, { kind: "approve" }, LEAD, now - 118_500);
	await store.mutate(doing.id, { kind: "move", lane: "execute" }, CORE, now - 118_000);
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
			await page.click('#lane-backlog .board-card__title:text-is("Export orders as CSV")');
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
			expect(await page.textContent("#card-dialog-dependents")).toBe("#2 (backlog)");
			expect(await hidden(page, "#card-dialog-dependents-label")).toBe(false);
			// The same card waits on nothing, so that row is absent rather than empty.
			expect(await hidden(page, "#card-dialog-depends")).toBe(true);
			await page.keyboard.press("Escape");

			// The dependent's own dialog says the other direction, from the same link.
			await page.click('#lane-backlog .board-card__title:text-is("Invoice totals round the wrong way")');
			await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
			expect(await page.textContent("#card-dialog-depends")).toBe("#1 (backlog)");
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
		expect(await footer()).not.toContain("unreadable");
		// The name fits the line; the path is the hover, which is what tells two clones apart.
		expect(await page.getAttribute("#board-where", "title")).toBe(ROOT);

		// A file this build cannot read is counted beside the size, so a board that is not
		// readable never reads as a board that is empty.
		const unreadable = join(directory, "cards", "0099.json");
		writeFileSync(unreadable, JSON.stringify({ v: 2, id: "99", title: "From a newer build" }));
		try {
			await page.waitForFunction(
				() =>
					(
						(globalThis as unknown as { document: Doc }).document.getElementById("board-where")?.textContent ?? ""
					).includes("unreadable"),
				undefined,
				{ timeout: PAINT_MS },
			);
			expect(await footer()).toContain("1 unreadable");
		} finally {
			rmSync(unreadable, { force: true });
			await page.close();
		}
	});
});
