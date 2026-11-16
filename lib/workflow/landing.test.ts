/**
 * Which merge a finished card landed on: the chain the board reads, the rule that names the merge,
 * and the two doors that ask it.
 *
 * Split from `contract.test.ts` when the landing rule grew the ancestry question: the chain's own
 * cases and the refusal sentences are one capability, and the contract's four lines are another.
 */

import { describe, expect, test } from "bun:test";
import {
	type LandingCommit,
	type LandingProof,
	landingFor,
	landingGate,
	movedTree,
	resolveLanding,
	reviewedAncestor,
	unlandedReview,
	unprovedLanding,
} from "./contract.ts";

/**
 * The shas a landing case reads: a base commit, the merge that carried a review, and one on top.
 */
/** The card every sentence names. */
const ID = "12";

const REVIEWED = "4c1f9ab0000000000000000000000000000000000";
const CARRIED = "9a7d2e00000000000000000000000000000000000";
const LATER = "b31c5a0000000000000000000000000000000000";
const BASE = "0f00d00000000000000000000000000000000000";
const PLAIN = "e0a1c0000000000000000000000000000000000";

/** The moments those commits were made at, and the moment the card's work began between two of them. */
const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const BASE_AT = T0;
const REVIEWED_AT = T0 + 2 * DAY;
const CARRIED_AT = T0 + 3 * DAY;
const LATER_AT = T0 + 4 * DAY;
/** The card entered `execute` after the base commit and before the merge that carried its work. */
const SINCE = T0 + DAY;

/**
 * A chain of one base commit, the merge that carried `REVIEWED`, and a later merge on top.
 *
 * `carries` reads the fixture's own parents: a merge carries the review when its second parent is
 * it, which is the one-level answer a plain merge gives and the case a re-merge has to override.
 */
const proof = (
	chain: readonly LandingCommit[],
	reviewed = REVIEWED,
	overrides: Partial<LandingProof> = {},
): LandingProof => ({
	branch: "main",
	chain,
	since: SINCE,
	carries: (commit) => commit.parents.slice(1).includes(reviewed),
	...overrides,
});

const LANE = proof([
	{ sha: BASE, at: BASE_AT, parents: ["0000000000000000000000000000000000000001"] },
	{ sha: CARRIED, at: CARRIED_AT, parents: [BASE, REVIEWED] },
	{ sha: LATER, at: LATER_AT, parents: [CARRIED, "7ee0d10000000000000000000000000000000000"] },
]);

