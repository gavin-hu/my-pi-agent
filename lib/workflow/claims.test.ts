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
import {
	claimsBus,
	claimsCard,
	claimsWrite,
	CLAIMS_CTX as CTX,
	CLAIMS_OTHER as OTHER_LABEL,
} from "../../test/helpers/claims.ts";
import { holdPaths } from "./claims.ts";

describe("the lane crossing", () => {
	test("entering execute claims the paths the card names, and says how many", async () => {
		const claims = claimsBus();
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan"), claimsCard("execute")))).toBe(
			"claimed 2 paths",
		);
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/api", "src/web"] }]);
	});

	test("claims what nobody holds and names the rest, where one conflict used to void it", async () => {
		// The card names three paths and a peer holds one. Before this rule the crossing claimed none
		// of them, so a card ran in execute with every other file unprotected.
		const claims = claimsBus({
			claim: (paths) =>
				paths.includes("src/web")
					? { ok: true, claimed: [], conflicts: [{ path: "src/web", owner: "s-2", ownerLabel: "jack" }] }
					: { ok: true, claimed: [...paths], conflicts: [] },
		});
		const after = claimsCard("execute", ["src/api", "src/web", "src/db"]);
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan", ["src/api", "src/web", "src/db"]), after))).toBe(
			"claimed 2 paths, 1 path already held by jack",
		);
		// Two batches, not a per-path loop: the first is the card's whole list, the second its rest.
		expect(claims.sent).toEqual([
			{ call: "claim", paths: ["src/api", "src/web", "src/db"] },
			{ call: "claim", paths: ["src/api", "src/db"] },
		]);
	});

	test("names both holders when a peer takes a free path between the two asks", async () => {
		// The window the second batch opens: a path free at the first ask, gone by the second. The
		// union is what the line must name, and nothing refused may be reported as claimed.
		let asked = 0;
		const claims = claimsBus({
			claim: () => {
				asked += 1;
				return asked === 1
					? { ok: true, claimed: [], conflicts: [{ path: "src/api", owner: "s-2", ownerLabel: "jack" }] }
					: { ok: true, claimed: [], conflicts: [{ path: "src/web", owner: "s-3", ownerLabel: "sam" }] };
			},
		});
		const after = claimsCard("execute", ["src/api", "src/web"]);
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan", ["src/api", "src/web"]), after))).toBe(
			"nothing claimed — 2 paths already held by jack, sam",
		);
	});

	test("a second batch the bus refuses is the door's sentence, not a claimed path", async () => {
		let asked = 0;
		const claims = claimsBus({
			claim: () => {
				asked += 1;
				return asked === 1
					? { ok: true, claimed: [], conflicts: [{ path: "src/api", owner: "s-2", ownerLabel: "jack" }] }
					: { ok: false, error: "the bus is not started" };
			},
		});
		const after = claimsCard("execute", ["src/api", "src/web"]);
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan", ["src/api", "src/web"]), after))).toBe(
			"paths not claimed (the bus is not started)",
		);
	});

	test("a clean crossing asks once, whatever the list is", async () => {
		const claims = claimsBus();
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan"), claimsCard("execute")))).toBe(
			"claimed 2 paths",
		);
		expect(claims.sent).toHaveLength(1);
	});

	test("a conflict is named, and is not a refusal", async () => {
		const claims = claimsBus({
			claim: {
				ok: true,
				claimed: [],
				conflicts: [
					{ path: "src/api", owner: "s-2", ownerLabel: "billing-core" },
					{ path: "src/web", owner: "s-2", ownerLabel: "billing-core" },
				],
			},
		});
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan"), claimsCard("execute")))).toBe(
			"nothing claimed — 2 paths already held by billing-core",
		);
	});

	test("leaving execute releases them, and says nothing", async () => {
		const claims = claimsBus();
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), claimsCard("blocked")))).toBeUndefined();
		expect(claims.sent).toEqual([{ call: "release", paths: ["src/api", "src/web"] }]);
	});

	test("dropping or releasing an execute card releases them too", async () => {
		const dropped = claimsBus();
		expect(
			await holdPaths(dropped, CTX, claimsWrite(claimsCard("execute"), claimsCard("execute"), { dropped: true })),
		).toBeUndefined();
		expect(dropped.sent).toEqual([{ call: "release", paths: ["src/api", "src/web"] }]);
		const released = claimsBus();
		// `release` and `reclaim` write the pool, so the card names the same paths from a new lane.
		expect(
			await holdPaths(
				released,
				CTX,
				claimsWrite(claimsCard("execute"), { ...claimsCard("backlog"), owner: undefined }),
			),
		).toBe(undefined);
		expect(released.sent).toEqual([{ call: "release", paths: ["src/api", "src/web"] }]);
	});
});

