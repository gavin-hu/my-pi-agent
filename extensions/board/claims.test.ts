/**
 * The lane/claim rule: a card in `execute` holds its paths, and nothing else does.
 *
 * The first cases drive the `Claims` seam rather than a bus, so what is proved is the crossing,
 * the silence without a bus, and the one clause a conflict earns. The last two go through the
 * tool, because the wiring — which actions take a crossing, and where the clause lands — is not
 * something the seam's own cases can see.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardHarness } from "../../test/helpers/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { registerTools } from "./tools.ts";
import { provedPlan } from "./proof.ts";
import type { Card } from "../../lib/board/card.ts";
import type { MutateResult } from "../../lib/board/store.ts";
import type { ClaimPathsResult, ReleasePathsResult } from "../../lib/session-tool.ts";
import { type Claims, holdPaths, reclaimHeld } from "./claims.ts";
import type { BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;
/** A lead no session in this suite is, so the sign is somebody else's and the holder can move. */
const LEAD = "board-lead";

/** A card with the two facts a crossing reads. */
function card(lane: Card["lane"], paths: string[] = ["src/api", "src/web"]): Card {
	return {
		v: 2,
		id: "4",
		title: "Rate limits",
		lane,
		paths,
		notes: [],
		notesDropped: 0,
		owner: { id: "s-1", label: "api-core" },
		rev: 2,
		createdAt: 1,
		updatedAt: 1,
		by: "api-core",
		log: [{ lane, at: 1, by: "api-core" }],
		logDropped: 0,
	};
}

/** One recorded call, and the answer it gave. */
interface Sent {
	call: "claim" | "release";
	paths: readonly string[];
}

/** The bus as this module sees it: what it recorded, and what it answers. */
function bus(
	options: { loaded?: boolean; claim?: ClaimPathsResult; release?: ReleasePathsResult; throws?: boolean } = {},
): Claims & { sent: Sent[] } {
	const sent: Sent[] = [];
	return {
		sent,
		loaded: () => options.loaded ?? true,
		claim: async (_ctx, paths) => {
			sent.push({ call: "claim", paths });
			if (options.throws === true) throw new Error("the bus went away");
			return options.claim ?? { ok: true, claimed: [...paths], conflicts: [] };
		},
		release: async (_ctx, paths) => {
			sent.push({ call: "release", paths });
			if (options.throws === true) throw new Error("the bus went away");
			return options.release ?? { ok: true, released: [...paths], notOwned: [] };
		},
	};
}

/** A successful write of `after`, which read `before`. */
function wrote(before: Card, after: Card, extra: { dropped?: boolean } = {}): MutateResult {
	return {
		ok: true,
		card: after,
		changed: true,
		dropped: extra.dropped ?? false,
		archived: false,
		previous: before,
	};
}

const CTX = {} as never;

/** One board whose card is ready to enter `execute`, and the claims it reports. */
async function executable(): Promise<{
	call: (args: Record<string, unknown>) => Promise<{ details: BoardDetails; text: string }>;
	claims: Claims & { sent: Sent[] };
}> {
	const claims = bus();
	const board = boardHarness({ now: NOW, lead: LEAD, track: temps.track });
	registerTools(board.fake.pi, board.runtime, { claims });
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
	await call({ action: "contract", card: "1", path: plan, goal: "g", acceptance: "a", scopeOut: "s" });
	// The lead signs through the store, because this suite's session is the holder: `approve`
	// refuses a holder, which is the gate the tool's own case in `signs.test.ts` proves.
	const store = await board.runtime.store(board.ctx.cwd);
	const approved = await store.mutate(
		"1",
		{ kind: "approve", artifact: await provedPlan(board.runtime, board.ctx.cwd, store, "1") },
		{ label: LEAD },
		NOW,
	);
	if (!approved.ok) throw new Error(`the lead could not sign: ${approved.error}`);
	return { call, claims };
}

describe("the lane crossing", () => {
	test("entering execute claims the paths the card names, and says how many", async () => {
		const claims = bus();
		expect(await holdPaths(claims, CTX, wrote(card("plan"), card("execute")))).toBe("claimed 2 paths");
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/api", "src/web"] }]);
	});

	test("a conflict is named, and is not a refusal", async () => {
		const claims = bus({
			claim: {
				ok: true,
				claimed: [],
				conflicts: [
					{ path: "src/api", owner: "s-2", ownerLabel: "billing-core" },
					{ path: "src/web", owner: "s-2", ownerLabel: "billing-core" },
				],
			},
		});
		expect(await holdPaths(claims, CTX, wrote(card("plan"), card("execute")))).toBe(
			"2 paths already held by billing-core",
		);
	});

	test("leaving execute releases them, and says nothing", async () => {
		const claims = bus();
		expect(await holdPaths(claims, CTX, wrote(card("execute"), card("blocked")))).toBeUndefined();
		expect(claims.sent).toEqual([{ call: "release", paths: ["src/api", "src/web"] }]);
	});

	test("dropping or releasing an execute card releases them too", async () => {
		const dropped = bus();
		expect(await holdPaths(dropped, CTX, wrote(card("execute"), card("execute"), { dropped: true }))).toBeUndefined();
		expect(dropped.sent).toEqual([{ call: "release", paths: ["src/api", "src/web"] }]);
		const released = bus();
		// `release` and `reclaim` write the pool, so the card names the same paths from a new lane.
		expect(await holdPaths(released, CTX, wrote(card("execute"), { ...card("backlog"), owner: undefined }))).toBe(
			undefined,
		);
		expect(released.sent).toEqual([{ call: "release", paths: ["src/api", "src/web"] }]);
	});
});

