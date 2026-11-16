/**
 * `reclaim` through the tool: the one action whose gate reads a fact off the bus, and the crossing
 * its write reports.
 *
 * The action moved to its own suite because it is the only one that needs a second session's
 * record as well as a card: `board`'s tool suite is the surface every action shares, and this is
 * the case where a refusal depends on what the bus says about somebody else. The rest of the
 * operation — the gate, the words, what returns to the pool — is `lib/workflow/reclaim.test.ts`, and
 * the crossing's own rule is `lib/workflow/claims.test.ts`; what is here is the wiring, which no seam
 * case can see.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Claims } from "../../lib/workflow/claims.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import type { SendInput } from "../../lib/session-tool.ts";
import type { Deliver } from "../../lib/session-tool.ts";
import { agentLabel } from "../../lib/session-label.ts";
import type { ClaimPathsResult, ReleasePathsResult } from "../../lib/session-tool.ts";
import { boardHarness, boardTool } from "../../test/helpers/board.ts";
import { writeBusRecord } from "../../test/helpers/bus.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { provedPlan } from "./proof.ts";
import { registerTools } from "./tools.ts";
import type { BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;

/** The sessions these cases work as, and the names their ids draw. */
const LEAD_ID = "s-lead";
const PEER_ID = "s-peer";
const LEAD = agentLabel(LEAD_ID);
const PEER = agentLabel(PEER_ID);
/** The session that holds the card in the crossing cases, named by its bus record. */
const HOLDER = "billing-core";

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

describe("a reclaim's message", () => {
	/** A board for one session, with the delivery seam recorded. */
	function recorder(sessionId: string, dirs: { cwd?: string; agentDir?: string } = {}) {
		const sent: SendInput[] = [];
		const notify: Deliver = {
			send: async (_ctx, input) => {
				sent.push(input);
				return { ok: true, delivered: [input.to], failed: [] };
			},
			peers: async () => undefined,
		};
		const board = boardHarness({ now: NOW, lead: LEAD, track: temps.track, sessionId, ...dirs });
		registerTools(board.fake.pi, board.runtime, { notify });
		const tool = board.fake.pi.tools.get("board");
		if (!tool) throw new Error("the board tool was not registered");
		const call = async (args: Record<string, unknown>) =>
			(await tool.execute("call-1", args, undefined, undefined, board.ctx)) as {
				content: Array<{ text: string }>;
				details: BoardDetails;
				isError?: boolean;
			};
		return { board, call, sent };
	}

	test("tells the owner whose card it took, keyed to the card and about it", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = recorder(LEAD_ID, { cwd, agentDir });
		const peer = recorder(PEER_ID, { cwd, agentDir });
		await lead.call({ action: "add", title: "One" });
		// The card is the peer's, claimed through the same store the lead's tool reads.
		await (await peer.board.runtime.store(peer.board.ctx.cwd)).mutate(
			"1",
			{ kind: "claim" },
			{ id: PEER_ID, label: PEER },
			NOW,
		);
		writeBusRecord(await lead.board.runtime.busDir(lead.board.ctx.cwd), { id: PEER_ID, label: PEER, lastSeen: NOW });

		const taken = await lead.call({ action: "reclaim", card: "1" });
		expect(taken.isError).toBeFalsy();
		expect(lead.sent).toHaveLength(1);
		expect(lead.sent[0]).toMatchObject({ kind: "event", to: PEER_ID, about: "1" });
		expect(lead.sent[0]?.text).toContain("Taken back");
		expect(lead.sent[0]?.key).toBe(`card:1:reclaim:${taken.details.card?.updatedAt}`);
	});

	test("a holder releasing its own card is not told anything", async () => {
		// The holder's own reclaim is a release by another name: the card is already its reader's,
		// and a message to itself would be a fact it just wrote.
		const peer = recorder(PEER_ID);
		await peer.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		const taken = await peer.call({ action: "reclaim", card: "1" });
		expect(taken.isError).toBeFalsy();
		expect(peer.sent).toEqual([]);
	});
});

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

/**
 * The bus a lane crossing writes to: every claim is taken, and a release frees what the caller
 * holds — `notOwned` is what it could not, which is every path of a card somebody else holds.
 */
