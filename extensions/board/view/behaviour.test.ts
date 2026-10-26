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
import { buildView } from "../../../lib/board/view.ts";
import { pageActor } from "../seat.ts";
import { type BoardServer, createBoardServer } from "../transport/server.ts";
import { BOARD_CLIENT_JS } from "./client.ts";
import { renderBoardPage } from "./page.ts";

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
let server: BoardServer;
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
		{ title: "Billing webhook accepts orders", paths: ["src/billing", "src/api"], note: "routes wired" },
		LEAD,
		now - 120_000,
	);
	await store.mutate(doing.id, { kind: "claim" }, CORE, now - 119_000);
	for (let index = 1; index <= 7; index++) {
		const card = await store.create(
			{ title: `Shipped change ${index}`, paths: ["src/old"] },
			LEAD,
			now - index * 300_000,
		);
		await store.mutate(card.id, { kind: "claim" }, CORE, now - index * 300_000 + 1_000);
		await store.mutate(card.id, { kind: "move", status: "done" }, CORE, now - index * 300_000 + 2_000);
	}
}

/** The snapshot the page renders: the store, read fresh on every frame. */
async function view() {
	const now = clock.now();
	return buildView({
		me: pageActor(),
		cards: await store.list(),
		now,
		bytes: await store.bytes(),
		skipped: (await store.skipped()).length,
		where: "~/.pi/agent/board/behaviour",
	});
}

/** One fresh tab on the served page, waited until its lanes have painted. */
async function openPage(): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
	await page.goto(server.url, { waitUntil: "load" });
	await page.waitForSelector("#lane-todo .board-card", { timeout: PAINT_MS });
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
}

interface ElementLike {
	textContent: string | null;
	hidden: boolean;
	getAttribute(name: string): string | null;
}

/** Whether an element the page hides with the `hidden` attribute is hidden. */
async function hidden(page: Page, selector: string): Promise<boolean> {
	return page.$eval(selector, (node) => (node as unknown as ElementLike).hidden);
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
		server = await createBoardServer({
			ports: [0],
			page: async (tab) => renderBoardPage({ view: tab }),
			script: BOARD_CLIENT_JS,
			view,
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
		expect((await titlesIn(page, "todo")).sort()).toEqual([
			"Export orders as CSV",
			"Invoice totals round the wrong way",
		]);
		expect(await titlesIn(page, "doing")).toEqual(["Billing webhook accepts orders"]);
		// Past six finished cards the lane starts folded, so its cards are in the document
		// but hidden: a reader clicks the head to see them.
		expect(await page.$eval("#lane-head-done", (node) => node.getAttribute("aria-expanded"))).toBe("false");
		expect(await hidden(page, "#lane-done")).toBe(true);
		await page.close();
	});

	test("opens a card from its title, and Esc closes it", async () => {
		const page = await openPage();
		await page.click("#lane-doing .board-card__title");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		expect(await page.textContent("#card-dialog-title")).toBe("Billing webhook accepts orders");
		expect(await page.textContent("#card-dialog-owner")).toContain("billing-core");
		expect(await page.textContent("#card-dialog-state")).toContain("doing");

		await page.keyboard.press("Escape");
		expect(await hidden(page, "#board-card-dialog")).toBe(true);
		await page.close();
	});

	test("narrows the lanes from the one filter box", async () => {
		const page = await openPage();
		await page.fill("#board-filter", "invoice");
		await cardCount(page, "todo", 1);
		expect(await titlesIn(page, "todo")).toEqual(["Invoice totals round the wrong way"]);
		expect(await titlesIn(page, "doing")).toEqual([]);
		// Clearing it puts the board back: the filter is a view, never a store read.
		await page.fill("#board-filter", "");
		await cardCount(page, "todo", 2);
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

	test("shows a card another session writes, without a reload", async () => {
		const page = await openPage();
		const added = await store.create({ title: "A card another session added", paths: [] }, CORE, clock.now());
		try {
			await page.waitForFunction(
				() =>
					Array.from(
						(globalThis as unknown as { document: Doc }).document.querySelectorAll("#lane-todo .board-card__title"),
					).some((node) => node.textContent === "A card another session added"),
				undefined,
				{ timeout: PAINT_MS },
			);
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
		expect(await footer()).toContain("~/.pi/agent/board/behaviour");
		expect(await footer()).toContain("10 cards");
		expect(await footer()).not.toContain("unreadable");

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
