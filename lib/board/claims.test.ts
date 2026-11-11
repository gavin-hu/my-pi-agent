/**
 * The lane/claim rule: a card in `execute` holds its paths, and nothing else does.
 *
 * The cases drive the `Claims` seam rather than a bus, so what is proved is the crossing, the
 * silence without a bus, the clause a conflict earns, and the one a release earns when the paths
 * were never the writer's to free. The wiring — which doors cross, and where the clause lands — is
 * `extensions/board/reclaim.test.ts` and `extensions/team/reclaim.test.ts`, because that is the
 * tool's contract rather than this rule's.
 */

import { describe, expect, test } from "bun:test";
import type { Card } from "./card.ts";
import type { MutateResult } from "./store.ts";
import type { ClaimPathsResult, ReleasePathsResult } from "../session-tool.ts";
import { type Claims, holdPaths, reclaimHeld } from "./claims.ts";

/** The label a write made by another session carries: the lead, in a reclaim from a peer. */
const OTHER = "board-lead";

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

describe("what a release could not free", () => {
	test("names the paths the old holder keeps, and how long it keeps them", async () => {
		// `releasePaths` names its caller, so a card taken out of `execute` by another session
		// leaves the holder's claims where they were: the new owner's next claim is refused over
		// exactly these paths, which is the one thing worth a line on the result.
		const claims = bus({ release: { ok: true, released: [], notOwned: ["src/api", "src/web"] } });
		const after = { ...card("backlog"), owner: undefined, by: OTHER };
		expect(await holdPaths(claims, CTX, wrote(card("execute"), after))).toBe(
			"2 paths stay held by api-core until it stops",
		);
		expect(claims.sent).toEqual([{ call: "release", paths: ["src/api", "src/web"] }]);
	});

	test("one path reads as one path", async () => {
		const claims = bus({ release: { ok: true, released: ["src/web"], notOwned: ["src/api"] } });
		const after = { ...card("backlog"), owner: undefined, by: OTHER };
		expect(await holdPaths(claims, CTX, wrote(card("execute"), after))).toBe(
			"1 path stays held by api-core until it stops",
		);
	});

	test("a holder taking its own card back says nothing about what it could not free", async () => {
		// The writer is the holder, so the paths the release missed are a third session's and were
		// named when the card entered — `by` against the owner is the only comparison available,
		// which is why a peer wearing the holder's name reads the same way.
		const claims = bus({ release: { ok: true, released: ["src/api"], notOwned: ["src/web"] } });
		const after = { ...card("backlog"), owner: undefined };
		expect(await holdPaths(claims, CTX, wrote(card("execute"), after))).toBeUndefined();
	});

	test("a card nobody owned keeps the silence", async () => {
		const claims = bus({ release: { ok: true, released: [], notOwned: ["src/api"] } });
		const after = { ...card("backlog"), owner: undefined, by: OTHER };
		expect(await holdPaths(claims, CTX, wrote({ ...card("execute"), owner: undefined }, after))).toBeUndefined();
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

describe("reclaimHeld", () => {
	test("claims only the paths of the cards held in execute, and says nothing on success", async () => {
		const claims = bus();
		expect(
			await reclaimHeld(claims, CTX, [
				card("execute"),
				card("plan", ["src/plan"]),
				card("execute", []),
				card("done", ["src/done"]),
			]),
		).toBeUndefined();
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/api", "src/web"] }]);
	});

	test("names the path a peer holds, instead of dropping the answer", async () => {
		// The answer was discarded before this case existed, which is how a re-claim that could not
		// happen at all stayed invisible.
		const claims = bus({
			claim: {
				ok: true,
				claimed: [],
				conflicts: [{ path: "src/api", owner: "s-2", ownerLabel: "billing-core" }],
			},
		});
		expect(await reclaimHeld(claims, CTX, [card("execute")])).toBe("#4: 1 path already held by billing-core");
	});

	test("asks nothing without a bus, and turns a throw into its sentence", async () => {
		const quiet = bus({ loaded: false });
		expect(await reclaimHeld(quiet, CTX, [card("execute")])).toBeUndefined();
		expect(quiet.sent).toEqual([]);
		const broken = bus({ throws: true });
		expect(await reclaimHeld(broken, CTX, [card("execute")])).toBe("#4: not claimed (the bus went away)");
		expect(broken.sent).toHaveLength(1);
	});
});