describe("an edit inside execute", () => {
	/** The card after an edit, with the paths the case names. */
	const edited = (...paths: string[]): Card => ({ ...claimsCard("execute"), paths, rev: 3 });

	test("claims a path the edit added, and nothing else", async () => {
		const claims = claimsBus();
		expect(
			await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), edited("src/api", "src/web", "src/db"))),
		).toBe("claimed 1 path");
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/db"] }]);
	});

	test("releases a path the edit removed, and nothing else", async () => {
		const claims = claimsBus();
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), edited("src/api")))).toBe("released 1 path");
		expect(claims.sent).toEqual([{ call: "release", paths: ["src/web"] }]);
	});

	test("does both in the claim-first order, and says which each way", async () => {
		const claims = claimsBus();
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), edited("src/api", "src/db")))).toBe(
			"claimed 1 path, released 1 path",
		);
		expect(claims.sent).toEqual([
			{ call: "claim", paths: ["src/db"] },
			{ call: "release", paths: ["src/web"] },
		]);
	});

	test("a conflict on an added path leaves the removals alone, and says so", async () => {
		// All or nothing, the way the batch is: a half-applied edit would free a path while the card
		// still names another one it did not get, so the removals must not stand.
		const claims = claimsBus({
			claim: { ok: true, claimed: [], conflicts: [{ path: "src/db", owner: "s-2", ownerLabel: "billing-core" }] },
		});
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), edited("src/api", "src/db")))).toBe(
			"nothing claimed or released — 1 path already held by billing-core",
		);
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/db"] }]);
	});

	test("takes the added path nobody holds, and still frees nothing while one is refused", async () => {
		// The split reaches the edit too: `src/db` is claimed and `src/ops` is a peer's. The removals
		// must not stand either way — a half-applied edit would free a file the card still names — so
		// the line names both halves and the release that did not happen.
		const claims = claimsBus({
			claim: (paths) =>
				paths.includes("src/ops")
					? { ok: true, claimed: [], conflicts: [{ path: "src/ops", owner: "s-2", ownerLabel: "jack" }] }
					: { ok: true, claimed: [...paths], conflicts: [] },
		});
		expect(
			await holdPaths(
				claims,
				CTX,
				claimsWrite(claimsCard("execute"), edited("src/api", "src/web", "src/db", "src/ops")),
			),
		).toBe("claimed 1 path, 1 path already held by jack, nothing released");
		// The release was never asked: the refusal is what keeps the removed path held.
		expect(claims.sent).toEqual([
			{ call: "claim", paths: ["src/db", "src/ops"] },
			{ call: "claim", paths: ["src/db"] },
		]);
	});

	test("a claim the bus refused is the clause, and still no release", async () => {
		const claims = claimsBus({ claim: { ok: false, error: "the bus is not started" } });
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), edited("src/api", "src/db")))).toBe(
			"paths not claimed (the bus is not started)",
		);
		expect(claims.sent.map((entry) => entry.call)).toEqual(["claim"]);
	});

	test("an edit that reorders the same paths asks the bus nothing", async () => {
		const claims = claimsBus();
		expect(
			await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), edited("src/web", "src/api"))),
		).toBeUndefined();
		expect(claims.sent).toEqual([]);
	});

	test("a removed path this session never held is named rather than counted as freed", async () => {
		const claims = claimsBus({ release: { ok: true, released: [], notOwned: ["src/web"] } });
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), edited("src/api")))).toBe(
			"1 path not held to release",
		);
	});
});

