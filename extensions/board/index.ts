/**
 * board — one shared feature board per repository.
 *
 * Every Pi session on a repository reads and writes the same cards, and `/board`
 * serves them as a page in the browser that follows the store live. A card is one
 * *feature*, not one step: the steps of the work live in the owner's plan and in
 * `todo`, and the board answers who is holding what and what needs a decision.
 *
 * The factory only registers. The store is opened on first use by the session, the
 * page starts when `/board` asks for it, and `session_shutdown` closes it — so a
 * session that never touches the board writes nothing and binds nothing.
 *
 * Load with:  pi --extension ./extensions/board
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { requestMount } from "../../lib/http/mount.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { registerCommands } from "./commands.ts";
import { createLazyBoardPage } from "./lazy-page.ts";
import type { BoardPage } from "./page.ts";
import { type BoardSession, openBoardSession } from "../../lib/board/session.ts";
import { registerTools } from "./tools.ts";

export interface BoardDeps {
	/** Test seam: a session with a temp agent directory and a fixed clock. */
	session?: BoardSession;
	/** Test seam: the page lifecycle, so a test drives it without a socket. */
	page?: BoardPage;
	/** Test seam: the team join, so a suite drives the page's door without a bus. */
	team?: TeamJoin;
}

export default function board(pi: ExtensionAPI, deps: BoardDeps = {}): void {
	if (!isExtensionEnabled("board")) return;
	const session = deps.session ?? openBoardSession(pi);
	// One join for the tool and the command: both put this session on the team, and a second
	// one would be two constructions of the same seam. A command cannot call a tool, so the
	// object is a request over `pi.events` either way.
	const team = deps.team ?? createTeamJoin(pi);
	/** The session the page serves as; the mount lands on this session's one server. */
	let sessionId = "";
	const page =
		deps.page ??
		createLazyBoardPage(session, {
			mount: (spec) => requestMount(pi, spec),
			session: () => sessionId,
		});
	registerTools(pi, session, { team });
	registerCommands(pi, session, page, { team });

	pi.on("session_start", async (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
	});

	pi.on("session_shutdown", async () => {
		await page.closeAll();
	});
}
