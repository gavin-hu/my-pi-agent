/**
 * The shipped board page in a browser, over a fixture store a suite seeds.
 *
 * `board-page.ts` serves the page; this boots the reader's side of it — a temp board, a
 * headless Chrome with no profile of its own, and a tab waited until its first frame has
 * landed. Two suites drive that page now (what a reader can do on it, and what a frame
 * repaints), and a bootstrap written twice is how one of them ends up waiting on something
 * the other has moved: a suite passes the board it wants and the clock it is read against,
 * and everything below that is one statement.
 *
 * A machine with no browser has `BOARD_CHROME === undefined`, which a suite hands to
 * `describe.skipIf` so `bun run check` stays green there and still says why nothing ran.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { findChrome } from "../../scripts/capture/chrome.ts";
import { DEFAULT_WIP } from "../../lib/board/limits.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { type BoardStore, createStore } from "../../lib/board/store.ts";
import { type PageDisplay, serveBoardPage } from "./board-page.ts";

/** The browser this machine has; absent means a browser suite is skipped, naming `PI_CHROME`. */
export const BOARD_CHROME = findChrome();

/** How long a page gets to show what its fixture holds. */
export const BOARD_PAINT_MS = 10_000;

/** What a suite tells the helper about its own board. */
export interface BoardBrowserOptions {
	/** Register the cards the page draws: called once, over the store and the clock. */
	seed: (store: BoardStore, now: number) => Promise<void>;
	/**
	 * The clock every snapshot and every seed reads.
	 *
	 * A page prints ages, so this is what keeps an assertion off the wall clock.
	 */
	now: () => number;
	/** The name the page is served as — its board's lead — when the suite's board signs as somebody. */
	lead?: string;
	/** What the page prints for the repository and its store, when the fixture is not a checkout. */
	display?: PageDisplay;
	/** The bus's records to draw, or nothing at all for a page with no bus here. */
	roster?: (now: number) => RosterSession[];
}

/** One board in one browser: the store behind it, and fresh tabs on it. */
export interface BoardBrowser {
	/** The store the page reads, seeded by the suite. */
	store: BoardStore;
	/** The store's directory, for a suite that writes a file beside the cards. */
	directory: string;
	/** A fresh tab on the served page, waited until its first frame has landed. */
	open(): Promise<Page>;
	/**
	 * A fresh tab on another page in the same browser, for a suite that serves a second one.
	 *
	 * The browser is the expensive half of a boot, and a second board — a bus's records, a
	 * longer history — is a different store served beside the first rather than a second
	 * machine's worth of Chrome.
	 */
	tab(url: string): Promise<Page>;
	/** Close the browser, the listener, and the temp board; idempotent enough for `afterAll`. */
	close(): Promise<void>;
}

/** The sliver of the DOM the first-frame wait reads. */
interface Lanes {
	hasAttribute(name: string): boolean;
}

/** Boot one board and one browser, and hand back the tabs on it. */
export async function openBoardBrowser(options: BoardBrowserOptions): Promise<BoardBrowser> {
	// A suite that forgot its skip says so, rather than launching a browser this package does
	// not ship and reading a build error out of Playwright.
	if (BOARD_CHROME === undefined) throw new Error("no browser on this machine: PI_CHROME names one");
	const directory = mkdtempSync(join(tmpdir(), "pi-board-page-"));
	// The lead is the one setting a browser suite states: it is the name the page signs as.
	const store =
		options.lead === undefined
			? createStore(directory)
			: createStore(directory, { config: { wip: DEFAULT_WIP, lead: options.lead } });
	await store.ensure();
	await options.seed(store, options.now());
	const server = await serveBoardPage({
		store,
		now: options.now,
		...(options.display === undefined ? {} : { display: options.display }),
		...(options.roster === undefined ? {} : { roster: options.roster }),
	});
	const browser: Browser = await chromium.launch({ executablePath: BOARD_CHROME, headless: true });
	// The placeholders go when the first frame lands, which is what a suite's first assertion
	// needs: a lane drawn from the snapshot, not from the document's head. The marker rather
	// than the panel, because the panel is hidden on the tab a suite may have asked for.
	const tab = async (url: string): Promise<Page> => {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		await page.goto(url, { waitUntil: "load" });
		await page.waitForFunction(
			() =>
				(globalThis as unknown as { document: { getElementById(id: string): Lanes | null } }).document
					.getElementById("board-lanes")
					?.hasAttribute("data-skeleton") === false,
			undefined,
			{ timeout: BOARD_PAINT_MS },
		);
		return page;
	};
	return {
		store,
		directory,
		open: () => tab(server.url),
		tab,
		close: async () => {
			await browser.close();
			await server.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}
