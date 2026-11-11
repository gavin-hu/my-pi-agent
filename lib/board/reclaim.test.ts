/**
 * `reclaim`'s gate: who may take a card back, and what the record keeps when they do.
 *
 * The one operation decided partly outside the card — whether the session holding it is still
 * running — so every case here hands in the fact a caller would have read, and checks the two
 * halves a wrong gate would break: a live peer's card stays its own, and the spot-check only its
 * signer withdraws survives everybody else's repair.
 */

import { describe, expect, test } from "bun:test";
import { type Card, cardRef } from "./card.ts";
import type { HolderFact } from "./lead.ts";
import type { SessionPresence } from "../session-roster.ts";
import {
	accepted,
	applyOp,
	boardOf,
	CORE,
	claimed,
	created,
	LEAD,
	NOW,
	OTHER,
	provedFor,
	refusal,
	reviewed,
	stepOf,
} from "../../test/helpers/fixtures/board-rules.ts";

/** The fact a caller reads off the bus about `owner`, once it has looked. */
function holderOf(owner: { id?: string; label: string }, state: SessionPresence): HolderFact {
	return { owner, state };
}

/** The card `CORE` holds, and the fact somebody reading the bus would hand in about it. */
function coreHolds(state: SessionPresence): HolderFact {
	return holderOf({ id: CORE.id, label: CORE.label }, state);
}

describe("who may take a card back", () => {
	test("the lead takes a card back from a running peer, and the record names the lead", () => {
		const back = stepOf(claimed(), { kind: "reclaim" }, LEAD);
		expect(back).toMatchObject({ lane: "backlog", by: LEAD.label });
		expect("owner" in back).toBe(false);
	});

	test("the holder takes its own card back: a release by another name", () => {
		// A session is never a peer to itself, so its own card needs no fact about liveness.
		const back = stepOf(claimed(CORE), { kind: "reclaim" }, CORE);
		expect(back.lane).toBe("backlog");
	});

	test("a peer takes one from an owner whose record says it has stopped", () => {
		for (const state of ["quiet", "gone"] as const) {
			const back = stepOf(claimed(), { kind: "reclaim", holder: coreHolds(state) }, OTHER);
			expect(back.lane, state).toBe("backlog");
			expect(back.owner, state).toBeUndefined();
		}
	});

	test("a live peer's card is refused, and the refusal names the owner and the lead", () => {
		const card = claimed();
		const message = refusal(applyOp(card, { kind: "reclaim", holder: coreHolds("live") }, OTHER, NOW, boardOf(card)));
		expect(message).toContain(`${cardRef(card.id)} is held by billing-core.`);
		expect(message).toContain("That session is running");
		expect(message).toContain("only the lead (billing-lead)");
	});
});

describe("what a missing record decides", () => {
	test("a label the bus holds no record of is refused, and says so", () => {
		// A live session that never joined this bus has no record either, so `absent` is not proof
		// that anything stopped: the same fail-closed answer as no fact at all, said differently.
		const card = claimed();
		const message = refusal(applyOp(card, { kind: "reclaim", holder: coreHolds("absent") }, OTHER, NOW, boardOf(card)));
		expect(message).toContain("The bus has no record of that session");
		expect(message).toContain("only the lead (billing-lead)");
	});

	test("no fact at all is refused, for a board with no bus to ask", () => {
		const card = claimed();
		const message = refusal(applyOp(card, { kind: "reclaim" }, OTHER, NOW, boardOf(card)));
		expect(message).toContain("Nothing here says whether that session is running");
	});

	test("a fact computed for another session cannot take this card", () => {
		// The fact is bound to the owner it was read for: a card that changed hands between the read
		// and the write is taken on no fact rather than on somebody else's.
		const card = claimed();
		const stranger = holderOf({ id: OTHER.id, label: OTHER.label }, "gone");
		const message = refusal(applyOp(card, { kind: "reclaim", holder: stranger }, OTHER, NOW, boardOf(card)));
		expect(message).toContain("Nothing here says whether that session is running");
	});

	test("a card nobody holds, and a finished one, are refused before the fact is read", () => {
		const pool = created();
		expect(refusal(applyOp(pool, { kind: "reclaim" }, OTHER, NOW, boardOf(pool)))).toBe("#4 has no owner to reclaim.");
		const done = stepOf(reviewed(), { kind: "move", lane: "done", artifact: { path: "plans/webhook.md" } }, CORE);
		expect(refusal(applyOp(done, { kind: "reclaim" }, LEAD, NOW, boardOf(done)))).toBe(
			"#4 is done; there is nothing to reclaim.",
		);
	});
});

describe("what the return to the pool keeps", () => {
	test("the notes and the contract stay: the plan did not change", () => {
		const card = stepOf(claimed(), { kind: "note", text: "halfway" }, CORE);
		const back = stepOf(card, { kind: "reclaim" }, LEAD);
		expect(back.notes.at(-1)?.text).toBe("halfway");
	});

	test("the spot-check stays unless its own signer takes the card back", () => {
		// A third session taking the card back is not a review of the work: the lead's sign is
		// evidence, and erasing it is the signer's decision alone.
		const card = reviewed();
		const kept = stepOf(card, { kind: "reclaim", holder: coreHolds("gone") }, OTHER);
		expect(kept.review).toMatchObject({ by: LEAD.label });
		const withdrawn = stepOf(card, { kind: "reclaim" }, LEAD);
		expect("review" in withdrawn).toBe(false);
	});

	test("a card with no sign keeps none, which is no field at all", () => {
		const back: Card = stepOf(claimed(), { kind: "reclaim" }, LEAD);
		expect("review" in back).toBe(false);
	});
});

describe("the spot-check it keeps", () => {
	test("a spot-check carried back into the pool does not open done for the next execution", () => {
		// A reclaim keeps the lead's sign; the execution it was made about is gone, so the gate asks
		// again — with the same sentence a card that was never signed gets.
		const card = reviewed();
		const holder = { owner: { id: CORE.id, label: CORE.label }, state: "gone" as const };
		const carried = accepted(applyOp(card, { kind: "reclaim", holder }, OTHER, NOW + 1, boardOf(card))).card;
		const again = accepted(applyOp(carried, { kind: "claim" }, CORE, NOW + 2, boardOf(carried))).card;
		const op = { kind: "move" as const, lane: "execute" as const, artifact: provedFor(again) };
		const executingAgain = accepted(applyOp(again, op, CORE, NOW + 3, boardOf(again))).card;
		expect(executingAgain.review).toMatchObject({ by: LEAD.label });
		expect(
			refusal(
				applyOp(
					executingAgain,
					{ kind: "move", lane: "done", artifact: provedFor(executingAgain) },
					CORE,
					NOW + 4,
					boardOf(executingAgain),
				),
			),
		).toContain("has no spot-check recorded");
		// The lead's fresh look stamps, rather than reading back as the sign already there.
		const resigned = accepted(applyOp(executingAgain, { kind: "review" }, LEAD, NOW + 5, boardOf(executingAgain)));
		expect(resigned.changed).toBe(true);
		expect(resigned.card.review).toMatchObject({ by: LEAD.label, at: NOW + 5 });
	});
});
