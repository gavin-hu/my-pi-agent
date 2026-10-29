/**
 * The board's page, loaded when `/board` first needs it.
 *
 * The page module owns the HTTP surface, the snapshots, and the view; none of it
 * is needed to register the command or the tool. The factory therefore returns a
 * proxy over `lib/lazy`: every command path loads the real page once, and
 * `closeAll` on shutdown only closes a page that was already opened, so a
 * session that never touched the board imports none of it.
 *
 * The loader is a seam: a test drives the proxy without a socket.
 */

import type { BoardSession } from "../../lib/board/session.ts";
import { lazy } from "../../lib/lazy.ts";
import type { BoardPage, BoardPageDeps } from "./page.ts";

/** The page module, as the proxy loads it. */
export type BoardPageModule = typeof import("./page.ts");

/** How the proxy reaches the page module; production uses the dynamic import. */
export type BoardPageLoader = () => Promise<BoardPageModule>;

export function createLazyBoardPage(
	session: BoardSession,
	deps: BoardPageDeps,
	load: BoardPageLoader = () => import("./page.ts"),
): BoardPage {
	const page = lazy(async () => (await load()).createBoardPage(session, deps));
	return {
		start: async (ctx, view) => (await page.get()).start(ctx, view),
		stop: async () => (await page.get()).stop(),
		status: async () => (await page.get()).status(),
		dropStale: async (ctx) => (await page.get()).dropStale(ctx),
		// Shutdown must not start a load: a page that never opened has nothing to close.
		closeAll: async () => {
			const opened = page.peek();
			if (opened !== undefined) await opened.closeAll();
		},
	};
}
