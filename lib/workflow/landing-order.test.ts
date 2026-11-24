/**
 * Whether the card's own `execute` came first — the shape a squashing repository reaches by landing
 * and only then moving the card to `execute` (#475).
 *
 * Split from `landing.test.ts` by capability when that suite crossed the size bar: the question here
 * is the card's order, not which merge a review became. Both sentences answer "a commit on the chain
 * that cannot be this card's landing", and they send the reader to different doors — `#641` closes
 * that door for a merge signed on the checkout's head, this one for a squash landing made too early.
 */

import { describe, expect, test } from "bun:test";
import { BASE, BASE_AT, ID, REVIEWED_AT, ROOT, commit, proof } from "../../test/helpers/fixtures/landing-chain.ts";
import { beforeExecute, resolveLanding } from "./landing.ts";

/** A squashing repository's landing: one commit whose subject ends with the card's id (#440). */
const SQUASH = "9405a26600000000000000000000000000000000";
const squashed = [
	commit(BASE, BASE_AT, [ROOT], "chore(repo): the base the branch was cut from"),
	commit(SQUASH, REVIEWED_AT, [BASE], "docs(docs): 看板认落地读的是时序（#12）"),
];

describe("the card's own execute", () => {
	test("refuses a squash landing committed before the card entered `execute`, naming the order", () => {
		// #475's shape, taken from a real card: the work landed, and the card only moved to `execute`
		// afterwards — 28 seconds later. The commit is on the chain and its subject names the card, so
		// every squash shape fits except the one that matters: it predates `since`. The old sentence
		// spoke of a merge a squashing repository never makes, which sent the owner to `override`.
		const after = proof(squashed, SQUASH, { since: REVIEWED_AT + 1 });
		const refused = resolveLanding(after, SQUASH, ID);

		expect(refused).toEqual({ error: beforeExecute("main", SQUASH, ID), shape: "before-execute" });
		// The whole point of the card: the sentence says **which** order was wrong and what to do
		// instead. It must not offer an instruction, because an instruction cannot fix an order.
		if ("error" in refused) {
			expect(refused.error).toContain("before this card entered `execute`");
			expect(refused.error).toContain("since");
			expect(refused.error).toContain("relocate the landing");
			expect(refused.error).not.toContain("override");
		}
	});

	test("answers the same landing when the card entered `execute` before the commit", () => {
		// The positive direction, and what "no `override` needed" means at this level: `since` is the
		// chain's default, which sits before the commit, and the squash shape answers with no instruction.
		expect(resolveLanding(proof(squashed, SQUASH), SQUASH, ID)).toEqual({ sha: SQUASH });
	});
});

/**
 * The folded card, which is where this order meets a landing it cannot name (#814, #828).
 *
 * A card's work ships inside another card's merge, and the card only enters `execute` after the
 * spot-check that followed it. Read forward, the order rule refuses — correctly, because no commit
 * after `since` carries this work. What answers it is not an instruction but a name: the merge the
 * review came after, declared by the close and checked at or below that review.
 */
describe("a folded card's landing", () => {
	// The other card's merge, the spot-check at the tip above it, and a card whose `execute` came last.
	const MERGE = "a11c000000000000000000000000000000000000";
	const TIP = "b0b0000000000000000000000000000000000";
	const chain = [
		commit(BASE, BASE_AT, [ROOT], "chore(repo): the base the branch was cut from"),
		commit(MERGE, REVIEWED_AT, [BASE, "7ee0d10000000000000000000000000000000000"], "merge(work): #819's landing"),
		commit(TIP, REVIEWED_AT + 1_000, [MERGE], "merge(main): the next card's landing"),
	];
	const folded = proof(chain, TIP, { since: REVIEWED_AT + 2_000 });

	test("refuses the order by itself, so the fix is not a fourth attempt at the sentence", () => {
		expect(resolveLanding(folded, TIP, ID)).toEqual({
			error: beforeExecute("main", TIP, ID),
			shape: "before-execute",
		});
	});

	test("closes when the card names the merge its work landed in", () => {
		expect(resolveLanding(folded, TIP, ID, MERGE)).toEqual({ sha: MERGE });
	});
});
