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
import type { Claims } from "../../lib/workflow/claims.ts";
import { registerCommands } from "./commands.ts";
import { createLazyBoardPage } from "./lazy-page.ts";
import type { BoardPage } from "./page.ts";
import { type BoardSession, openBoardSession } from "../../lib/workflow/session.ts";
import { registerTools } from "./tools.ts";

export interface BoardDeps {
	/** Test seam: a session with a temp agent directory and a fixed clock. */
	session?: BoardSession;
	/** Test seam: the page lifecycle, so a test drives it without a socket. */
	page?: BoardPage;
	/** Test seam: the team join, so a suite drives the page's door without a bus. */
	team?: TeamJoin;
	/**
	 * Test seam: the bus a lane crossing writes to. It reaches the crossing through the session, so
	 * a suite that hands in `session` of its own carries the seam there instead.
	 */
	claims?: Claims;
}

export default function board(pi: ExtensionAPI, deps: BoardDeps = {}): void {
	if (!isExtensionEnabled("board")) return;
	const session = deps.session ?? openBoardSession(pi, deps.claims === undefined ? {} : { claims: deps.claims });
	// One join for the tool and the command: both put this session on the team, and a second
	// one would be two constructions of the same seam. A command cannot call a tool, so the
	// object is a request over `pi.events` either way.
	const team = deps.team ?? createTeamJoin(pi);
	/** The session the page serves as; the mount lands on this session's one server. */
	let sessionId = "";
	/**
	 * The two surfaces this extension opens after a turn starts, not at registration: the first
	 * turn's line, and the sweep that releases a card whose owner's session ended. Both are loaded
	 * on first use, so a session that never touches a card pays nothing for them and the
	 * registration graph stays small. (The claims a crossing makes are the session's now, and loaded
	 * there on the first one.)
	 */
	let contextModule: Promise<typeof import("./context.ts")> | undefined;
	let endedModule: Promise<typeof import("./ended.ts")> | undefined;
	// The shared retention rule, on the same terms: the `context` handler is where it is used.
	let retention: Promise<typeof import("../../lib/notice.ts")> | undefined;
	const page =
		deps.page ??
		createLazyBoardPage(session, {
			mount: (spec) => requestMount(pi, spec),
			session: () => sessionId,
		});
	registerTools(pi, session, { team });
	registerCommands(pi, session, page, { team });

	/** Whether the first turn has read this session's cards, so later turns do not read them again. */
	let read = false;

	pi.on("session_start", async (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
		read = false;
	});

	// A tree jump rebuilds the history from the branch it landed on, so the line a jump went back
	// behind is gone from the transcript: reading again is what puts it back, once.
	pi.on("session_tree", () => {
		read = false;
	});

	// What a session is told about its own cards, once, before its first turn: which they are, and
	// what each owes next. One read, because every later write reports itself — the claim, the
	// move, and the sign each say their own next step — and a board already parsed every turn on
	// every session's behalf is a cost nobody chose.
	pi.on("before_agent_start", async (_event, ctx) => {
		if (read) return undefined;
		const context = await (contextModule ??= import("./context.ts"));
		// The sweep writes first, because a card it hands back this turn is one this session holds:
		// reading the held list before it names the write in a note and leaves the card itself out of
		// the line, which is the one turn a resumed session gets. It is also safe to run first — it
		// catches its own failures — because the held read is the one a failure has to come from.
		const swept = await (endedModule ??= import("./ended.ts")).then((ended) => ended.releaseEnded(session, ctx));
		const held = await context.heldCards(session, ctx);
		// A board that could not be read is asked again on the next turn: that is a failure, not
		// an empty session, and only an answer is worth remembering.
		if (held === undefined) return undefined;
		read = true;
		// The second write a turn start makes. The bus forgets a session's claims when it stops, so a
		// resumed session takes back the paths of the cards it is already executing, and says the one
		// thing that did not work — a failure nothing reports is how that was a no-op. It takes the
		// held list, which is why it comes after the read and not beside the sweep.
		const reclaimed =
			held.length === 0
				? undefined
				: await import("../../lib/workflow/claims.ts").then((claims) =>
						claims.reclaimHeld(deps.claims ?? claims.busClaims(pi), ctx, held),
					);
		// In the order the writes happened: the sweep, then the re-claim.
		const notes = [swept, reclaimed].filter((note): note is string => note !== undefined);
		const content = context.buildBoardContext(held, notes);
		return content === undefined
			? undefined
			: { message: { customType: context.BOARD_CONTEXT_TYPE, content, display: false } };
	});

	// `before_agent_start` injects one per session; a `/resume` replays the old ones, so keep only
	// the newest and the transcript cannot stack them.
	pi.on("context", async (event) => {
		const { isBoardContext } = await (contextModule ??= import("./context.ts"));
		const { retainNewest } = await (retention ??= import("../../lib/notice.ts"));
		const kept = retainNewest(event.messages, isBoardContext);
		return kept ? { messages: kept } : undefined;
	});

	pi.on("session_shutdown", async () => {
		await page.closeAll();
	});
}
