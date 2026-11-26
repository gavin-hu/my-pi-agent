/**
 * The re-claim after a restart: a resumed pane takes back the paths of the cards it holds.
 *
 * The bus forgets a session's claims when its process ends, and a session resumed in a new process
 * is holding the same card — so the first turn makes one write the crossing rule does not, and that
 * write is this. Its own suite because the crossing's cases are the lane's and these are a restart's:
 * a case that mixed them would have to say which of the two it was about.
 */

import { describe, expect, test } from "bun:test";
import { claimsBus, claimsCard, CLAIMS_CTX as CTX } from "../../test/helpers/claims.ts";
import { reclaimHeld } from "./claims.ts";

describe("reclaimHeld", () => {
	test("claims only the paths of the cards held in execute, and says nothing on success", async () => {
		const claims = claimsBus();
		expect(
			await reclaimHeld(claims, CTX, [
				claimsCard("execute"),
				claimsCard("plan", ["src/plan"]),
				claimsCard("execute", []),
				claimsCard("done", ["src/done"]),
			]),
		).toBeUndefined();
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/api", "src/web"] }]);
	});

	test("names the path a peer holds, and the one it took beside it", async () => {
		// The answer was discarded before this case existed, which is how a re-claim that could not
		// happen at all stayed invisible. Now the path a peer holds no longer voids the batch, so the
		// line carries both halves: what the resumed pane holds again, and what it could not.
		const claims = claimsBus({
			claim: (paths) =>
				paths.includes("src/api")
					? { ok: true, claimed: [], conflicts: [{ path: "src/api", owner: "s-2", ownerLabel: "billing-core" }] }
					: { ok: true, claimed: [...paths], conflicts: [] },
		});
		expect(await reclaimHeld(claims, CTX, [claimsCard("execute")])).toBe(
			"#4: claimed 1 path, 1 path already held by billing-core",
		);
		expect(claims.sent).toEqual([
			{ call: "claim", paths: ["src/api", "src/web"] },
			{ call: "claim", paths: ["src/web"] },
		]);
	});

	test("is silent when the peer's path was the only one", async () => {
		// Nothing was taken and a peer holds one path: the refusal is the whole answer, worded as the
		// crossing words it so a resumed pane and a crossing read the same way.
		const claims = claimsBus({
			claim: { ok: true, claimed: [], conflicts: [{ path: "src/api", owner: "s-2", ownerLabel: "billing-core" }] },
		});
		expect(await reclaimHeld(claims, CTX, [claimsCard("execute", ["src/api"])])).toBe(
			"#4: nothing claimed — 1 path already held by billing-core",
		);
		expect(claims.sent).toEqual([{ call: "claim", paths: ["src/api"] }]);
	});

	test("asks nothing without a bus, and turns a throw into its sentence", async () => {
		const quiet = claimsBus({ loaded: false });
		expect(await reclaimHeld(quiet, CTX, [claimsCard("execute")])).toBeUndefined();
		expect(quiet.sent).toEqual([]);
		const broken = claimsBus({ throws: true });
		expect(await reclaimHeld(broken, CTX, [claimsCard("execute")])).toBe("#4: not claimed (the bus went away)");
		expect(broken.sent).toHaveLength(1);
	});
});
