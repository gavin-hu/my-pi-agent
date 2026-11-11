/**
 * The two signatures: who satisfies them, and what the session that does not is told.
 *
 * A card's gates are the board's one human judgement, so the cases here are about the two
 * actors the rule accepts — the lead, and the person at the keyboard — and about the holder,
 * which is refused whichever of the two it is. The sentences a refusal is written with are
 * `lead.test.ts`'s; these are the state machine's answer.
 */

import { describe, expect, test } from "bun:test";
import { type Card, MAX_NOTE } from "./card.ts";
import { PERSON_LABEL, personActor } from "./lead.ts";
import {
	accepted,
	applyOp,
	approved,
	approveOf,
	boardOf,
	claimed,
	CONFIG,
	CORE,
	executing,
	finished,
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
		expect(refusal(applyOp(card, approveOf(card), CORE, NOW, boardOf(card)))).toBe(
			"#4 is held by billing-core. Its contract is signed by the lead, who does not hold it.",
		);
		// The lead is the one holder whose fix is its own: release the card, then sign it.
		const own = written(LEAD);
		expect(refusal(applyOp(own, approveOf(own), LEAD, NOW, boardOf(own)))).toBe(
			"#4 is held by billing-lead. A lead releases a card before signing it.",
		);
	});

	test("refuses a peer, and the person signs as the lead's name, never the pronoun", () => {
		const card = written();
		// The sentence is `lead.test.ts`'s: what matters here is that the gate turned it away.
		expect(refusal(applyOp(card, approveOf(card), OTHER, NOW, boardOf(card)))).toContain("signed by the lead");
		const personal = stepOf(card, approveOf(card), personActor(), { ...CONFIG, lead: "nobody" });
		// The record names somebody a reader can act on: the person writes the lead's name and the
		// mark that says the key, so no card file ever stores `you` (`PERSON_LABEL`).
		expect(personal.contract?.approved).toEqual({ by: "nobody", at: NOW, person: true });
		expect(personal.contract?.approved?.by).not.toBe(PERSON_LABEL);
	});

	test("refuses a plan it was not shown, and one proved for a file the card does not name", () => {
		const card = written();
		// The doors prove the plan they hand in; a caller that skips that hands in nothing, and an
		// approval written on it would cover a file nobody looked at.
		expect(refusal(applyOp(card, { kind: "approve" }, LEAD, NOW, boardOf(card)))).toBe(
			"#4's plan was not checked; record it with `contract`.",
		);
		// A fact proved for one path cannot open a card whose record names another, so a plan
		// re-recorded between the read and the sign is a card to read again.
		const other = { kind: "approve" as const, artifact: { path: "plans/other.md", recorded: "plans/other.md" } };
		expect(refusal(applyOp(card, other, LEAD, NOW, boardOf(card)))).toBe(
			"#4's plan changed while it was being read; record it with `contract`.",
		);
	});

	test("refuses an incomplete contract, naming the missing lines", () => {
		const card = stepOf(claimed(), { kind: "contract", artifact: proved("p.md"), goal: "G" }, CORE);
		expect(refusal(applyOp(card, approveOf(card), LEAD, NOW, boardOf(card)))).toBe(
			"#4 has no contract to approve yet: acceptance, scopeOut are missing.",
		);
	});

	test("refuses a lane other than plan", () => {
		const card = executing();
		expect(refusal(applyOp(card, approveOf(card), LEAD, NOW, boardOf(card)))).toBe(
			"#4 is in execute; a contract is approved in plan.",
		);
	});

	test("the same lead again is a no-op, and the person re-signs with the mark", () => {
		const card = approved();
		expect(accepted(applyOp(card, approveOf(card), LEAD, NOW, boardOf(card))).changed).toBe(false);
		const next = stepOf(card, approveOf(card), personActor());
		expect(next.contract?.approved).toEqual({ by: CONFIG.lead, at: NOW, person: true });
		// The person signing twice is the same signature: identity is the name *and* the mark.
		expect(accepted(applyOp(next, approveOf(next), personActor(), NOW, boardOf(next))).changed).toBe(false);
		// A session wearing the lead's label is a different signer, so its sign is recorded — and the
		// mark is gone, because the record says who wrote last.
		const named = { id: "s-named", label: CONFIG.lead };
		expect(stepOf(next, approveOf(next), named).contract?.approved).toEqual({ by: CONFIG.lead, at: NOW });
	});

	test("records the note the signer wrote, in the same write", () => {
		// A signer is exactly the session `note` refuses on a held card, so the sign is the door a
		// caveat comes through: one line, its newline folded like any other note's.
		const drafted = written();
		const card = stepOf(drafted, { ...approveOf(drafted), text: "The acceptance is thin,\nthe plan is sound." }, LEAD);
		expect(card.contract?.approved).toEqual({ by: LEAD.label, at: NOW });
		expect(card.notes.at(-1)).toEqual({ by: LEAD.label, at: NOW, text: "The acceptance is thin, the plan is sound." });
	});

	test("refuses a note it cannot record, and signs nothing", () => {
		const blank = written();
		expect(refusal(applyOp(blank, { ...approveOf(blank), text: "   " }, LEAD, NOW, boardOf(blank)))).toBe(
			"text is required.",
		);
		const long = written();
		expect(
			refusal(applyOp(long, { ...approveOf(long), text: "x".repeat(MAX_NOTE + 1) }, LEAD, NOW, boardOf(long))),
		).toBe(`text must be at most ${MAX_NOTE} characters.`);
		// The gate's sentence is the one worth reading first, so it answers before the note does.
		const moving = executing();
		expect(refusal(applyOp(moving, { ...approveOf(moving), text: "" }, LEAD, NOW, boardOf(moving)))).toBe(
			"#4 is in execute; a contract is approved in plan.",
		);
	});

	test("a second sign from the lead keeps the first stamp, and still records its note", () => {
		const first = approved();
		const card = stepOf(first, { ...approveOf(first), text: "one more look" }, LEAD);
		expect(card.contract?.approved).toEqual(first.contract?.approved);
		expect(card.notes.at(-1)?.text).toBe("one more look");
	});
});

