/**
 * Why a card sits where it does: one rule, for the card face, the lead's queue, and the
 * transcript.
 *
 * A card's lane says what kind of state it is in; the reason line says the one fact that
 * decides what happens next — an order it waits on, a block somebody recorded, a contract
 * nobody approved yet, a spot-check nobody has done. That sentence used to be written
 * three times (the page's card face, its Team queue, and `board`'s card block), and the
 * flow this board now runs multiplies the states it has to name, so it is one body.
 *
 * It is spliced into the browser bundle as {@link REASON_FOR_JS}, which is why it is
 * self-contained: it reads the card and a formatter for relative times, and nothing else.
 * The two callers differ only in whose clock an age is read against — the page's `ago`
 * against the reader's now, the transcript's against the snapshot's — so the clock is a
 * parameter rather than an import.
 *
 * Pure: no I/O, no clock of its own, no state.
 */

import type { Card } from "./card.ts";

/** What a reason is about, which is what a row's edge and a dot are coloured by. */
export const REASON_KINDS = [
	"waiting",
	"blocked",
	"offered",
	"contract",
	"approval",
	"executing",
	"review",
	"done",
	"note",
] as const;

/** One kind of reason. */
export type ReasonKind = (typeof REASON_KINDS)[number];

/** One reason line: what it is about, and the sentence a reader gets. */
export interface Reason {
	kind: ReasonKind;
	text: string;
}

/**
 * The one line under a card, or `undefined` when the card has nothing to say.
 *
 * The order inside a lane is the weight of the fact: an unfinished dependency outranks
 * everything (a claim would be refused), then the lane's own decision, then the last note.
 */
export function reasonFor(card: Card, ago: (at: number) => string): Reason | undefined {
	const last = card.notes.length > 0 ? card.notes[card.notes.length - 1] : undefined;
	if (card.lane === "blocked") {
		// The recorded block is the reason: its sentence if one was written, else the kind,
		// which is what says where the card goes back to. Only a card with no block at all —
		// one hand-edited, or released and parked again before this record existed — falls
		// back to the last note, and then to saying it has nothing.
		if (card.blocked !== undefined) {
			const kind = card.blocked.kind;
			return {
				kind: "blocked",
				text: card.blocked.note ?? "blocked on a " + (kind === undefined ? "decision" : kind),
			};
		}
		return { kind: "blocked", text: last === undefined ? "blocked, with nothing recorded" : last.text };
	}
	if (card.lane === "backlog") {
		if (card.offeredAt !== undefined) {
			return { kind: "offered", text: "offered " + ago(card.offeredAt) + " ago — nobody took it" };
		}
		return last === undefined ? undefined : { kind: "note", text: last.text };
	}
	if (card.lane === "plan") {
		// The contract's three lines, read here so the page and the transcript name the same
		// missing field: this body is spliced, so it cannot call the module that owns them.
		const missing = [];
		const fields = ["goal", "acceptance", "scopeOut"];
		for (let index = 0; index < fields.length; index++) {
			const value = card.contract === undefined ? undefined : card.contract[fields[index] as "goal"];
			if (typeof value !== "string" || value === "") missing.push(fields[index]);
		}
		if (missing.length > 0) {
			return { kind: "contract", text: "no contract yet — missing " + missing.join(", ") };
		}
		const approved = card.contract === undefined ? undefined : card.contract.approved;
		if (approved === undefined) return { kind: "approval", text: "contract ready — needs approval" };
		return { kind: "approval", text: "contract approved by " + approved.by };
	}
	if (card.lane === "execute") {
		if (card.review !== undefined) return { kind: "review", text: "spot-checked by " + card.review.by };
		if (card.planPath === undefined) return { kind: "contract", text: "no plan recorded" };
		return { kind: "executing", text: "executing — no spot-check yet" };
	}
	const landed = card.landed === undefined ? "" : " · landed " + card.landed.commit;
	const who = card.owner === undefined ? "" : " by " + card.owner.label;
	return { kind: "done", text: "✓ done" + who + landed };
}

/** The same body, as the browser receives it: one rule for the page and the transcript. */
export const REASON_FOR_JS = String(reasonFor);