function bus(
	notOwned: readonly string[] = [],
): Claims & { sent: Array<{ call: "claim" | "release"; paths: readonly string[] }> } {
	const sent: Array<{ call: "claim" | "release"; paths: readonly string[] }> = [];
	return {
		sent,
		loaded: () => true,
		claim: async (_ctx, paths): Promise<ClaimPathsResult> => {
			sent.push({ call: "claim", paths });
			return { ok: true, claimed: [...paths], conflicts: [] };
		},
		release: async (_ctx, paths): Promise<ReleasePathsResult> => {
			sent.push({ call: "release", paths });
			return { ok: true, released: paths.filter((path) => !notOwned.includes(path)), notOwned: [...notOwned] };
		},
	};
}

/** One board whose card 1 is ready to enter `execute`, worked by the session that holds it. */
async function executable(claims: Claims): Promise<{
	cwd: string;
	agentDir: string;
	/** The holder's own session, so a case can make the write the tool would not. */
	runtime: BoardSession;
	call: (args: Record<string, unknown>) => Promise<{ details: BoardDetails; text: string }>;
}> {
	const board = boardHarness({ now: NOW, lead: LEAD, track: temps.track, claims, sessionId: "s-holder" });
	// The holder's name is the record's, so the clause has one word to name rather than a drawn
	// recorded: a card's owner is what a release cannot free, and the label is what it prints.
	writeBusRecord(await board.runtime.busDir(board.ctx.cwd), { id: "s-holder", label: HOLDER, lastSeen: NOW });
	registerTools(board.fake.pi, board.runtime);
	const tool = board.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	const call = async (args: Record<string, unknown>): Promise<{ details: BoardDetails; text: string }> => {
		const result = (await tool.execute("call-1", args, undefined, undefined, board.ctx)) as {
			content: Array<{ text: string }>;
			details: BoardDetails;
		};
		return { details: result.details, text: result.content[0]?.text ?? "" };
	};
	await call({ action: "add", title: "One", paths: ["src/api"] });
	await call({ action: "claim", card: "1" });
	// A plan file in this repository's store, which `contract` requires and `move` proves.
	const dir = await board.runtime.planDir(board.ctx.cwd);
	mkdirSync(dir, { recursive: true });
	const plan = join(dir, "one.md");
	writeFileSync(plan, "# One\n");
	await call({
		action: "contract",
		card: "1",
		path: plan,
		goal: "g",
		acceptance: "a",
		scopeOut: "s",
		verify: "bun run check",
	});
	// The lead signs through the store, because this session is the holder: `approve` refuses a
	// holder, which is the gate the tool's own case in `signs.test.ts` proves.
	const store = await board.runtime.store(board.ctx.cwd);
	const approved = await store.mutate(
		"1",
		{ kind: "approve", artifact: await provedPlan(board.runtime, board.ctx.cwd, store, "1") },
		{ label: LEAD },
		NOW,
	);
	if (!approved.ok) throw new Error(`the lead could not sign: ${approved.error}`);
	return { cwd: board.ctx.cwd, agentDir: board.agentDir, runtime: board.runtime, call };
}