describe("what costs nothing", () => {
	test("a write that stays in its lane asks the bus nothing", async () => {
		const claims = bus();
		expect(await holdPaths(claims, CTX, wrote(card("execute"), card("execute")))).toBeUndefined();
		// A note on a plan card is the same: the lane did not move.
		expect(await holdPaths(claims, CTX, wrote(card("plan"), card("plan")))).toBeUndefined();
		expect(claims.sent).toEqual([]);
	});

	test("a card with no paths asks nothing, and says nothing", async () => {
		const claims = bus();
		expect(await holdPaths(claims, CTX, wrote(card("plan", []), card("execute", [])))).toBeUndefined();
		expect(claims.sent).toEqual([]);
	});

	test("no bus is the single-session board, not a failure", async () => {
		const claims = bus({ loaded: false });
		expect(await holdPaths(claims, CTX, wrote(card("plan"), card("execute")))).toBeUndefined();
		expect(claims.sent).toEqual([]);
	});

	test("a write that changed nothing has no crossing to read", async () => {
		const claims = bus();
		expect(
			await holdPaths(claims, CTX, {
				ok: true,
				card: card("execute"),
				changed: false,
				dropped: false,
				archived: false,
			}),
		).toBeUndefined();
		expect(claims.sent).toEqual([]);
	});
});

describe("when the bus refuses", () => {
	test("a claim that is refused is a sentence on the result", async () => {
		const claims = bus({ claim: { ok: false, error: "the session bus is not loaded" } });
		expect(await holdPaths(claims, CTX, wrote(card("plan"), card("execute")))).toBe(
			"paths not claimed (the session bus is not loaded)",
		);
	});

	test("a release that is refused says so, because a peer stays blocked", async () => {
		const claims = bus({ release: { ok: false, error: "the bus refused the write" } });
		expect(await holdPaths(claims, CTX, wrote(card("execute"), card("plan")))).toBe(
			"paths not released (the bus refused the write)",
		);
	});

	test("a seam that throws is a sentence, never a failed write", async () => {
		const claims = bus({ throws: true });
		expect(await holdPaths(claims, CTX, wrote(card("plan"), card("execute")))).toBe(
			"paths not claimed (the bus went away)",
		);
	});
});

describe("through the board tool", () => {
	test("a move into execute carries the claim on the result", async () => {
		const { call, claims } = await executable();
		const moved = await call({ action: "move", card: "1", lane: "execute" });
		expect(moved.details.card?.lane).toBe("execute");
		expect(moved.details.held).toBe("claimed 1 path");
		// The clause carries the continuation indent its neighbours do, so it reads as a line of
		// the card rather than as a second card.
		expect(moved.text).toContain("\n  claimed 1 path");
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/api"] }]);
	});

	test("leaving execute releases them, and says nothing", async () => {
		const { call, claims } = await executable();
		await call({ action: "move", card: "1", lane: "execute" });
		claims.sent.length = 0;
		const parked = await call({ action: "move", card: "1", lane: "blocked", blocker: "decision" });
		expect(parked.details.card?.lane).toBe("blocked");
		expect(parked.details.held).toBeUndefined();
		expect(claims.sent).toEqual([{ call: "release", paths: ["src/api"] }]);
	});
});

describe("reclaimHeld", () => {
	test("claims only the paths of the cards held in execute", async () => {
		const claims = bus();
		await reclaimHeld(claims, CTX, [
			card("execute"),
			card("plan", ["src/plan"]),
			card("execute", []),
			card("done", ["src/done"]),
		]);
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/api", "src/web"] }]);
	});

	test("asks nothing without a bus, and never throws", async () => {
		const quiet = bus({ loaded: false });
		await reclaimHeld(quiet, CTX, [card("execute")]);
		expect(quiet.sent).toEqual([]);
		const broken = bus({ throws: true });
		await reclaimHeld(broken, CTX, [card("execute")]);
		expect(broken.sent).toHaveLength(1);
		temps.flush();
	});
});
