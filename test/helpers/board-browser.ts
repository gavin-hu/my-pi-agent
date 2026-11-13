/**
 * The shipped board page in a browser, over a fixture store a suite seeds.
 *
 * `board-page.ts` serves the page; this boots the reader's side of it — a temp board, a
 * headless Chrome with no profile of its own, and a tab waited until its first frame has
 * landed. Four suites drive that page now (what a reader can do on it, the card dialog, the
 * kind a face wears, and what a frame repaints), each through the one tab `reuse()` hands
 * out, and a bootstrap written twice is how one of them ends up waiting on something the
 * other has moved: a suite passes the board it wants and the clock it is read against, and
 * everything below that is one statement.
 *
 * A machine with no browser has `BOARD_CHROME === undefined`, which a suite hands to
 * `describe.skipIf` so `bun run check` stays green there and still says why nothing ran.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page } from "playwright-core";
import { findChrome } from "../../scripts/capture/chrome.ts";
import { boardConfig } from "../../lib/board/config.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { type BoardStore, createStore } from "../../lib/board/store.ts";
import { launchBrowser } from "./browser.ts";
import { type PageDisplay, serveBoardPage } from "./board-page.ts";

/** The browser this machine has; absent means a browser suite is skipped, naming `PI_CHROME`. */
export const BOARD_CHROME = findChrome();

/** How long a page gets to show what its fixture holds. */
export const BOARD_PAINT_MS = 10_000;

/** The window every tab opens at: wide enough for the five lanes, tall enough for the board. */
const VIEWPORT = { width: 1280, height: 900 } as const;

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
	/**
	 * The one tab this suite reads, its document reloaded for every case.
	 *
	 * A tab is the expensive half of a boot — measured on a machine with Chrome, ~400 ms against
	 * ~65 ms to reload one already open — so a suite buys one and reloads its document. That is
	 * what a case needs anyway: a document that inherited nothing from the last, with no stream,
	 * no repaint in flight, no filter, fold, tab, mark, or focus. The one thing Playwright keeps
	 * across a reload — the viewport, because it belongs to the tab and not to the document — is
	 * put back before it. The caller must not close the page: `close()` closes the browser, which
	 * closes it.
	 */
	reuse(): Promise<Page>;
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

/**
 * Wait until the page's first frame has landed, which is what a suite's first assertion needs: a
 * lane drawn from the snapshot rather than from the document's head. The marker is what is read
 * rather than the panel, because the panel is hidden on the tab a suite may have asked for.
 */
async function landed(page: Page): Promise<Page> {
	await page.waitForFunction(
		() =>
			(globalThis as unknown as { document: { getElementById(id: string): Lanes | null } }).document
				.getElementById("board-lanes")
				?.hasAttribute("data-skeleton") === false,
		undefined,
		{ timeout: BOARD_PAINT_MS },
	);
	return page;
}

/** Boot one board and one browser, and hand back the tabs on it. */
export async function openBoardBrowser(options: BoardBrowserOptions): Promise<BoardBrowser> {
	const directory = mkdtempSync(join(tmpdir(), "pi-board-page-"));
	// The lead is the one setting a browser suite states: it is the name the page signs as.
	const store =
		options.lead === undefined
			? createStore(directory)
			: createStore(directory, { config: boardConfig({ lead: options.lead }) });
	await store.ensure();
	await options.seed(store, options.now());
	const server = await serveBoardPage({
		store,
		now: options.now,
		...(options.display === undefined ? {} : { display: options.display }),
		...(options.roster === undefined ? {} : { roster: options.roster }),
	});
	const browser = await launchBrowser(BOARD_CHROME);
	const tab = async (url: string): Promise<Page> => {
		const page = await browser.newPage({ viewport: VIEWPORT, reducedMotion: "reduce" });
		await page.goto(url, { waitUntil: "load" });
		return landed(page);
	};
	/** The tab `reuse()` hands out, made on the first call and reloaded on every one after it. */
	let shared: Page | undefined;
	return {
		store,
		directory,
		tab,
		reuse: async () => {
			if (shared === undefined) {
				shared = await tab(server.url);
				return shared;
			}
			// The viewport is the tab's, not the document's, so a case that shrank it would draw the
			// next one's document at that width: put it back before the reload.
			await shared.setViewportSize(VIEWPORT);
			await shared.reload({ waitUntil: "load" });
			return landed(shared);
		},
		close: async () => {
			await browser.close();
			await server.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}