describe("review", () => {
	test("records the spot-check, by the lead rather than the holder", () => {
		const card = reviewed();
		expect(card.review).toEqual({ by: LEAD.label, at: NOW });
	});

	test("the person spot-checks as the lead's name, and nobody reads it back as a pronoun", () => {
		const card = stepOf(executing(), { kind: "review" }, personActor());
		expect(card.review).toEqual({ by: CONFIG.lead, at: NOW, person: true });
		expect(accepted(applyOp(card, { kind: "review" }, personActor(), NOW, boardOf(card))).changed).toBe(false);
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

describe("a spot-check made by instruction", () => {
	/** A finished card with no sign on it: the record a close outside the gate leaves behind. */
	function closedByHand(): Card {
		return { ...finished(), review: undefined };
	}

	test("signs a finished card nobody signed, and keeps the line saying why", () => {
		const card = stepOf(
			closedByHand(),
			{ kind: "review", override: "Closed on my instruction for 0.22.0." },
			personActor(),
		);
		expect(card.review).toEqual({
			by: CONFIG.lead,
			at: NOW,
			person: true,
			byInstruction: "Closed on my instruction for 0.22.0.",
		});
	});

	test("refuses an override with no reason, and one on a card that is not finished", () => {
		const card = closedByHand();
		expect(refusal(applyOp(card, { kind: "review", override: "   " }, LEAD, NOW, boardOf(card)))).toBe(
			"override needs the one line saying why.",
		);
		const running = executing();
		expect(refusal(applyOp(running, { kind: "review", override: "shipped anyway" }, LEAD, NOW, boardOf(running)))).toBe(
			"#4 is in execute; an override signs a card that is already done.",
		);
	});

	test("keeps the holder out, and never rewrites a sign already there", () => {
		const card = closedByHand();
		expect(
			refusal(applyOp(card, { kind: "review", override: "closed on my instruction" }, CORE, NOW, boardOf(card))),
		).toContain("spot-checked by the lead, who does not hold it");
		// Every card that finished through the gate carries a spot-check, so an override on one is
		// a second signature rather than a record of the close that happened.
		const gated = finished();
		expect(
			refusal(applyOp(gated, { kind: "review", override: "closed on my instruction" }, LEAD, NOW, boardOf(gated))),
		).toBe("#4 is already spot-checked by billing-lead; an override signs a card that has no sign.");
	});

	test("the same signer saying it again writes nothing, and a note still lands", () => {
		const reason = "closed on my instruction";
		const closed = stepOf(closedByHand(), { kind: "review", override: reason }, LEAD);
		expect(accepted(applyOp(closed, { kind: "review", override: reason }, LEAD, NOW, boardOf(closed))).changed).toBe(
			false,
		);
		const noted = stepOf(closed, { kind: "review", override: reason, text: "for the record" }, LEAD);
		expect(noted.review).toEqual(closed.review);
		expect(noted.notes.at(-1)?.text).toBe("for the record");
	});
});

describe("the message a sign owes", () => {
	/** The card with its approval's `told` taken back off, as a send that never landed leaves it. */
	const untold = (card: Card): Card => {
		if (card.contract?.approved === undefined) return card;
		const { told: _told, ...rest } = card.contract.approved;
		return { ...card, contract: { ...card.contract, approved: rest } };
	};
	/** One operation, accepted, with the result's own facts — `accepted` keeps only card and change. */
	const step = (card: Card, op: Parameters<typeof applyOp>[1], actor = LEAD) => {
		const result = applyOp(card, op, actor, NOW, boardOf(card));
		if (!result.ok) throw new Error(result.error);
		return result;
	};

	test("a fresh stamp owes it", () => {
		const card = written();
		const signed = step(card, approveOf(card));
		expect(signed.changed).toBe(true);
		expect(signed.announce).toBe(true);
	});

	test("a repeat sign owes it while the sign is untold, and writes nothing while doing so", () => {
		const signed = stepOf(approved(), approveOf(approved()), LEAD);
		// Nothing recorded the announcement, so the repeat is the retry — and it stamps nothing.
		const again = step(untold(signed), approveOf(signed));
		expect(again.changed).toBe(false);
		expect(again.announce).toBe(true);
	});

	test("a repeat whose sign was told owes nothing at all", () => {
		const signed = stepOf(approved(), approveOf(approved()), LEAD);
		const told: Card = {
			...signed,
			contract:
				signed.contract?.approved === undefined
					? signed.contract
					: { ...signed.contract, approved: { ...signed.contract.approved, told: { at: NOW } } },
		};
		const again = step(told, approveOf(told));
		expect(again.changed).toBe(false);
		expect(again.announce).toBeUndefined();
	});

	test("a note added by a repeat rides the same rule", () => {
		// The note is a write; the message is still the sign's, and an untold sign owes one whether or
		// not the caller also said something.
		const signed = untold(stepOf(approved(), approveOf(approved()), LEAD));
		const withNote = step(signed, { ...approveOf(signed), text: "read again" });
		expect(withNote.changed).toBe(true);
		expect(withNote.announce).toBe(true);
	});
});
