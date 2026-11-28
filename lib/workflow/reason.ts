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
 * self-contained: it reads the card, a formatter for relative times, and the helpers the bundle
 * splices beside it (`currentReview`, and the lane rule that body calls), and nothing else. The two
 * callers differ only in whose clock an age is read against — the page's `ago` against the reader's
 * now, the transcript's against the snapshot's — so the clock is a parameter rather than an import.
 *
 * Pure: no I/O, no clock of its own, no state.
 */

import { ageWords, pageSource } from "../format.ts";
import { type Card, laneSince } from "./card.ts";
import { currentReview } from "./signs.ts";

/** What a reason is about, which is what a row's edge and a dot are coloured by. */
export const REASON_KINDS = [
	"waiting",
	"ready",
	"blocked",
	"offered",
	"shelved",
	"contract",
	"approval",
	"executing",
	"review",
	"done",
	"note",
] as const;

/** One kind of reason. */
export type ReasonKind = (typeof REASON_KINDS)[number];

/**
 * The pill a reason wears, one word per kind.
 *
 * A decision row and a mission card carry the reason as a shape rather than a sentence —
 * the numbered row has no room for a clause, and the whole of it is one hover away — so this
 * is the one table a pill's words come from. `waiting` and `ready` are here for the reason the
 * tone table gives: they are the dependency edge read both ways, and the card face invents both
 * from the two fields the snapshot derives, so a table without them would draw the default.
 */
export const REASON_LABEL: Record<ReasonKind, string> = {
	waiting: "waits",
	ready: "ready",
	blocked: "blocked",
	offered: "offered",
	shelved: "shelved",
	contract: "no contract",
	approval: "needs approval",
	executing: "in progress",
	review: "needs review",
	done: "done",
	note: "note",
};

/** {@link REASON_LABEL} as the browser bundle's own source, spliced in like the tone tables. */
export const REASON_LABEL_JS = JSON.stringify(REASON_LABEL);

/** One reason line: what it is about, and the sentence a reader gets. */
export interface Reason {
	kind: ReasonKind;
	/** The sentence as it reads now. A snapshot: a transcript line, a tooltip, a queue's title. */
	text: string;
	/**
	 * The moment the sentence is about, when it carries an age, and the sentence as a template
	 * with `{age}` where the age goes.
	 *
	 * A page stamps these instead of writing `text`, so its one ticker keeps the sentence
	 * honest: the reason line and the lane age beside it move together, and a board nobody has
	 * written to for an hour stops saying "offered 1m ago". Absent for every sentence with no
	 * age in it, which is all of them but one.
	 */
	at?: number;
	wording?: string;
}

/**
 * What a reason reads of a card: the record, plus the one fact a reader with the plan store adds.
 *
 * `planGone` is the server's, because this body is the browser's too and a browser cannot stat:
 * a plain card is read exactly as it was before the field existed.
 */
export type ReasonCard = Card & { planGone?: boolean };

/**
 * The one line under a card, or `undefined` when the card has nothing to say.
 *
 * The order inside a lane is the weight of the fact: an unfinished dependency outranks
 * everything (a claim would be refused), then the lane's own decision, then the last note.
 */
export function reasonFor(card: ReasonCard, ago: (at: number) => string): Reason | undefined {
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
		// The shelf outranks an offer and a note, because it is the decision the card is under: a
		// reader who set it aside said more than the last note did. No backticks here or below --
		// this body is spliced into the page's bundle, where one would end the literal.
		if (card.shelved !== undefined) return { kind: "shelved", text: "shelved — " + card.shelved.note };
		if (card.offeredAt !== undefined) {
			const age = ago(card.offeredAt);
			return {
				kind: "offered",
				at: card.offeredAt,
				wording: "offered {age} — nobody took it",
				// The words are `lib/format.ts`'s `ageWords`, spliced beside this body as `__AGE_WORDS__`.
				text: "offered " + ageWords(age) + " — nobody took it",
			};
		}
		return last === undefined ? undefined : { kind: "note", text: last.text };
	}
	if (card.lane === "plan") {
		// The contract's four lines, read here so the page and the transcript name the same
		// missing field: this body is spliced, so it cannot call the module that owns them.
		const missing = [];
		const fields = ["goal", "acceptance", "scopeOut", "verify"];
		for (let index = 0; index < fields.length; index++) {
			const value = card.contract === undefined ? undefined : card.contract[fields[index] as "goal"];
			if (typeof value !== "string" || value === "") missing.push(fields[index]);
		}
		if (missing.length > 0) {
			return { kind: "contract", text: "no contract yet — missing " + missing.join(", ") };
		}
		const approved = card.contract === undefined ? undefined : card.contract.approved;
		if (approved === undefined) return { kind: "approval", text: "contract ready — needs approval" };
		// A card planned before the plan was required: its contract names no artifact, which
		// `execute` now refuses, so the line says what is missing rather than who signed.
		if (card.planPath === undefined) return { kind: "contract", text: "contract approved — no plan recorded" };
		// The next move is the one that would refuse, so the missing plan is read before the name of
		// whoever signed the contract it was approved with.
		if (card.planGone === true) return { kind: "contract", text: "contract approved — its plan is gone" };
		return { kind: "approval", text: "contract approved by " + approved.by };
	}
	if (card.lane === "execute") {
		// The strongest fact in this lane: a card whose plan is gone cannot land at all, signed or
		// not, so the spot-check it carries is not the thing a reader should be told about it.
		if (card.planGone === true) {
			return { kind: "contract", text: "its plan is gone — move it back to plan, then record it again" };
		}
		if (card.review !== undefined) {
			// The sign that speaks for the card now, from the one body that decides it (`lead.ts`, spliced
			// in beside this one): a sign the card outgrew and one a reclaim carried in from an earlier
			// execution are both stale, and the line names which, because the reader's next move is
			// `review` either way.
			const current = currentReview(card);
			if (current !== undefined) return { kind: "review", text: "spot-checked by " + current.by };
			const since = laneSince(card);
			const when = since !== undefined && card.review.at < since ? " before this execution" : ", then written";
			return { kind: "review", text: "spot-checked by " + card.review.by + when + " — review again" };
		}
		if (card.planPath === undefined) return { kind: "contract", text: "no plan recorded" };
		return { kind: "executing", text: "executing — no spot-check yet" };
	}
	const who = card.owner === undefined ? "" : " by " + card.owner.label;
	// A sign that carries a reason is a close the gate was not asked for, and the difference
	// between that and a signed one is the whole point of recording it: no helper, because this
	// body is also the browser's.
	const how = card.review?.byInstruction === undefined ? "" : " · closed by instruction";
	// allow:glyph: this body is serialized for the page, where an import would not exist
	return { kind: "done", text: "✓ done" + who + how };
}

/** The same body, as the browser receives it: one rule for the page and the transcript. */
export const REASON_FOR_JS = pageSource(reasonFor);
