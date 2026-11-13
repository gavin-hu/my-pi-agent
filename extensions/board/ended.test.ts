/**
 * The sweep at a turn start: the cards a session that ended left behind.
 *
 * The fact this reads is the bus's own — a record whose pid is not running is `gone`, the state
 * `#396` made trustworthy and the reclaim gate already trusts — so the cases here drive the real
 * board and the real record files rather than a stand-in for either. What they pin is the bound on
 * the sweep: `gone` only, refusals skipped, and the sentence naming exactly what this session wrote.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { presetNameFor } from "../../lib/session-label.ts";
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
const LEAD = presetNameFor(LEAD_ID) ?? "s-lead";
const PEER = presetNameFor(PEER_ID) ?? "s-peer";

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
});
