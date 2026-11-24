/**
 * The sweep at a turn start: the cards a session that ended left behind.
 *
 * The fact this reads is the bus's own — a record whose pid is not running is `gone`, the state
 * `#396` made trustworthy and the reclaim gate already trusts — so the cases here drive the real
 * board and the real record files rather than a stand-in for either. What they pin is the bound on
 * the sweep: `gone` only, refusals skipped, and the sentence naming exactly what this session wrote.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { agentLabel } from "../../lib/session-label.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import { boardTool } from "../../test/helpers/board.ts";
import { cardFile } from "../../test/helpers/board.ts";
import { writeBusRecord } from "../../test/helpers/bus.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { releaseEnded } from "./ended.ts";
import boardExtension from "./index.ts";
import type { BoardPage } from "./page.ts";

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

/**
 * Rewrite a card's own record, for the two shapes no tool call makes: an owner that carries only a
 * label, and a spot-check. The sweep reads the record, so a case about its reading has to write one.
 */
function shaped(agentDir: string, id: string, change: (card: Record<string, unknown>) => void): void {
	const path = cardFile(agentDir, id);
	const card = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	change(card);
	writeFileSync(path, JSON.stringify(card, null, 2));
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

	test("re-seats a pruned owner to the session wearing the same name", async () => {
		// Only the resumed session's record exists: the old id is absent, not gone. A label fallback
		// answered "live" for a session that does not hold the card, so the sweep skipped it forever;
		// the id is what says the owner stopped. `sameLabel` is exact, so the seat is this name and no
		// similarly named session can take the card.
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await record(peer.board.runtime, cwd, { id: "s-resumed", label: PEER, lastSeen: NOW });
		const resumed: BoardSession = { ...lead.board.runtime, who: async () => ({ id: "s-resumed", label: PEER }) };

		expect(await releaseEnded(resumed, lead.board.ctx)).toBe("re-seated #1 in this session (owner record pruned)");
		const card = (await lead.call({ action: "list", card: "1" })).details.card;
		expect(card?.owner).toMatchObject({ id: "s-resumed", label: PEER });
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

/** A page nothing here starts: the turn-start handler is what these cases drive. */
function stubPage(): BoardPage {
	return {
		start: async () => ({ kind: "failed", reason: "no page in this suite" }),
		stop: async () => false,
		status: async () => ({ running: false }),
		dropStale: async () => "live",
		closeAll: async () => {},
	};
}

/** The line a session is handed before its first turn, through the extension's own handler. */
async function turnStart(session: BoardSession, ctx: ExtensionContext): Promise<string | undefined> {
	const fake = createFakePi();
	await withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, async () => {
		boardExtension(fake.pi, { session, page: stubPage() });
	});
	const [handler] = fake.handlers.get("before_agent_start") ?? [];
	if (handler === undefined) throw new Error("the board registered no turn-start handler");
	const result = (await handler({}, ctx)) as { message?: { content?: string } } | undefined;
	return result?.message?.content;
}

describe("the turn start the sweep runs in", () => {
	test("names the card it re-seats as a card, not only as a sentence", async () => {
		// #601: the held list was read before the sweep, so a card handed back this turn reached the
		// transcript as a note about a write and never as a card — and `read` keeps that turn the only
		// one, so the resumed session never saw it at all.
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await record(peer.board.runtime, cwd, { pid: DEAD_PID, lastSeen: NOW });
		const resumed: BoardSession = { ...lead.board.runtime, who: async () => ({ id: "s-resumed", label: PEER }) };

		const content = await turnStart(resumed, lead.board.ctx);
		// The card, with the lane and the step it owes, and the write that put it there.
		expect(content).toContain("[BOARD] 1 card is yours:");
		expect(content).toContain("#1");
		expect(content).toContain("re-seated #1 in this session");
	});

	test("says nothing but the sweep's line when the sweep hands back no card of its own", async () => {
		// The other side of the ordering: a released card is not held, so the line is the note alone —
		// which is what `buildBoardContext` answers for an empty list with something to report.
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await record(peer.board.runtime, cwd, { pid: DEAD_PID, lastSeen: NOW });

		const content = await turnStart(lead.board.runtime, lead.board.ctx);
		expect(content).toContain("released #1 from a session that ended");
		expect(content).not.toContain("is yours");
	});

	/**
	 * The label-only card: the sweep can match it only by name, and a name is what a seat hands over,
	 * so a dead session's record under a live session's label is not evidence about the live one.
	 */
	test("leaves a card alone when its owner is only a label, and names the record it could not read", async () => {
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		shaped(lead.board.agentDir, "1", (card) => {
			const owner = card.owner as { label: string; id?: string };
			owner.id = undefined;
		});
		// The record under the label the card names is dead — and the card cannot say *which* session it
		// meant, because `recordOf` matches only a label. Whoever wears that name now is not asked.
		await record(peer.board.runtime, cwd, { id: PEER_ID, label: PEER, pid: DEAD_PID, lastSeen: NOW });

		// A fresh store, because the record was written under the one the first tools opened: the
		// sweep has to read the card as it is on disk, not as the claim left it in memory.
		const fresh = boardTool({ cwd, agentDir: lead.board.agentDir, lead: LEAD, now: NOW, sessionId: LEAD_ID });
		expect(JSON.parse(readFileSync(cardFile(lead.board.agentDir, "1"), "utf8")).owner).toEqual({ label: PEER });
		const said = await releaseEnded(fresh.board.runtime, fresh.board.ctx);
		expect((await lead.call({ action: "list", card: "1" })).details.card?.lane).toBe("plan");
		expect(said).toContain("only by label");
		expect(said).toContain(PEER);
	});

	/**
	 * The sign a sweep must not take with it: the review is the lead's, the sweeper runs as the lead's
	 * seat, and holding the seat is not the person withdrawing a judgement.
	 */
	test("keeps the review it finds, because a sweep did not make it", async () => {
		const { cwd, lead, peer } = board();
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		shaped(lead.board.agentDir, "1", (card) => {
			card.review = { by: LEAD, at: NOW - 1 };
		});
		await record(peer.board.runtime, cwd, { pid: DEAD_PID, lastSeen: NOW });

		expect(await releaseEnded(lead.board.runtime, lead.board.ctx)).toBe("released #1 from a session that ended");
		const card = (await lead.call({ action: "list", card: "1" })).details.card;
		expect(card?.lane).toBe("backlog");
		expect(card?.review?.by).toBe(LEAD);
	});
});
