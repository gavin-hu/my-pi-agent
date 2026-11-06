/**
 * team — the lead's round over the shared board.
 *
 * `board` owns the cards; `team` owns the leads round over them. `assign` sends a handoff
 * to a session that is already running and then records the owner — dispatch cannot start a
 * peer's turn, and the page and the docs say so — `offer` broadcasts one to whoever is
 * free, `reclaim` takes one back when its owner is gone or has gone quiet, and `claim`
 * takes one for the lead itself. The card's life after that is `board`'s. Its one command,
 * `/team`, prints the round the board's Team tab draws, without a browser.
 *
 * Either extension works without the other: `board` is the work list, and `team` is
 * the lead's half of it; both are opt-in, so a session names the ones it runs. The
 * factory only registers; the store is opened on first use.
 *
 * Load with:  PI_ENABLED_EXTENSIONS=board,team pi --extension ./extensions/team --extension ./extensions/session-bus
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type BoardSession, openBoardSession } from "../../lib/board/session.ts";
import { isExtensionEnabled } from "../../lib/env.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { registerCommands } from "./commands.ts";
import { registerTools } from "./tools.ts";

export interface TeamDeps {
	/** Test seam: a session with a temp agent directory and a fixed clock. */
	session?: BoardSession;
	/** Test seam: the join, so a suite records it instead of asking a bus. */
	team?: TeamJoin;
}

export default function team(pi: ExtensionAPI, deps: TeamDeps = {}): void {
	if (!isExtensionEnabled("team")) return;
	const session = deps.session ?? openBoardSession(pi);
	// One join for the tool and the command: a round's claim and `/team join` are two doors to
	// the same team, and the command is a request over `pi.events` because it cannot call a tool.
	const team = deps.team ?? createTeamJoin(pi);
	registerTools(pi, session, { team });
	registerCommands(pi, session, { team });
}