describe("resolveLanding", () => {
	test("answers the merge that carried the review, though a later merge landed on top", () => {
		// The case the tip rule got wrong: `A` merges at CARRIED, `B` merges at LATER, and `A` is
		// still the card being closed. A rule that read the tip refused it and asked for an override.
		expect(resolveLanding(LANE, REVIEWED, ID)).toEqual({ sha: CARRIED });
	});

	test("refuses a merge committed before the card's work, so a sign on the checkout's head names nothing", () => {
		// #641: the reviewer ran the gate in the root checkout on `main`, whose head was a merge made
		// before this card existed; `done` then named that merge as the landing. A merge older than
		// the card's own `execute` cannot be its landing, however the chain reads.
		const late = proof(LANE.chain, REVIEWED, { since: CARRIED_AT + 1 });
		expect(resolveLanding(late, CARRIED, ID)).toEqual({ error: reviewedAncestor("main", CARRIED, ID) });
	});

	test("answers a reviewed merge that committed after the card's work is its own landing", () => {
		// The other half of #641, and not a weakened version of the case that encoded the defect: a
		// review taken *after* the merge is a review of the merged tree, and equality is the strongest
		// evidence there is — no moved-lines comparison, because a merge cannot be compared to itself.
		expect(resolveLanding(LANE, CARRIED, ID)).toEqual({ sha: CARRIED });
		expect(resolveLanding(LANE, LATER, ID)).toEqual({ sha: LATER });
	});

	test("follows the ancestry through a re-merge, so a branch merged twice needs no second sign", () => {
		// #618: the branch merged `main` into itself after the review, so the merge on `main` carries a
		// commit whose *own* second parent is the reviewed one. Reading one parent deep refused this.
		const inner = "1d0c0a0000000000000000000000000000000000";
		const again = "2e1d3b0000000000000000000000000000000000";
		const remade = proof(
			[
				{ sha: BASE, at: BASE_AT, parents: ["0000000000000000000000000000000000000001"] },
				{ sha: again, at: LATER_AT, parents: [BASE, inner] },
			],
			REVIEWED,
			{ carries: (commit) => commit.sha === again },
		);
		expect(resolveLanding(remade, REVIEWED, ID)).toEqual({ sha: again });
	});

	test("refuses a plain commit that is on the chain but is not a landing", () => {
		// The #594/#593 shape: a sign taken in the checkout names main's head, a plain commit the
		// merge did not carry. Accepting any ancestor wrote a landing that carried nothing.
		expect(resolveLanding(proof(LANE.chain, BASE), BASE, ID)).toEqual({
			error: reviewedAncestor("main", BASE, ID),
		});
	});

	test("answers a plain commit when it is the chain's tip", () => {
		// A review taken after the work is the tip: there is no merge above it to look for, and it
		// names itself rather than being refused as an older tree.
		const tip = proof([
			{ sha: BASE, at: BASE_AT, parents: ["0000000000000000000000000000000000000001"] },
			{ sha: PLAIN, at: REVIEWED_AT, parents: [BASE] },
		]);
		expect(resolveLanding(tip, PLAIN, ID)).toEqual({ sha: PLAIN });
	});

	test("answers the earliest carrier, not whichever merge comes first in the list", () => {
		// Two merges both carry the reviewed commit, which a criss-cross can produce: the walk is
		// oldest-first and stops at the one that carried the work.
		const crossed = proof([
			{ sha: BASE, at: BASE_AT, parents: ["0000000000000000000000000000000000000001"] },
			{ sha: CARRIED, at: CARRIED_AT, parents: [BASE, REVIEWED] },
			{ sha: LATER, at: LATER_AT, parents: [CARRIED, REVIEWED] },
		]);
		expect(resolveLanding(crossed, REVIEWED, ID)).toEqual({ sha: CARRIED });
	});

	test("refuses a review no merge on the branch carries, naming the override", () => {
		const squash = "5d0dd00000000000000000000000000000000000";
		const refused = resolveLanding(proof(LANE.chain, squash), squash, ID);
		expect(refused).toEqual({ error: unlandedReview("main", squash, ID) });
		if ("error" in refused) {
			expect(refused.error).toContain("#12's spot-check was of `5d0dd00`");
			expect(refused.error).toContain("no merge on `main` carries it");
			expect(refused.error).toContain("`override`");
		}
	});

	test("refuses a merge that moved the tree the review proved, naming the merge", () => {
		const refused = resolveLanding(proof(LANE.chain, REVIEWED, { moved: ["lib/workflow/steps.ts"] }), REVIEWED, ID);
		expect(refused).toEqual({ error: movedTree("main", REVIEWED, CARRIED, ["lib/workflow/steps.ts"], ID) });
		// The distinction the sentence carries: the merge, not the review, is the unchecked tree.
		if ("error" in refused) {
			expect(refused.error).toContain("the merge that carried it on `main`, `9a7d2e0`, moved lib/workflow/steps.ts");
			expect(refused.error).toContain("the merge is what nobody ran the gate on");
		}
	});

	test("names three moved paths and counts the rest, so a refusal stays one line", () => {
		const moved = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
		const said = movedTree("main", REVIEWED, CARRIED, moved, ID);
		expect(said).toContain("moved a.ts, b.ts, c.ts and 2 more");
	});

	test("says a chain that was never read is a refusal, not a pass", () => {
		expect(unprovedLanding(ID, REVIEWED)).toContain("the branch it landed on was not read");
	});
});

describe("the gate a landing answers", () => {
	test("owes nothing when the sign named no commit, because there is no branch to resolve", () => {
		expect(landingGate(ID, undefined, LANE)).toBeUndefined();
		expect(landingFor(ID, undefined, LANE, 7)).toBeUndefined();
	});

	test("refuses a sign whose branch was never read, rather than waving it through", () => {
		expect(landingGate(ID, REVIEWED, undefined)).toContain("the branch it landed on was not read");
		expect(landingFor(ID, REVIEWED, undefined, 7)).toBeUndefined();
	});

	test("records the merge the review became, stamped with the write's moment", () => {
		expect(landingGate(ID, REVIEWED, LANE)).toBeUndefined();
		expect(landingFor(ID, REVIEWED, LANE, 7)).toEqual({ sha: CARRIED, at: 7 });
	});
});
