/**
 * team — the lead's round over the shared board.
 *
 * `board` owns the cards and never touches the session bus; `team` owns the two
 * actions that need it. `assign` hands a card to a session that is already running
 * and sends it a handoff — dispatch cannot start a peer's turn, and the page and the
 * docs say so — and `reclaim` takes a card back when its owner has gone quiet. Its one
 * command, `/team`, prints the round the board's Team tab draws, without a browser.
 *
 * Either extension works without the other: `board` is the work list any session
 * uses, and `team` is the lead's. The factory only registers; the store is opened on
 * first use.
 *
 * Load with:  pi --extension ./extensions/team --extension ./extensions/session-bus
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type BoardSession, openBoardSession } from "../../lib/board/session.ts";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerCommands } from "./commands.ts";
import { registerTools } from "./tools.ts";

export interface TeamDeps {
	/** Test seam: a session with a temp agent directory and a fixed clock. */
	session?: BoardSession;
}

export default function team(pi: ExtensionAPI, deps: TeamDeps = {}): void {
	if (!isExtensionEnabled("team")) return;
	const session = deps.session ?? openBoardSession(pi);
	registerTools(pi, session);
	registerCommands(pi, session);
}
