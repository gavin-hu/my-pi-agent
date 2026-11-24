/**
 * The lead's two moves: `plan → execute`, the lane its own approval opened, and `execute → done` for a
 * card whose holder the bus has lost.
 *
 * `#544`'s rule split out of `rules.test.ts`, which is at its bar: a card the lead does not hold is
 * still the holder's for `note`, `edit` and every other lane change, and this suite is the whole of
 * the allowance — two transitions, their gates unchanged, and the sentences for the rest.
 */

import { describe, expect, test } from "bun:test";
import { type BoardConfig, boardConfig } from "./config.ts";
import {
	accepted,
	applyOp,
	approved,
	boardOf,
	CORE,
	doneOf,
	executing,
	LEAD,
	NOW,
	OTHER,
	provedFor,
	ready,
	refusal,
	reviewed,
	written,
} from "../../test/helpers/fixtures/board-rules.ts";

describe("the lead's move", () => {
	/** The transition itself: an approved contract, a lead that does not hold the card. */
	test("opens `execute` on a card it does not hold, and leaves the owner alone", () => {
		const card = approved();
		const opened = accepted(
			applyOp(card, { kind: "move", lane: "execute", artifact: provedFor(card) }, LEAD, NOW, boardOf(card)),
		);
		expect(opened.card.lane).toBe("execute");
		expect(opened.card.owner).toEqual(card.owner);
	});

	test("is refused every other verb, with a sentence that names the door it does have", () => {
		const card = approved();
		const blocked = { kind: "move", lane: "blocked", blocker: "decision", blockedBy: "a person decides" } as const;
		expect(refusal(applyOp(card, blocked, LEAD, NOW, boardOf(card)))).toBe(
			"#4 is held by billing-core. A lead opens `execute` by approving the contract; moving it stays the holder's.",
		);
		// A peer is not the lead, so it hears the older sentence and no allowance at all.
		const opening = { kind: "move", lane: "execute", artifact: provedFor(card) } as const;
		expect(refusal(applyOp(card, opening, OTHER, NOW, boardOf(card)))).toContain("Only its owner can move it.");
	});

	/**
	 * One session id, two names: the card recorded `billing-core` when it was claimed, and the bus now
	 * shows that id as `renamed-core`. The sentence a `done` is refused with is where a reader decides
	 * whether a holder is alive, so it prints the bus's name — and nothing stored is rewritten, so the
	 * record keeps the label it captured.
	 */
	test("names the holder by the label the bus shows for that id, not the one the record kept", () => {
		const card = approved();
		const blocked = {
			kind: "move",
			lane: "blocked",
			blocker: "decision",
			blockedBy: "a person decides",
			ownerLabel: "renamed-core",
		} as const;
		expect(refusal(applyOp(card, blocked, LEAD, NOW, boardOf(card)))).toBe(
			"#4 is held by renamed-core. A lead opens `execute` by approving the contract; moving it stays the holder's.",
		);
		expect(card.owner).toEqual({ id: "s-core", label: "billing-core" });
	});

	test("falls back to the record's label, and to the id when the record has none", () => {
		const card = approved();
		const blocked = { kind: "move", lane: "blocked", blocker: "decision", blockedBy: "x" } as const;
		// No name from the bus: the record's own label, as it was before this card.
		expect(refusal(applyOp(card, blocked, LEAD, NOW, boardOf(card)))).toContain("is held by billing-core.");
		// A record whose label is empty still names the holder: the id, never a phrase.
		const unlabelled: typeof card = { ...card, owner: { id: "s-core", label: "" } };
		expect(refusal(applyOp(unlabelled, blocked, LEAD, NOW, boardOf(unlabelled)))).toContain("is held by s-core.");
	});

	test("the seat opens `execute`, though its label is not the lead's", () => {
		// #825, the other door of the same defect: `mayMove` compared the label in its power check
		// *and* in the sentence it chose, so a session holding the seat read `plan → execute` as
		// somebody else's card. The case above is the control: the same actor without the seat hears
		// "Only its owner can move it." and is not let through.
		const card = approved();
		const seat = { ...OTHER, seat: true };
		const opened = accepted(
			applyOp(card, { kind: "move", lane: "execute", artifact: provedFor(card) }, seat, NOW, boardOf(card)),
		);
		expect(opened.card.lane).toBe("execute");
		expect(opened.card.owner).toEqual(card.owner);
	});

	test("closes a signed card whose holder the bus has lost, and only then", () => {
		// #657: the holder's session ended while the card was signed and landed, so the holder could not
		// close it and the lead could not sign it. The close is bookkeeping — the review is the
		// signature — so the lead may make it, and only when the bus says the holder is gone.
		const card = reviewed();
		const owner = card.owner;
		if (owner === undefined) throw new Error("the fixture card has no owner");
		for (const state of ["gone", "absent"] as const) {
			const closed = accepted(applyOp(card, { ...doneOf(card), holder: { owner, state } }, LEAD, NOW, boardOf(card)));
			expect(closed.card.lane, state).toBe("done");
			expect(closed.card.review?.by, state).toBe(LEAD.label);
		}
		// Quiet is not gone: a long turn reads the same, and that holder can still close its own card.
		for (const state of ["quiet", "live"] as const) {
			expect(
				refusal(applyOp(card, { ...doneOf(card), holder: { owner, state } }, LEAD, NOW, boardOf(card))),
				state,
			).toContain("moving it stays the holder's");
		}
		// No fact is "cannot tell" — a bus that did not answer, and a fact about somebody else.
		expect(refusal(applyOp(card, doneOf(card), LEAD, NOW, boardOf(card)))).toContain("stays the holder's");
		const stale = { owner: { label: OTHER.label, id: "s-other" }, state: "gone" as const };
		expect(refusal(applyOp(card, { ...doneOf(card), holder: stale }, LEAD, NOW, boardOf(card)))).toContain(
			"stays the holder's",
		);
		// The holder's own close never needed the fact, and still does not.
		expect(accepted(applyOp(card, doneOf(card), CORE, NOW, boardOf(card))).card.lane).toBe("done");
	});

	test("still answers the gates: no approval, and no room, refuse the lead like anybody", () => {
		const unapproved = written();
		const opening = { kind: "move", lane: "execute", artifact: provedFor(unapproved) } as const;
		expect(refusal(applyOp(unapproved, opening, LEAD, NOW, boardOf(unapproved)))).toContain("not approved yet");
		// One card in `execute` and a limit of one: the lead's move is the second card.
		const narrow: BoardConfig = boardConfig({ wip: { perOwner: 1, plan: 3, execute: 1 }, lead: LEAD.label });
		const holding = executing(ready("8", CORE));
		const waiting = approved();
		const move = { kind: "move", lane: "execute", artifact: provedFor(waiting) } as const;
		expect(refusal(applyOp(waiting, move, LEAD, NOW, boardOf(holding, waiting), narrow))).toContain(
			"cannot enter execute",
		);
	});
});