describe("the crossing the tool reports", () => {
	test("a move into execute carries the claim on the result", async () => {
		const claims = bus();
		const { call } = await executable(claims);
		const moved = await call({ action: "move", card: "1", lane: "execute" });
		expect(moved.details.card?.lane).toBe("execute");
		expect(moved.details.held).toBe("claimed 1 path");
		// The clause carries the continuation indent its neighbours do, so it reads as a line of
		// the card rather than as a second card.
		expect(moved.text).toContain("\n  claimed 1 path");
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/api"] }]);
	});

	test("leaving execute releases them, and says nothing", async () => {
		const claims = bus();
		const { call } = await executable(claims);
		await call({ action: "move", card: "1", lane: "execute" });
		claims.sent.length = 0;
		const parked = await call({ action: "move", card: "1", lane: "blocked", blocker: "decision" });
		expect(parked.details.card?.lane).toBe("blocked");
		expect(parked.details.held).toBeUndefined();
		expect(claims.sent).toEqual([{ call: "release", paths: ["src/api"] }]);
	});

	test("an edit inside execute diffs the claims, and the card reports which way", async () => {
		// The trap #596 lost the paths to: `edit` changed the hints and nothing else asked the bus, so
		// an added path was free for a peer and a removed one still blocked them.
		const claims = bus();
		const { call } = await executable(claims);
		await call({ action: "move", card: "1", lane: "execute" });
		claims.sent.length = 0;
		const edited = await call({ action: "edit", card: "1", paths: ["src/web"] });
		expect(edited.details.card?.paths).toEqual(["src/web"]);
		expect(edited.details.held).toBe("claimed 1 path, released 1 path");
		expect(edited.text).toContain("\n  claimed 1 path, released 1 path");
		expect(claims.sent).toEqual([
			{ call: "claim", paths: ["src/web"] },
			{ call: "release", paths: ["src/api"] },
		]);
	});

	test("an edit that changes no path asks the bus nothing", async () => {
		const claims = bus();
		const { call } = await executable(claims);
		await call({ action: "move", card: "1", lane: "execute" });
		claims.sent.length = 0;
		const edited = await call({ action: "edit", card: "1", title: "One, renamed" });
		expect(edited.details.card?.title).toBe("One, renamed");
		expect(edited.details.held).toBeUndefined();
		expect(claims.sent).toEqual([]);
	});

	test("the lead closes a signed card whose holder the bus does not have", async () => {
		// #657: the holder's session ended while the card was signed and landed. `move done` was the
		// holder's, `review` refused a card the lead could hold, and a reclaim only moved the problem —
		// so the tool reads the holder for a `done` and the rule admits the lead when it is absent.
		const claims = bus();
		const { call, cwd, agentDir, runtime } = await executable(claims);
		await call({ action: "move", card: "1", lane: "execute" });
		const store = await runtime.store(cwd);
		// A spot-check with no commit named: this repository is not git, so the close owes no landing.
		const signed = await store.mutate(
			"1",
			{ kind: "review", verified: { cmd: "bun run check", exit: 0, at: NOW } },
			{ label: LEAD },
			NOW,
		);
		if (!signed.ok) throw new Error(`the lead could not sign: ${signed.error}`);
		// The bus still exists — it holds this holder's record — but the process behind it ended, which
		// is the `gone` reading; the rule suite also proves the `absent` one, which is #653's own shape.
		writeBusRecord(await runtime.busDir(cwd), { id: "s-holder", label: HOLDER, pid: 999_999_999, lastSeen: NOW });
		const lead = boardTool({ cwd, agentDir, lead: LEAD, now: NOW, sessionId: "s-lead", claims });
		const closed = await lead.call({ action: "move", card: "1", lane: "done" });
		expect(resultText(closed)).toContain("done");
		expect(closed.details.card?.lane).toBe("done");
		expect(closed.details.card?.review?.by).toBe(LEAD);
	});

	test("a reclaim from the holder's session names nothing it could not free", async () => {
		// The holder takes its own card back, so the release is its own and frees them: a quiet
		// result is the right one, and the paths it could not take were named at entry.
		const claims = bus(["src/api"]);
		const { call } = await executable(claims);
		await call({ action: "move", card: "1", lane: "execute" });
		const taken = await call({ action: "reclaim", card: "1" });
		expect(taken.details.card?.lane).toBe("backlog");
		expect(taken.details.held).toBeUndefined();
	});

	test("a lead's reclaim names the paths the holder still has", async () => {
		// The card is another session's, so the release frees nothing and the clause is the only
		// notice anybody gets: the holder's claims outlive the card until that session stops.
		const claims = bus(["src/api"]);
		const { call, cwd, agentDir } = await executable(claims);
		await call({ action: "move", card: "1", lane: "execute" });
		// A lead's session, named by its bus record, which outranks the name `who` would derive.
		const lead = boardTool({ cwd, agentDir, lead: LEAD, now: NOW, sessionId: "s-repair", claims });
		writeBusRecord(await lead.board.runtime.busDir(cwd), { id: "s-repair", label: LEAD, lastSeen: NOW });
		const taken = await lead.call({ action: "reclaim", card: "1" });
		expect(taken.details.card?.lane).toBe("backlog");
		expect(taken.details.held).toBe(`1 path stays held by ${HOLDER} until it stops`);
		expect(resultText(taken)).toContain(`\n  1 path stays held by ${HOLDER} until it stops`);
	});
});
