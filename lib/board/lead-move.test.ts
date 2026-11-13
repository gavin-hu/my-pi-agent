/**
 * The lead's one move: `plan → execute`, the lane its own approval opened.
 *
 * `#544`'s rule split out of `rules.test.ts`, which is at its bar: a card the lead does not hold is
 * still the holder's for `note`, `edit`, `done` and every other lane change, and this suite is the
 * whole of the allowance — one transition, its gates unchanged, and the sentences for the rest.
 */

import { describe, expect, test } from "bun:test";
import { type BoardConfig, boardConfig } from "./config.ts";
import {
	accepted,
	applyOp,
	approved,
	boardOf,
	CORE,
	executing,
	LEAD,
	NOW,
	OTHER,
	provedFor,
	ready,
	refusal,
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

	test("still answers the gates: no approval, and no room, refuse the lead like anybody", () => {
		const unapproved = written();
		const opening = { kind: "move", lane: "execute", artifact: provedFor(unapproved) } as const;
		expect(refusal(applyOp(unapproved, opening, LEAD, NOW, boardOf(unapproved)))).toContain("not approved yet");
		// One card in `execute` and a limit of one: the lead's move is the second card.
		const narrow: BoardConfig = boardConfig({ wip: { plan: 3, execute: 1 }, lead: LEAD.label });
		const holding = executing(ready("8", CORE));
		const waiting = approved();
		const move = { kind: "move", lane: "execute", artifact: provedFor(waiting) } as const;
		expect(refusal(applyOp(waiting, move, LEAD, NOW, boardOf(holding, waiting), narrow))).toContain(
			"cannot enter execute",
		);
	});
});