describe("what a release could not free", () => {
	test("names the paths the old holder keeps, and how long it keeps them", async () => {
		// `releasePaths` names its caller, so a card taken out of `execute` by another session
		// leaves the holder's claims where they were: the new owner's next claim is refused over
		// exactly these paths, which is the one thing worth a line on the result.
		const claims = claimsBus({ release: { ok: true, released: [], notOwned: ["src/api", "src/web"] } });
		const after = { ...claimsCard("backlog"), owner: undefined, by: OTHER_LABEL };
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), after))).toBe(
			"2 paths stay held by api-core until it stops",
		);
		expect(claims.sent).toEqual([{ call: "release", paths: ["src/api", "src/web"] }]);
	});

	test("one path reads as one path", async () => {
		const claims = claimsBus({ release: { ok: true, released: ["src/web"], notOwned: ["src/api"] } });
		const after = { ...claimsCard("backlog"), owner: undefined, by: OTHER_LABEL };
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), after))).toBe(
			"1 path stays held by api-core until it stops",
		);
	});

	test("a holder taking its own card back says nothing about what it could not free", async () => {
		// The writer is the holder, so the paths the release missed are a third session's and were
		// named when the card entered — `by` against the owner is the only comparison available,
		// which is why a peer wearing the holder's name reads the same way.
		const claims = claimsBus({ release: { ok: true, released: ["src/api"], notOwned: ["src/web"] } });
		const after = { ...claimsCard("backlog"), owner: undefined };
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), after))).toBeUndefined();
	});

	test("a card nobody owned keeps the silence", async () => {
		const claims = claimsBus({ release: { ok: true, released: [], notOwned: ["src/api"] } });
		const after = { ...claimsCard("backlog"), owner: undefined, by: OTHER_LABEL };
		expect(
			await holdPaths(claims, CTX, claimsWrite({ ...claimsCard("execute"), owner: undefined }, after)),
		).toBeUndefined();
	});
});

describe("what costs nothing", () => {
	test("a write that stays in its lane asks the bus nothing", async () => {
		const claims = claimsBus();
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), claimsCard("execute")))).toBeUndefined();
		// A note on a plan card is the same: the lane did not move.
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan"), claimsCard("plan")))).toBeUndefined();
		expect(claims.sent).toEqual([]);
	});

	test("a card with no paths asks nothing, and says nothing", async () => {
		const claims = claimsBus();
		expect(
			await holdPaths(claims, CTX, claimsWrite(claimsCard("plan", []), claimsCard("execute", []))),
		).toBeUndefined();
		expect(claims.sent).toEqual([]);
	});

	test("no bus is the single-session board, not a failure", async () => {
		const claims = claimsBus({ loaded: false });
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan"), claimsCard("execute")))).toBeUndefined();
		expect(claims.sent).toEqual([]);
	});

	test("a write that changed nothing has no crossing to read", async () => {
		const claims = claimsBus();
		expect(
			await holdPaths(claims, CTX, {
				ok: true,
				card: claimsCard("execute"),
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
		const claims = claimsBus({ claim: { ok: false, error: "the session bus is not loaded" } });
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan"), claimsCard("execute")))).toBe(
			"paths not claimed (the session bus is not loaded)",
		);
	});

	test("a release that is refused says so, because a peer stays blocked", async () => {
		const claims = claimsBus({ release: { ok: false, error: "the bus refused the write" } });
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("execute"), claimsCard("plan")))).toBe(
			"paths not released (the bus refused the write)",
		);
	});

	test("a seam that throws is a sentence, never a failed write", async () => {
		const claims = claimsBus({ throws: true });
		expect(await holdPaths(claims, CTX, claimsWrite(claimsCard("plan"), claimsCard("execute")))).toBe(
			"paths not claimed (the bus went away)",
		);
	});
});
