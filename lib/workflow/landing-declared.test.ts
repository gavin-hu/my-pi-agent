/**
 * The landing a card names for itself, and the door onto it (#814's shape, #828's rule).
 *
 * Split from `landing.test.ts` by capability when the declaration joined the rule: that suite reads
 * which merge a review became, and this one reads the answer a card gives when nothing on the chain
 * can name a landing — the three checks that keep the name honest, and who may say it.
 */

import { describe, expect, test } from "bun:test";
import { closingCard, CORE, LEAD, NOW, OTHER } from "../../test/helpers/fixtures/board-rules.ts";
import {
	beforeExecute,
	declarationFor,
	declaredAbsent,
	declaredAfterReview,
	declaredContradicts,
	landingFor,
	landingGate,
	resolveLanding,
} from "./landing.ts";
import { CARRIED, ID, LANE, LATER, LATER_AT, PLAIN, commit, proof } from "../../test/helpers/fixtures/landing-chain.ts";

/**
 * The landing a card names for itself (#814's shape, #828's rule).
 *
 * A folded card's work ships inside another card's merge, and that merge is older than the card's
 * own `execute`: nothing in the chain can name a landing, and the refusal that shape earns offers no
 * instruction. The lead's spot-check is what says which merge carried the work, so the card names it
 * — and these are the three checks that keep the name from being any merge a review came after.
 */
describe("a landing the card names", () => {
	// The folded shape: the work landed in `CARRIED`, the spot-check is at the later tip `LATER`, and
	// the card entered `execute` after both — so the chain resolves to nothing.
	const folded = proof(LANE.chain, LATER, { since: LATER_AT + 1 });

	test("closes the card whose landing the chain cannot name", () => {
		expect(resolveLanding(folded, LATER, ID)).toEqual({
			error: beforeExecute("main", LATER, ID),
			shape: "before-execute",
		});
		expect(resolveLanding(folded, LATER, ID, CARRIED)).toEqual({ sha: CARRIED });
	});

	test("takes a prefix, and records the merge's full sha", () => {
		expect(resolveLanding(folded, LATER, ID, CARRIED.slice(0, 7))).toEqual({ sha: CARRIED });
		expect(landingFor(ID, LATER, folded, NOW, CARRIED.slice(0, 7))).toEqual({ sha: CARRIED, at: NOW });
	});

	test("refuses a sha the branch does not carry", () => {
		expect(resolveLanding(folded, LATER, ID, PLAIN)).toEqual({
			error: declaredAbsent("main", PLAIN, 0, ID),
			shape: "declared",
		});
	});

	test("refuses a prefix that names more than one commit", () => {
		// A prefix is a name only while it names one thing: two commits sharing it make the argument
		// ambiguous, and picking the older one would choose a landing for the caller.
		const twin = `${CARRIED.slice(0, 7)}1fffffffffffffffffffffffffffffff`;
		const chain = [...LANE.chain, commit(twin, LATER_AT + 1, [LATER], "merge(work): a twin")];
		const ambiguous = proof(chain, LATER, { since: LATER_AT + 2 });
		expect(resolveLanding(ambiguous, LATER, ID, CARRIED.slice(0, 7))).toEqual({
			error: declaredAbsent("main", CARRIED.slice(0, 7), 2, ID),
			shape: "declared",
		});
	});

	test("refuses a merge that landed after the review it is meant to carry", () => {
		// A review carries only the landings at or below the tree it read: naming one above it would
		// record the spot-check as evidence for work it never saw.
		expect(resolveLanding(proof(LANE.chain, CARRIED), CARRIED, ID, LATER)).toEqual({
			error: declaredAfterReview("main", LATER, CARRIED, ID),
			shape: "declared",
		});
	});

	test("refuses a merge the chain can name better, which is what keeps a declaration a last door", () => {
		// The anti-bypass clause: when the rule resolves a landing by itself, a card cannot substitute
		// another one. Only the shape that resolves to nothing is answered by a name.
		const namable = proof(LANE.chain, LATER);
		expect(resolveLanding(namable, LATER, ID)).toEqual({ sha: LATER });
		expect(resolveLanding(namable, LATER, ID, CARRIED)).toEqual({
			error: declaredContradicts(CARRIED, LATER, ID),
			shape: "declared",
		});
	});

	test("answers none of its refusals with an instruction", () => {
		// The trap the closed shape closes: a card that named the wrong commit has to name the right
		// one, and an override is for a card with no landing to name at all.
		expect(landingGate(ID, LATER, folded, "close it", PLAIN)).toContain("no commit on `main` has that sha");
		expect(landingGate(ID, LATER, folded, "close it")).toContain("before this card entered `execute`");
		expect(landingGate(ID, LATER, folded, "close it", CARRIED)).toBeUndefined();
	});
});

/**
 * The door onto a declaration: who may name a landing, and what a name must look like. Beside the
 * instruction's own gate because the two answer the same question — who is speaking — about the two
 * things a close can carry.
 */
describe("the landing a close may name", () => {
	const card = closingCard(CORE);
	const holder = CORE;
	const asked = (over: Partial<Parameters<typeof declarationFor>[0]> = {}) =>
		declarationFor({ card, raw: "86cb16e", actor: holder, lead: LEAD.label, target: "done", ...over });
	/** The sentence a refusal carries, or `""` when the door opened. */
	const refusal = (over: Partial<Parameters<typeof declarationFor>[0]> = {}): string => {
		const answer = asked(over);
		return answer === undefined || "sha" in answer ? "" : answer.error;
	};

	test("takes a sha from the holder, the lead, or the person", () => {
		expect(asked()).toEqual({ sha: "86cb16e" });
		expect(asked({ actor: LEAD })).toEqual({ sha: "86cb16e" });
	});

	test("refuses a session that neither holds the card nor signs for it", () => {
		expect(refusal({ actor: OTHER })).toBe(
			`#${card.id} lands a card by the holder, the lead or the person; this session is billing-other.`,
		);
	});

	test("refuses anything that is not a sha, and says what it wanted", () => {
		expect(refusal({ raw: "main" })).toContain("seven to forty hexadecimal characters");
		expect(refusal({ raw: "86cb16" })).toContain("seven to forty hexadecimal characters");
		expect(refusal({ raw: "not a sha at all" })).toContain("seven to forty hexadecimal characters");
	});

	test("refuses to name one on a move that is not a close", () => {
		expect(refusal({ target: "execute" })).toBe(
			"a landing closes a card; it has nothing to say about a move to execute.",
		);
	});

	test("is nobody's answer when nobody asked", () => {
		expect(asked({ raw: undefined })).toBeUndefined();
	});
});
