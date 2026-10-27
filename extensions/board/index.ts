/**
 * board — one shared feature board per repository.
 *
 * Every Pi session on a repository reads and writes the same cards, and `/board`
 * serves them as a page in the browser that follows the store live. A card is one
 * *feature*, not one step: the steps of the work live in the owner's plan and in
 * `todo`, and the board answers who is doing what and what needs a decision.
 *
 * The factory only registers. The store is opened on first use by the session, the
 * page starts when `/board` asks for it, and `session_shutdown` closes it — so a
 * session that never touches the board writes nothing and binds nothing.
 *
 * Load with:  pi --extension ./extensions/board
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCommands } from "./commands.ts";
import { type BoardPage, createBoardPage } from "./page.ts";
import { type BoardSession, openBoardSession } from "../../lib/board/session.ts";
import { registerTools } from "./tools.ts";

export interface BoardDeps {
	/** Test seam: a session with a temp agent directory and a fixed clock. */
	session?: BoardSession;
	/** Test seam: the page lifecycle, so a test drives it without a socket. */
	page?: BoardPage;
}

export default function board(pi: ExtensionAPI, deps: BoardDeps = {}): void {
	if (!isExtensionEnabled("board")) return;
	const session = deps.session ?? openBoardSession(pi);
	const page = deps.page ?? createBoardPage(session);
	registerTools(pi, session);
	registerCommands(pi, session, page);

	pi.on("session_shutdown", async () => {
		await page.closeAll();
	});
}
