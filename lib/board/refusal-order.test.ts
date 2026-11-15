/**
 * A refusal answers before the work it would waste.
 *
 * A sign and a contract each ask something cheap before something expensive: a review's note
 * before the command its contract names runs, a contract's four lines before its plan is proved.
 * The order *is* the capability — a refusal that arrives afterwards has already spent the run or
 * the read — so every case here asserts the work was never asked for, never that it was quick.
 *
 * The other door is `extensions/board/gate-before-run.test.ts`, which drives a real session and
 * counts processes; this suite is the state machine's half, where the proof is a thunk a case can
 * count instead. Split from `rules.test.ts` because that suite is at its named height and this is
 * one capability rather than one more lifecycle case.
 */

import { describe, expect, test } from "bun:test";
import {
	applyOp,
	approved,
	boardOf,
	claimed,
	CORE,
	executing,
	LEAD,
	NOW,
	proved,
	refusal,
} from "../../test/helpers/fixtures/board-rules.ts";
import { MAX_BLOCKED, MAX_NOTE } from "./card.ts";
import { reviewGate } from "./lead.ts";

describe("a review's note", () => {
	const card = executing();

	test("is asked before the run, so a note the card cannot keep refuses", () => {
		expect(reviewGate(card, LEAD, LEAD.label, undefined, "x".repeat(MAX_NOTE + 2))).toEqual({
			error: `text is ${MAX_NOTE + 2} characters; the limit is ${MAX_NOTE} — trim 2.`,
		});
	});

	test("is not the first word: the gate's own refusal still answers before it", () => {
		const planned = approved();
		expect(reviewGate(planned, LEAD, LEAD.label, undefined, "x".repeat(MAX_NOTE + 2))).toEqual({
			error: "#4 is in plan; finished work is spot-checked in execute.",
		});
	});

	test("leaves a sign the card can take alone, as an absent one does", () => {
		expect(reviewGate(card, LEAD, LEAD.label, undefined, "the check is green")).toEqual({});
		expect(reviewGate(card, LEAD, LEAD.label)).toEqual({});
	});
});

describe("a contract's lines", () => {
	test("are refused before the plan is proved", () => {
		const card = claimed();
		// The proof is the stat a door hands in as a thunk, so counting its calls is what says the
		// refusal arrived without one: a line the card cannot keep costs no read.
		let asked = 0;
		const artifact = () => {
			asked++;
			return proved();
		};
		expect(
			refusal(applyOp(card, { kind: "contract", artifact, goal: "x".repeat(401) }, CORE, NOW, boardOf(card))),
		).toBe("goal is 401 characters; the limit is 400 — trim 1.");
		expect(asked).toBe(0);
	});
});

describe("a block's sentence", () => {
	test("names how far over the cap it is, so the retry is one edit", () => {
		const card = executing();
		expect(
			refusal(
				applyOp(
					card,
					{ kind: "move", lane: "blocked", blocker: "decision", blockedBy: "x".repeat(MAX_BLOCKED + 3) },
					CORE,
					NOW,
					boardOf(card),
				),
			),
		).toBe(`blockedBy is ${MAX_BLOCKED + 3} characters; the limit is ${MAX_BLOCKED} — trim 3.`);
	});
});
