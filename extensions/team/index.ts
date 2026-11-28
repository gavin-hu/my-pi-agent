/**
 * team — the lead's round over the shared board.
 *
 * `board` owns the cards; `team` owns the lead's round over them. `assign` records a session that
 * is already running as the card's owner and then sends it a handoff — dispatch cannot start a
 * peer's turn, and the page and the docs say so — `offer` broadcasts one to whoever is
 * free, and `ask` puts a question to one peer. The three are the verbs that reach another
 * session; a card's own state is `board`'s. Its one command, `/team`, prints the round the
 * board's Team tab draws without a browser, and takes the three words that change this session's
 * own membership or answer a question about it: `join`, `exit`, and `who`.
 *
 * Either extension works without the other: `board` is the work list, and `team` is
 * the lead's half of it. The factory only registers; the store opens on first use, so a
 * session that never works a card writes nothing and binds nothing.
 *
 * Load with:  pi --extension ./extensions/team --extension ./extensions/session-bus
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { createTeamJoin, createTeamLeave, type TeamJoin, type TeamLeave } from "../../lib/session-tool.ts";
import { TEAM_TOOL } from "../../lib/tool-names.ts";
import type { MemberTools } from "../../lib/workflow/join.ts";
import { type BoardSession, openBoardSession } from "../../lib/workflow/session.ts";
import { registerCommands } from "./commands.ts";
import { registerTools } from "./tools.ts";

export interface TeamDeps {
	/** Test seam: a session with a temp agent directory and a fixed clock. */
	session?: BoardSession;
	/** Test seam: the join, so a suite records it instead of asking a bus. */
	team?: TeamJoin;
	/** Test seam: the leave, so a suite records it instead of asking a bus. */
	leave?: TeamLeave;
}

export default function team(pi: ExtensionAPI, deps: TeamDeps = {}): void {
	if (!isExtensionEnabled("team")) return;
	const session = deps.session ?? openBoardSession(pi);
	// One join for the tool and the command: a round's claim and `/team join` are two doors to
	// the same team, and the command is a request over `pi.events` because it cannot call a tool.
	const team = deps.team ?? createTeamJoin(pi);
	// The other way out of the same team, on the same transport: `/team exit` is a command, so it
	// cannot call the bus's own leave either.
	const leave = deps.leave ?? createTeamLeave(pi);
	registerTools(pi, session, { team });
	registerCommands(pi, session, { team, leave });

	/**
	 * The model's tool list, as the team's own question: `team` is offered while this session is on
	 * the team, and never otherwise — `solo` is false because there is nothing to hand over with no
	 * bus, which is the one place this differs from `board`. `lib/workflow/join.ts` is outside this
	 * entry's static graph and loads on the first turn that asks, because `test/dependencies.test.ts`
	 * holds what an entry pays at load.
	 */
	let memberModule: Promise<typeof import("../../lib/workflow/join.ts")> | undefined;
	let memberTools: MemberTools | undefined;
	const offerTools = async (ctx: ExtensionContext): Promise<void> => {
		const module = await (memberModule ??= import("../../lib/workflow/join.ts"));
		memberTools ??= module.createMemberTools(pi, session, [TEAM_TOOL], { solo: false });
		await memberTools.sync(ctx);
	};

	// The two lifecycle points this entry did not have before the tool had an audience. Both ask the
	// bus's record, so a `/resume` needs nothing stored and a `/team join` shows up at the next turn.
	pi.on("session_start", async (_event, ctx) => {
		await offerTools(ctx);
	});
	pi.on("before_agent_start", async (_event, ctx) => {
		await offerTools(ctx);
	});
}
