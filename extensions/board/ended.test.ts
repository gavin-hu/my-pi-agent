/**
 * The sweep at a turn start: the cards a session that ended left behind.
 *
 * The fact this reads is the bus's own — a record whose pid is not running is `gone`, the state
 * `#396` made trustworthy and the reclaim gate already trusts — so the cases here drive the real
 * board and the real record files rather than a stand-in for either. What they pin is the bound on
 * the sweep: `gone` only, refusals skipped, and the sentence naming exactly what this session wrote.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { agentLabel } from "../../lib/session-label.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { boardTool } from "../../test/helpers/board.ts";
import { writeBusRecord } from "../../test/helpers/bus.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { releaseEnded } from "./ended.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;
/** A pid past every platform's limit, so the record names a process that is not running. */
const DEAD_PID = 999_999_999;

const LEAD_ID = "s-lead";
const PEER_ID = "s-peer";
const LEAD = agentLabel(LEAD_ID);
const PEER = agentLabel(PEER_ID);

/**
 * One board and the two sessions that work it: the lead that starts a turn, and the peer whose
 * record says whether it is still running.
 */
function board() {
	const cwd = temps.track(tempDir("pi-repo-"));
	const agentDir = temps.track(tempDir("pi-agent-"));
	const open = (sessionId: string) => boardTool({ cwd, agentDir, lead: LEAD, now: NOW, sessionId });
	return { cwd, lead: open(LEAD_ID), peer: open(PEER_ID) };
}

/** One session's record on this bus, as the liveness rule reads it. */
async function record(
	runtime: BoardSession,
	cwd: string,
	fields: { id?: string; label?: string; pid?: number; lastSeen: number },
) {
	writeBusRecord(await runtime.busDir(cwd), { id: PEER_ID, label: PEER, ...fields });
}

