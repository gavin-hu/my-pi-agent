/**
 * Which merge a finished card landed on: the chain the board reads, the rule that names the merge,
 * and the two doors that ask it.
 *
 * Split from `contract.test.ts` when the landing rule grew the ancestry question: the chain's own
 * cases and the refusal sentences are one capability, and the contract's four lines are another.
 */

import { describe, expect, test } from "bun:test";
import {
	applyOp,
	boardOf,
	closingCard,
	CORE,
	doneOf,
	landingFor as proofOf,
	NOW,
} from "../../test/helpers/fixtures/board-rules.ts";
import {
	type LandingCommit,
	type LandingProof,
	landingFor,
	landingGate,
	movedTree,
	resolveLanding,
	landedWithoutMerge,
	absentFromBranch,
	unprovedLanding,
} from "./landing.ts";
import { workStartedAt } from "./lanes.ts";

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
		const late = proof(LANE.chain, CARRIED, { since: CARRIED_AT + 1 });
		expect(resolveLanding(late, CARRIED, ID)).toEqual({
			error: landedWithoutMerge("main", CARRIED, ID),
			shape: "ancestor",
		});
	});

	test("answers a reviewed merge that is still the tip, so a review of the merged tree holds", () => {
		// A review taken after the merge is a review of the merged tree, and while that merge is the
		// tip it is its own landing: no moved-lines comparison, because a merge cannot be compared to
		// itself.
		expect(resolveLanding(proof(LANE.chain, LATER), LATER, ID)).toEqual({ sha: LATER });
	});

	test("refuses a reviewed merge once the branch has moved past it, naming the door", () => {
		// The pair that used to stand here read "a reviewed merge is its own landing" unconditionally,
		// and that is the defect: #641 closed a card on a merge another card had made. A merge that is
		// no longer the tip carries nothing of its own, so the close refuses and the door is a re-sign.
		expect(resolveLanding(proof(LANE.chain, CARRIED), CARRIED, ID)).toEqual({
			error: landedWithoutMerge("main", CARRIED, ID),
			shape: "ancestor",
		});
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
			error: landedWithoutMerge("main", BASE, ID),
			shape: "ancestor",
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

	test("refuses a review the branch has never seen, and offers no instruction it cannot take", () => {
		// The shape a squash or a rebase leaves: the reviewed commit is nowhere on the branch, so there
		// is nothing for a person's reason to stand in for. The sentence used to promise `override`
		// here — a door the move gate refuses for exactly this shape — and the assertion below is
		// that it stopped.
		const squash = "5d0dd00000000000000000000000000000000000";
		const refused = resolveLanding(proof(LANE.chain, squash), squash, ID);
		expect(refused).toEqual({ error: absentFromBranch("main", squash, ID), shape: "unlanded" });
		if ("error" in refused) {
			expect(refused.error).toContain("#12's spot-check was of `5d0dd00`");
			expect(refused.error).toContain("no merge on `main` carries it");
			expect(refused.error).not.toContain("`override`");
			expect(refused.error).toContain("cannot stand in for");
		}
	});

	test("takes an instruction for a commit the branch holds, and never for one it does not", () => {
		// The two shapes an instruction is offered or refused for, asked at the gate rather than through
		// a card: a commit on the branch that no merge carried can be closed by a person's reason, while
		// a commit the branch has never seen cannot — and the sentence says which is which.
		const onBranch = proof(LANE.chain, CARRIED, { since: CARRIED_AT + 1 });
		expect(landingGate(ID, CARRIED, onBranch, "landed with no merge to point at")).toBeUndefined();
		// The words say which shape it is: a commit the branch holds, carried by nothing.
		expect(landingGate(ID, CARRIED, onBranch)).toContain("which is on `main`");
		expect(landingGate(ID, CARRIED, onBranch)).toContain("may close the card by instruction");
		const nowhere = "5d0dd00000000000000000000000000000000000";
		const absent = proof(LANE.chain, nowhere);
		// And this one says the opposite, because it is the opposite: the commit is nowhere on the branch.
		expect(landingGate(ID, nowhere, absent, "close it")).toContain("not on the branch at all");
		expect(landingGate(ID, nowhere, absent, "close it")).toContain("cannot stand in for");
	});

	test("refuses a merge that moved the tree the review proved, naming the merge", () => {
		const refused = resolveLanding(proof(LANE.chain, REVIEWED, { moved: ["lib/workflow/steps.ts"] }), REVIEWED, ID);
		expect(refused).toEqual({
			error: movedTree("main", REVIEWED, CARRIED, ["lib/workflow/steps.ts"], ID),
			shape: "moved",
		});
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

describe("closing a card by instruction", () => {
	/** The refusal a squash leaves, which is the only shape an instruction answers. */
	const refused = { refusal: "no merge on `main` carries it" };

	test("writes the instruction as a note, and no landing, when the door handed one in", () => {
		// The decision moved to where the chain is read, so `applyOp` applies both halves it is handed:
		// a verdict and an accepted instruction. What it must never do is invent a landing.
		const card = closingCard();
		const held = applyOp(
			card,
			{ ...doneOf(card), landed: refused, instruction: { text: "landed as a squash on main" } },
			CORE,
			NOW,
			boardOf(card),
		);
		expect("ok" in held && held.ok).toBe(true);
		if ("ok" in held && held.ok) {
			expect(held.card.landed).toBeUndefined();
			expect(held.card.notes.at(-1)?.text).toBe("closed by instruction: landed as a squash on main");
		}
	});

	test("writes no note when the door refused the instruction", () => {
		const card = closingCard();
		const held = applyOp(
			card,
			{ ...doneOf(card), landed: refused, instruction: { error: "an instruction cannot stand in for code" } },
			CORE,
			NOW,
			boardOf(card),
		);
		expect("error" in held ? held.error : "").toBe("an instruction cannot stand in for code");
	});

	test("records the landing the verdict names, stamped with the write's own moment", () => {
		const card = closingCard();
		const landed = applyOp(
			card,
			{ ...doneOf(card), landed: { landing: { sha: "abc1234" } } },
			CORE,
			NOW,
			boardOf(card),
		);
		expect("ok" in landed && landed.ok ? landed.card.landed : undefined).toEqual({ sha: "abc1234", at: NOW });
	});

	test("the window is the rule's, not the case's: a merge before the work names nothing", () => {
		// The assertion the cases above need in order to mean anything: their chains carry the reviewed
		// commit *after* the work began, so a pass is the rule answering rather than an empty candidate
		// set. This one moves the same merge behind `workStartedAt` and the answer flips.
		const card = closingCard();
		const started = workStartedAt(card);
		const chain = [
			{ sha: "0".repeat(39) + "1", at: started - 3_000, parents: ["0".repeat(39) + "1"] },
			{ sha: "5d0dd0".padEnd(40, "0"), at: started - 2_000, parents: ["0".repeat(39) + "1"] },
			{ sha: "b".repeat(40), at: started - 1_000, parents: ["5d0dd0".padEnd(40, "0")] },
		];
		const inside = proofOf(card, chain);
		expect(landingGate(card.id, card.review?.verified?.sha, inside)).toContain("on `main`");
		// The same chain read from a card whose work began before it: the window opens, and the refusal
		// above is the rule rather than an empty set.
		const early = { ...card, log: [], createdAt: started - 9_000 };
		expect(landingGate(card.id, card.review?.verified?.sha, proofOf(early, chain))).toContain("on `main`");
	});
});
