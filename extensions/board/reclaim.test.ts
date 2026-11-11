/**
 * `reclaim` through the tool: the one action whose gate reads a fact off the bus.
 *
 * The action moved to its own suite because it is the only one that needs a second session's
 * record as well as a card: `board`'s tool suite is the surface every action shares, and this is
 * the case where a refusal depends on what the bus says about somebody else. The rest of the
 * operation — the gate, the words, what returns to the pool — is `lib/board/reclaim.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { presetNameFor } from "../../lib/session-label.ts";
import { boardTool } from "../../test/helpers/board.ts";
import { writeBusRecord } from "../../test/helpers/bus.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;

/** The sessions these cases work as, and the names their ids draw. */
const LEAD_ID = "s-lead";
const PEER_ID = "s-peer";
const LEAD = presetNameFor(LEAD_ID) ?? "s-lead";
const PEER = presetNameFor(PEER_ID) ?? "s-peer";

/**
 * One board, and three sessions' tools over it: the lead the repository names, the peer that holds
 * the card, and a third session with no card of its own.
 */
function board() {
	const cwd = temps.track(tempDir("pi-repo-"));
	const agentDir = temps.track(tempDir("pi-agent-"));
	const open = (sessionId: string) => boardTool({ cwd, agentDir, lead: LEAD, now: NOW, sessionId });
	return { cwd, lead: open(LEAD_ID), peer: open(PEER_ID), other: open("s-other") };
}

describe("a peer's reclaim", () => {
	test("is refused while the holder is running, and the lead's is not", async () => {
		const { cwd, lead, peer, other } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		// A heartbeat this fresh says the holder is running, so its card is its own.
		writeBusRecord(await peer.board.runtime.busDir(cwd), { id: PEER_ID, label: PEER, lastSeen: NOW });

		const refused = await other.call({ action: "reclaim", card: "1" });
		expect(refused.details.error).toContain(`#1 is held by ${PEER}`);
		expect(refused.details.error).toContain(`only the lead (${LEAD})`);
		// The refusal carries the card it left alone, so the next call starts from the truth.
		expect(refused.details.card?.owner?.label).toBe(PEER);

		const taken = await lead.call({ action: "reclaim", card: "1" });
		expect(taken.details.error).toBeUndefined();
		expect(taken.details.card).toMatchObject({ lane: "backlog", by: LEAD });
		expect(taken.details.card?.owner).toBeUndefined();
	});

	test("a holder the bus has no record of is the lead's card too", async () => {
		// A live session that never joined writes no record either, so `absent` is not proof that
		// anything stopped: a peer is refused here as well, with the sentence that says why.
		const { cwd, lead, peer, other } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		// A bus that exists and names somebody else, so the holder is `absent` rather than unknown.
		writeBusRecord(await other.board.runtime.busDir(cwd), { id: LEAD_ID, label: LEAD, lastSeen: NOW });

		const refused = await other.call({ action: "reclaim", card: "1" });
		expect(refused.details.error).toContain(`#1 is held by ${PEER}`);
		expect(refused.details.error).toContain("The bus has no record of that session");
		expect(refused.details.card?.owner?.label).toBe(PEER);
	});

	test("a board with no bus at all leaves the repair to the lead", async () => {
		// No bus is a question rather than an answer, and the refusal says which one it is.
		const { lead, peer, other } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });

		const refused = await other.call({ action: "reclaim", card: "1" });
		expect(refused.details.error).toContain("Nothing here says whether that session is running");
		expect((await lead.call({ action: "reclaim", card: "1" })).details.card?.lane).toBe("backlog");
	});
});
