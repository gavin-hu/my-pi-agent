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

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { requestMount } from "../../lib/http/mount.ts";
import { busLoaded, createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { BOARD_TOOL, PLAN_TOOL, SESSION_TOOL, TEAM_TOOL } from "../../lib/tool-names.ts";
import type { Card } from "../../lib/workflow/card.ts";
import type { Claims } from "../../lib/workflow/claims.ts";
import type { MemberTools } from "../../lib/workflow/join.ts";
import { type BoardSession, openBoardSession } from "../../lib/workflow/session.ts";
import { type LeadDoor, registerCommands } from "./commands.ts";
import { createLazyBoardPage } from "./lazy-page.ts";
import type { BoardPage } from "./page.ts";
import type { LeadRuntime } from "./runtime.ts";
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
	/**
	 * The seat, loaded on first use: `/board` taking it, or a branch that already says
	 * `lead` on the session's first turn. The runtime is `import()`ed rather than
	 * registered with, so a session that never serves a page pays nothing for the mode
	 * and `board`'s registration graph keeps its size.
	 */
	let leadModule: Promise<typeof import("./runtime.ts")> | undefined;
	let leadRuntime: LeadRuntime | undefined;
	let branchState: Promise<typeof import("../../lib/mode-state.ts")> | undefined;
	/**
	 * The runtime, reconciled with what the branch and the page say together.
	 *
	 * Every door that reaches the runtime comes through here, so no turn or branch change can leave
	 * the mode, the tool set and the chip telling three stories: `reconcile` is the one place that
	 * decides, and it is idempotent — which is why there is no "restored once per session" note left
	 * to go stale when the branch moves under it.
	 */
	const lead = async (ctx: ExtensionContext): Promise<LeadRuntime> => {
		leadRuntime ??= (await (leadModule ??= import("./runtime.ts"))).createLeadRuntime(pi);
		leadRuntime.reconcile(ctx, session.serving() !== undefined);
		return leadRuntime;
	};
	/**
	 * The seat, or undefined when the branch is not holding it — asked before the
	 * runtime is loaded, because three of the four modes never need it.
	 *
	 * The reading is `lib/mode-state.ts`'s: it owns what holding the seat means (`holdsSeat`), so this
	 * door asks rather than comparing the mode itself — a second comparison here is how one surface
	 * came to disagree with the others about the same word (#825, #821, #835). The import is deferred,
	 * which is what makes asking it free: the module is already outside this entry's static graph, so
	 * two more questions cost the entry nothing until a door is asked.
	 */
	const seatHeld = async (ctx: ExtensionContext): Promise<LeadRuntime | undefined> => {
		// A session that never served a page pays nothing for the seat: the reader is deferred, and
		// the runtime is loaded only when the branch asks for it or one already exists to answer for
		// itself — a branch that lost the seat still has a tool set and a chip to put back.
		if (leadRuntime === undefined) {
			const { holdsSeat } = await (branchState ??= import("../../lib/mode-state.ts"));
			if (!holdsSeat(ctx.sessionManager.getBranch())) return undefined;
		}
		const runtime = await lead(ctx);
		return runtime.isEnabled() ? runtime : undefined;
	};
	const leadDoor: LeadDoor = {
		async enter(ctx) {
			// Planning strips the contract and the signature the seat exists for, so entering
			// the seat leaves plan mode first: the one cross-mode sequence the table allows.
			const { isPlanModeEnabled } = await (branchState ??= import("../../lib/mode-state.ts"));
			if (isPlanModeEnabled(ctx.sessionManager.getBranch())) {
				const { requestPlanLeave } = await import("../../lib/mode-entry.ts");
				await requestPlanLeave(pi, ctx);
			}
			(await lead(ctx)).enable(ctx);
		},
		async exit(ctx) {
			// The reconcile may have already stood the seat down — a page that closed, a branch that
			// moved on — so the answer is whether it was on when the line was typed. `/board stop`
			// reports a seat it ended rather than one it found already off.
			const before = leadRuntime?.isEnabled() ?? false;
			const runtime = await lead(ctx);
			const was = before || runtime.isEnabled();
			if (runtime.isEnabled()) runtime.disable(ctx);
			return was;
		},
	};
	registerTools(pi, session);
	registerCommands(pi, session, page, { team, lead: leadDoor });

	/**
	 * The model's tool list, as the team's own question: `board` is offered while this session is on
	 * the team, and with no bus loaded it is offered anyway — a solo board is still a work list, which
	 * is what `solo` says. `lib/workflow/join.ts` is outside this entry's static graph and is loaded on
	 * the first turn that asks, because a registration that always offered the tool would put it in
	 * every session's list, and `test/dependencies.test.ts` holds what this entry pays at load.
	 */
	let memberModule: Promise<typeof import("../../lib/workflow/join.ts")> | undefined;
	let memberTools: MemberTools | undefined;
	const offerTools = async (ctx: ExtensionContext): Promise<boolean> => {
		const module = await (memberModule ??= import("../../lib/workflow/join.ts"));
		memberTools ??= module.createMemberTools(pi, session, [BOARD_TOOL], { solo: true });
		// The answer is whether the tool is offered now, which the turn start below needs: it is the
		// fact that decides whether this turn draws the card line or the door.
		return await memberTools.sync(ctx);
	};

	/** Whether the first turn has read this session's cards, so later turns do not read them again. */
	let read = false;
	/**
	 * The cards this session holds, as the write gate reads them: one scan for the part of a turn
	 * that judges writes.
	 *
	 * The turn line reads them once per session, and every later turn's line is already in the
	 * transcript — but the gate needs them per turn, because a `board`, `team`, or `session` call
	 * moves the set and a turn boundary is where a move behind it (the page) is picked up. The
	 * cards are read together with the line's first read, and the cache is reset rather than
	 * invalidated: a second scan is cheap next to a stale allow.
	 *
	 * The one stale answer it can give is the other way round: a card that becomes this session's
	 * mid-turn — a peer's `assign`, a command — is not in the set read at the turn's start, so the
	 * gate reads "holds nothing" until the next turn. The direction is bounded by the turn, and the
	 * alternative is a scan per judged call for every session that holds nothing.
	 */
	let heldNow: Card[] | undefined;
	let gateModule: Promise<typeof import("./write-gate.ts")> | undefined;
	let enterModule: Promise<typeof import("./enter-gate.ts")> | undefined;
	let policyModule: Promise<typeof import("../../lib/policy.ts")> | undefined;

	/** The held cards, read at most once per part of a turn; a board that cannot be read gates nothing. */
	const heldForGate = async (ctx: ExtensionContext): Promise<Card[] | undefined> => {
		if (heldNow !== undefined) return heldNow;
		const context = await (contextModule ??= import("./context.ts"));
		const cards = await context.heldCards(session, ctx);
		if (cards !== undefined) heldNow = cards;
		return cards;
	};

	/** The calls that can move the set of cards this session holds: the board, a handoff, a claim. */
	const MOVING_TOOLS: readonly string[] = [BOARD_TOOL, TEAM_TOOL, SESSION_TOOL];

	/**
	 * Why this session may not start planning, or `undefined` when the board is not its gate.
	 *
	 * Membership first, and it is the same fact that decides whether the tool is offered: the board
	 * does not speak for a session it has no record of, and a board that does not speak must not
	 * brick work that is not its own. With no bus loaded the board is solo and does speak; what is
	 * left is `enter-gate.ts`'s one question.
	 */
	const enterRefusal = async (ctx: ExtensionContext, held: readonly Card[]): Promise<string | undefined> => {
		const bus = busLoaded(pi);
		if (bus) {
			const { onTeam } = await (memberModule ??= import("../../lib/workflow/join.ts"));
			if (!(await onTeam(session, ctx))) return undefined;
		}
		const { planEntryRefusal } = await (enterModule ??= import("./enter-gate.ts"));
		return planEntryRefusal(held, bus ? "team" : "solo");
	};

	/**
	 * Why the lane refuses this call, or `undefined` when it has no card of this session's to judge.
	 *
	 * The seat answers first in the handler, so a refused lead never sees a card's sentence. Plan
	 * mode is second: its own block is stricter on every tool this gate judges and it words its own
	 * refusal, so standing down keeps exactly one sentence answering a call whatever the extension
	 * load order is. Then the one question the lane table cannot ask — whether there is a lane at
	 * all — is asked before it, because a session with no card has nothing for the table to key on.
	 */
	const laneRefusal = async (ctx: ExtensionContext, toolName: string, input: unknown): Promise<string | undefined> => {
		if (MOVING_TOOLS.includes(toolName)) heldNow = undefined;
		const { isPlanModeEnabled } = await (branchState ??= import("../../lib/mode-state.ts"));
		if (isPlanModeEnabled(ctx.sessionManager.getBranch())) return undefined;
		// One read and one unreadable guard for both questions below: a board that cannot be read
		// gates nothing, which is the answer the table has always given.
		const held = await heldForGate(ctx);
		if (held === undefined) return undefined;
		if (toolName === PLAN_TOOL && (input as { action?: unknown } | undefined)?.action === "enter") {
			const refused = await enterRefusal(ctx, held);
			if (refused !== undefined) return refused;
		}
		if (held.length === 0) return undefined;
		const store = await session.store(ctx.cwd);
		const { writeRefusal } = await (gateModule ??= import("./write-gate.ts"));
		// The pin is `lib/policy.ts`'s body, the one plan mode also runs; the gate only decides when.
		const { pinReadOnlySubagent } = await (policyModule ??= import("../../lib/policy.ts"));
		return writeRefusal(
			held,
			{ tool: toolName, input },
			{
				root: store.root(),
				pinSubagent: (value) => pinReadOnlySubagent(pi, value),
			},
		);
	};

	pi.on("session_start", async (_event, ctx) => {
		const next = ctx.sessionManager.getSessionId();
		// The seat is a role this process serves a page as, so a name kept in this closure must not
		// outlive the session that earned it: `/resume` switches sessions in-process.
		if (sessionId !== "" && next !== sessionId) session.serve(undefined);
		sessionId = next;
		read = false;
		heldNow = undefined;
		// A branch this session starts on may already hold the seat, or may have lost it: a runtime
		// that is loaded reconciles now rather than at the next turn, so the chip cannot describe a
		// mode that is not on. Nothing loads for a branch that never named the seat.
		if (leadRuntime !== undefined) await lead(ctx);
		// Then the tool list, from the same record the round reads, so a resumed process offers what
		// the bus says rather than what the last process wrote.
		await offerTools(ctx);
	});

	// A tree jump rebuilds the history from the branch it landed on, so the line a jump went back
	// behind is gone from the transcript: reading again is what puts it back, once.
	pi.on("session_tree", async (_event, ctx) => {
		read = false;
		heldNow = undefined;
		// The tree landed on another branch, which may or may not hold the seat: reconcile now, so
		// the tool set and the chip follow the branch actually in force rather than the one left.
		if (leadRuntime !== undefined) await lead(ctx);
	});

	// A compaction replaces the history behind the line with a summary, so the line a branch carried
	// is gone with it: reading again is what puts it back, exactly as a jump does. No reconcile comes
	// with it — a compaction appends a record and leaves the seat the branch named in force.
	pi.on("session_compact", () => {
		read = false;
	});

	// What a session is told about its own cards, once, before its first turn: which they are, and
	// what each owes next. One read, because every later write reports itself — the claim, the
	// move, and the sign each say their own next step — and a board already parsed every turn on
	// every session's behalf is a cost nobody chose.
	pi.on("before_agent_start", async (_event, ctx) => {
		// A new turn: the gate's read is refreshed before it judges anything, so a page-driven move
		// and a peer's handoff both land by the time the first write asks.
		heldNow = undefined;
		// The seat's line is paid every turn, because the round moves and the hatch has to be
		// in front of the model before it meets a refusal. It replaces the once-per-session
		// line rather than stacking with it: one `board-context` message is kept.
		const holding = await seatHeld(ctx);
		// After the seat's reconcile and before its early return: the reconcile writes the active set,
		// so a sync that ran first would be overwritten, and one after the return would never run for
		// a lead — those are the two ways this ordering goes wrong.
		const offered = await offerTools(ctx);
		if (holding !== undefined) {
			const context = await (contextModule ??= import("./context.ts"));
			const facts = await context.leadFacts(session, ctx);
			const lead = facts === undefined ? undefined : context.buildLeadContext(facts);
			// The seat and the door in one message: this is the session whose work the withheld tool
			// strands — it signs, reviews and lands — so it is the last one that may be told it holds
			// a seat and not how to get the board back. A seat whose facts cannot be read still owes
			// the door, and one whose tool is offered owes the door nothing.
			const content = offered ? lead : lead === undefined ? context.doorContext() : `${lead}\n${context.doorContext()}`;
			return content === undefined
				? undefined
				: { message: { customType: context.BOARD_CONTEXT_TYPE, content, display: false } };
		}
		// No tool, so this turn says where the door is: the line that keeps "no board here" from
		// reading as "no board anywhere". It does not spend `read` — the door is paid every turn
		// while the session is on no team, and the turn it joins still gets the card line.
		if (!offered) {
			const door = await (contextModule ??= import("./context.ts"));
			return { message: { customType: door.BOARD_CONTEXT_TYPE, content: door.doorContext(), display: false } };
		}
		if (read) return undefined;
		const context = await (contextModule ??= import("./context.ts"));
		// The sweep writes first, because a card it hands back this turn is one this session holds:
		// reading the held list before it names the write in a note and leaves the card itself out of
		// the line, which is the one turn a resumed session gets. It is also safe to run first — it
		// catches its own failures — because the held read is the one a failure has to come from.
		const swept = await (endedModule ??= import("./ended.ts")).then((ended) => ended.releaseEnded(session, ctx));
		const held = await heldForGate(ctx);
		// A board that could not be read is asked again on the next turn: that is a failure, not
		// an empty session, and only an answer is worth remembering.
		if (held === undefined) return undefined;
		read = true;
		// The second write a turn start makes. The bus forgets a session's claims when its process
		// ends, so a session resumed in a new process takes back the paths of the cards it is already
		// executing, and says the one thing that did not work — a failure nothing reports is how that
		// was a no-op. A `/new` keeps them, so this is the resume's write, not the reset's. It takes
		// the held list, which is why it comes after the read and not beside the sweep.
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

	// The seat's gate, then the card's lane. The active set hides what the seat's policy does not
	// allow; this is the second layer for a call already in flight and the guard for a tool
	// registered after the load, and it denies by default: `runtime.ts` allows a list, so a tool
	// nobody anticipated is refused. The lane's gate comes after it because a seat holds no card:
	// whatever the seat refused already has the sharper sentence.
	pi.on("tool_call", async (event, ctx) => {
		const holding = await seatHeld(ctx);
		const seated = holding === undefined ? undefined : await holding.refusal(event.toolName, event.input);
		if (seated !== undefined) return { block: true, reason: seated };
		const reason = await laneRefusal(ctx, event.toolName, event.input);
		return reason === undefined ? undefined : { block: true, reason };
	});

	// The other half of the memo, and the half `laneRefusal` cannot do: it clears the set *before* a
	// moving call, so the read it makes for that call caches the set as it was before the write landed.
	// A claim would then leave every later `plan` `enter` in the turn answering from the empty set it
	// walked in with, until some other call re-read it (#962). Clearing here, when the call is over,
	// is the read after the write. The event fires for a failed call too, and a re-read then costs
	// nothing; `read` is deliberately untouched, because it is the branch line and has its own points.
	pi.on("tool_execution_end", (event) => {
		if (MOVING_TOOLS.includes(event.toolName)) heldNow = undefined;
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
