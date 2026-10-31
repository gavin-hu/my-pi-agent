/**
 * The two signatures: who satisfies them, and what the session that does not is told.
 *
 * A card's gates are the board's one human judgement, so the cases here are about the two
 * actors the rule accepts — the lead, and the person at the keyboard — and about the holder,
 * which is refused whichever of the two it is. The sentences a refusal is written with are
 * `lead.test.ts`'s; these are the state machine's answer.
 */

import { describe, expect, test } from "bun:test";
import { MAX_NOTE } from "./card.ts";
import { personActor } from "./lead.ts";
import {
	accepted,
	applyOp,
	approved,
	boardOf,
	claimed,
	CONFIG,
	CORE,
	executing,
	LEAD,
	NOW,
	OTHER,
	proved,
	provedFor,
	reviewed,
	refusal,
	stepOf,
	written,
} from "../../test/helpers/fixtures/board-rules.ts";

describe("approve", () => {
	test("records who approved the contract, and when", () => {
		const card = approved();
		expect(card.lane).toBe("plan");
		expect(card.contract?.approved).toEqual({ by: LEAD.label, at: NOW });
	});

	test("refuses the session that holds the card", () => {
		const card = written();
		expect(refusal(applyOp(card, { kind: "approve" }, CORE, NOW, boardOf(card)))).toBe(
			"#4 is held by billing-core. Its contract is signed by the lead, who does not hold it.",
		);
		// The lead is the one holder whose fix is its own: release the card, then sign it.
		const own = written(LEAD);
		expect(refusal(applyOp(own, { kind: "approve" }, LEAD, NOW, boardOf(own)))).toBe(
			"#4 is held by billing-lead. A lead releases a card before signing it.",
		);
	});

	test("refuses a peer, and the person signs whatever the lead is called", () => {
		const card = written();
		// The sentence is `lead.test.ts`'s: what matters here is that the gate turned it away.
		expect(refusal(applyOp(card, { kind: "approve" }, OTHER, NOW, boardOf(card)))).toContain("signed by the lead");
		const personal = stepOf(card, { kind: "approve" }, personActor(), { ...CONFIG, lead: "nobody" });
		expect(personal.contract?.approved?.by).toBe("you");
	});

	test("refuses an incomplete contract, naming the missing lines", () => {
		const card = stepOf(claimed(), { kind: "contract", artifact: proved("p.md"), goal: "G" }, CORE);
		expect(refusal(applyOp(card, { kind: "approve" }, LEAD, NOW, boardOf(card)))).toBe(
			"#4 has no contract to approve yet: acceptance, scopeOut are missing.",
		);
	});

	test("refuses a lane other than plan", () => {
		const card = executing();
		expect(refusal(applyOp(card, { kind: "approve" }, LEAD, NOW, boardOf(card)))).toBe(
			"#4 is in execute; a contract is approved in plan.",
		);
	});

	test("the same lead again is a no-op, and the person re-signs", () => {
		const card = approved();
		expect(accepted(applyOp(card, { kind: "approve" }, LEAD, NOW, boardOf(card))).changed).toBe(false);
		const next = stepOf(card, { kind: "approve" }, personActor());
		expect(next.contract?.approved?.by).toBe("you");
	});

	test("records the note the signer wrote, in the same write", () => {
		// A signer is exactly the session `note` refuses on a held card, so the sign is the door a
		// caveat comes through: one line, its newline folded like any other note's.
		const card = stepOf(written(), { kind: "approve", text: "The acceptance is thin,\nthe plan is sound." }, LEAD);
		expect(card.contract?.approved).toEqual({ by: LEAD.label, at: NOW });
		expect(card.notes.at(-1)).toEqual({ by: LEAD.label, at: NOW, text: "The acceptance is thin, the plan is sound." });
	});

	test("refuses a note it cannot record, and signs nothing", () => {
		expect(refusal(applyOp(written(), { kind: "approve", text: "   " }, LEAD, NOW, boardOf(written())))).toBe(
			"text is required.",
		);
		const long = written();
		expect(refusal(applyOp(long, { kind: "approve", text: "x".repeat(MAX_NOTE + 1) }, LEAD, NOW, boardOf(long)))).toBe(
			`text must be at most ${MAX_NOTE} characters.`,
		);
		// The gate's sentence is the one worth reading first, so it answers before the note does.
		const moving = executing();
		expect(refusal(applyOp(moving, { kind: "approve", text: "" }, LEAD, NOW, boardOf(moving)))).toBe(
			"#4 is in execute; a contract is approved in plan.",
		);
	});

	test("a second sign from the lead keeps the first stamp, and still records its note", () => {
		const first = approved();
		const card = stepOf(first, { kind: "approve", text: "one more look" }, LEAD);
		expect(card.contract?.approved).toEqual(first.contract?.approved);
		expect(card.notes.at(-1)?.text).toBe("one more look");
	});
});

describe("review", () => {
	test("records the spot-check, by the lead rather than the holder", () => {
		const card = reviewed();
		expect(card.review).toEqual({ by: LEAD.label, at: NOW });
	});

	test("refuses the holder, a peer, and a lane other than execute", () => {
		const card = executing();
		expect(refusal(applyOp(card, { kind: "review" }, CORE, NOW, boardOf(card)))).toContain(
			"spot-checked by the lead, who does not hold it",
		);
		expect(refusal(applyOp(card, { kind: "review" }, OTHER, NOW, boardOf(card)))).toContain("spot-checked by the lead");
		const own = approved(LEAD, personActor());
		const running = stepOf(own, { kind: "move", lane: "execute", artifact: provedFor(own) }, LEAD);
		expect(refusal(applyOp(running, { kind: "review" }, LEAD, NOW, boardOf(running)))).toBe(
			"#4 is held by billing-lead. A lead releases a card before spot-checking it.",
		);
		const plan = approved();
		expect(refusal(applyOp(plan, { kind: "review" }, LEAD, NOW, boardOf(plan)))).toBe(
			"#4 is in plan; finished work is spot-checked in execute.",
		);
	});

	test("the same reviewer again is a no-op", () => {
		const card = reviewed();
		expect(accepted(applyOp(card, { kind: "review" }, LEAD, NOW, boardOf(card))).changed).toBe(false);
	});

	test("records the note the spot-checker wrote", () => {
		const card = stepOf(executing(), { kind: "review", text: "Ships; the docs line is still wrong." }, LEAD);
		expect(card.review).toEqual({ by: LEAD.label, at: NOW });
		expect(card.notes.at(-1)).toEqual({ by: LEAD.label, at: NOW, text: "Ships; the docs line is still wrong." });
	});
});