describe("the sweep at a turn start", () => {
	test("releases a card whose owner's session is gone, and names it", async () => {
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await record(peer.board.runtime, cwd, { pid: DEAD_PID, lastSeen: NOW });

		const said = await releaseEnded(lead.board.runtime, lead.board.ctx);
		expect(said).toBe("released #1 from a session that ended");
		// The card is back in the pool, with the reclaim's own history behind it rather than the
		// sweep's: the store wrote the crossing, the sweep only decided to ask for it.
		const card = (await lead.call({ action: "list", card: "1" })).details.card;
		expect(card?.lane).toBe("backlog");
		expect(card?.owner).toBeUndefined();
	});

	test("leaves a quiet owner alone, because a long turn looks exactly like it", async () => {
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		// No pid, and a heartbeat older than the TTL: the bus cannot say the process ended, which is
		// the one answer a person still has to give by hand.
		await record(peer.board.runtime, cwd, { lastSeen: NOW - 60 * 60 * 1000 });

		expect(await releaseEnded(lead.board.runtime, lead.board.ctx)).toBeUndefined();
		expect((await lead.call({ action: "list", card: "1" })).details.card?.lane).toBe("plan");
	});

	test("leaves a card alone when the bus cannot answer for its owner", async () => {
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		// A bus that exists but holds no record of the peer: `absent` is not `gone`, because a live
		// session that never joined writes nothing either.
		await record(lead.board.runtime, cwd, { id: LEAD_ID, label: LEAD, pid: DEAD_PID, lastSeen: NOW });

		expect(await releaseEnded(lead.board.runtime, lead.board.ctx)).toBeUndefined();
		expect((await lead.call({ action: "list", card: "1" })).details.card?.lane).toBe("plan");
	});

	test("leaves the caller's own card alone when its own record reads gone", async () => {
		const { cwd, lead, peer } = board();
		for (const title of ["One", "Two"]) await lead.call({ action: "add", title });
		await lead.call({ action: "claim", card: "1" });
		await peer.call({ action: "claim", card: "2" });
		// The record a `/resume` inherits: this session's own id, and the pid of the process that
		// crashed. Both owners read `gone`, and only the peer's card is one to release — the sweep runs
		// right after this session re-claimed #1's paths, so taking it back would undo its own turn.
		await record(lead.board.runtime, cwd, { id: LEAD_ID, label: LEAD, pid: DEAD_PID, lastSeen: NOW });
		await record(peer.board.runtime, cwd, { pid: DEAD_PID, lastSeen: NOW });

		expect(await releaseEnded(lead.board.runtime, lead.board.ctx)).toBe("released #2 from a session that ended");
		// Still held, and still the caller's: the guard narrowed the sweep rather than disarming it.
		expect((await lead.call({ action: "list", card: "1" })).details.card?.owner?.id).toBe(LEAD_ID);
		expect((await lead.call({ action: "list", card: "2" })).details.card?.owner).toBeUndefined();
	});

	test("skips a refusal and still releases the card it can", async () => {
		const { cwd, lead, peer } = board();
		for (const title of ["One", "Two"]) await lead.call({ action: "add", title });
		for (const id of ["1", "2"]) await peer.call({ action: "claim", card: id });
		await record(peer.board.runtime, cwd, { pid: DEAD_PID, lastSeen: NOW });

		// The store's own refusal, as a race produces it: another session swept #1 between this
		// sweep's read and its write. Only the write that changed something is counted.
		const runtime = lead.board.runtime;
		const racing: BoardSession = {
			...runtime,
			store: async (at) => {
				const store = await runtime.store(at);
				return {
					...store,
					mutate: async (id, op, actor, now) =>
						id === "1" ? { ok: false, error: "#1 is not yours to reclaim." } : store.mutate(id, op, actor, now),
				};
			},
		};
		expect(await releaseEnded(racing, lead.board.ctx)).toBe("released #2 from a session that ended");
		expect((await lead.call({ action: "list", card: "2" })).details.card?.lane).toBe("backlog");
	});

	test("says nothing on a board with no bus, and on one with nothing to release", async () => {
		const { lead } = board();
		await lead.call({ action: "add", title: "One" });
		// This repository has no bus at all: nobody's record exists to say a session ended.
		expect(await releaseEnded(lead.board.runtime, lead.board.ctx)).toBeUndefined();

		// A bus, and a card held by a session that is running: the sweep is a no-op, not a message.
		const running = board();
		await running.lead.call({ action: "add", title: "One" });
		await running.peer.call({ action: "claim", card: "1" });
		await record(running.peer.board.runtime, running.cwd, { lastSeen: NOW });
		expect(await releaseEnded(running.lead.board.runtime, running.lead.board.ctx)).toBeUndefined();
	});

	test("counts every card it released in one clause", async () => {
		const { cwd, lead, peer } = board();
		for (const title of ["One", "Two"]) await lead.call({ action: "add", title });
		for (const id of ["1", "2"]) await peer.call({ action: "claim", card: id });
		await record(peer.board.runtime, cwd, { pid: DEAD_PID, lastSeen: NOW });

		expect(await releaseEnded(lead.board.runtime, lead.board.ctx)).toBe("released #1 and #2 from sessions that ended");
	});

	test("hands a resumed session back its own card, with the work still on it", async () => {
		// The same name under a new id is what a `/resume` is to the bus. Before this branch the sweep
		// reclaimed the card into the pool on the first turn, taking the lane, the plan and the slot with it.
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await record(peer.board.runtime, cwd, { pid: DEAD_PID, lastSeen: NOW });
		const resumed: BoardSession = { ...lead.board.runtime, who: async () => ({ id: "s-resumed", label: PEER }) };

		expect(await releaseEnded(resumed, lead.board.ctx)).toBe("re-seated #1 in this session");
		const card = (await lead.call({ action: "list", card: "1" })).details.card;
		expect(card?.lane).toBe("plan");
		expect(card?.owner).toMatchObject({ id: "s-resumed", label: PEER });
		// The note is the card's own account: a re-seat writes no lane transition, so without it a reader
		// finds a write by a name that never held the card.
		expect(card?.notes.at(-1)?.text).toContain("whose session had stopped");
	});

	test("says when the record it acted on had been pruned", async () => {
		// A pruned record is the weaker fact — the bus watched nothing stop, it forgot — so the clause a
		// session acts on names which of the two it was.
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		// The bus exists and holds nothing about the peer: its record aged out.
		await record(lead.board.runtime, cwd, { id: LEAD_ID, label: LEAD, pid: DEAD_PID, lastSeen: NOW });
		const resumed: BoardSession = { ...lead.board.runtime, who: async () => ({ id: "s-resumed", label: PEER }) };

		expect(await releaseEnded(resumed, lead.board.ctx)).toBe("re-seated #1 in this session (owner record pruned)");
		expect((await lead.call({ action: "list", card: "1" })).details.card?.owner?.id).toBe("s-resumed");
	});

	test("leaves a live record alone even under this session's own name", async () => {
		// The case a wrong rule would fail silently: the labels match, and the record says that session is
		// running. Nothing is written — neither a re-seat nor a release.
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await record(peer.board.runtime, cwd, { lastSeen: NOW });
		const resumed: BoardSession = { ...lead.board.runtime, who: async () => ({ id: "s-resumed", label: PEER }) };

		expect(await releaseEnded(resumed, lead.board.ctx)).toBeUndefined();
		const card = (await lead.call({ action: "list", card: "1" })).details.card;
		expect(card?.lane).toBe("plan");
		expect(card?.owner?.id).toBe(PEER_ID);
	});

	test("leaves a quiet record under its own name to a later turn", async () => {
		// A quiet record may be a session still in a long turn, so no card moves now. The lock-out is
		// bounded rather than permanent: the next turn after it ages to `gone` re-seats the card.
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await record(peer.board.runtime, cwd, { lastSeen: NOW - 60 * 60 * 1000 });
		const resumed: BoardSession = { ...lead.board.runtime, who: async () => ({ id: "s-resumed", label: PEER }) };

		expect(await releaseEnded(resumed, lead.board.ctx)).toBeUndefined();
		expect((await lead.call({ action: "list", card: "1" })).details.card?.owner?.id).toBe(PEER_ID);
	});

	test("names a re-seated card and a released one in the same sentence", async () => {
		const { cwd, lead, peer } = board();
		for (const title of ["One", "Two"]) await lead.call({ action: "add", title });
		await peer.call({ action: "claim", card: "1" });
		await lead.call({ action: "claim", card: "2" });
		// The peer's record is gone, and so is the one that holds #2 — but only #1 wears the name the
		// resumed session answers to.
		await record(peer.board.runtime, cwd, { pid: DEAD_PID, lastSeen: NOW });
		await record(lead.board.runtime, cwd, { id: LEAD_ID, label: LEAD, pid: DEAD_PID, lastSeen: NOW });
		const resumed: BoardSession = { ...lead.board.runtime, who: async () => ({ id: "s-resumed", label: PEER }) };

		expect(await releaseEnded(resumed, lead.board.ctx)).toBe(
			"re-seated #1 in this session, released #2 from a session that ended",
		);
	});
});
