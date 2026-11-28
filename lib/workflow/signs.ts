/**
 * What a sign is: who may write one, what it records, and which one still speaks for the card.
 *
 * A sign is the board's one human judgement — a contract somebody read, a piece of work somebody looked
 * at — so the record has to say who made it and when, and the answer to "does this still speak for the
 * card" has to be one rule. The person at the keyboard writes as a label no session can have, so a
 * one-session repository can sign its own cards without blurring into its holder; the lead is a team
 * name a pure rule is handed and a card file records.
 *
 * Three readers ask the last question and must agree: the lead's queue (`gateOf`), the card's reason
 * line, and the `done` gate. `laneReview` answers "did this execution have a sign at all",
 * `signStale` answers "has the card been written since", and `currentReview` is both — so no reader
 * can read a stale sign as current while another refuses it.
 *
 * The announcement is the last part: a sign nobody heard is a gate nobody knows is open, so the card
 * records when the message was settled (`Sign.told`) and a repeat sign owes it again while absent.
 */

import { pageSource } from "../format.ts";
import { normalizeLabel, sameLabel } from "../session-label.ts";
import type { SessionPresence } from "../session-roster.ts";
import { type Card, type CardOwner, cardRef, laneSince, MAX_NOTES, owesHandoff } from "./card.ts";
import type { BoardConfig } from "./config.ts";
import { type Lead, TELL_FIELDS, type Sign as SignRecord } from "./contract.ts";
import type { Actor, CardOp, Prepared } from "./rules.ts";

/**
 * The person at the keyboard, as a write is made.
 *
 * `/board approve` and `/board review` write as this actor, so a repository worked by one
 * session is not stuck behind its own holder rule, and the card records the lead's name with
 * the person's mark on the sign ({@link signMark}). This label is therefore what the person's
 * own line prints, and never what a card file says.
 */
export const PERSON_LABEL = "you";

/** The id the person's actor carries: a prefix no session id uses, so a label cannot stand in. */
const PERSON_ID = "person:you";

/** The actor a command writes as: the person's label, and an id a session cannot have. */
export function personActor(): Actor {
	return { id: PERSON_ID, label: PERSON_LABEL };
}

/** Whether `actor` is the person at the keyboard rather than a session. */
export function isPerson(actor: Pick<Actor, "id">): boolean {
	return actor.id === PERSON_ID;
}

/**
 * What a sign records about the actor who wrote it: the name a reader acts on, and the person's mark.
 *
 * The person signs as the lead's name, because that is the one name a card file can give somebody
 * who has no session — `PERSON_LABEL` is what the person's own line prints, never what a record
 * stores. A board that names no lead has no name to lend, so the record carries the person's own
 * label: the sign still reads as a sign, and the mark is what tells the two apart afterwards.
 */
export function signMark(actor: Actor, lead: Lead): Pick<SignRecord, "by" | "person"> {
	return isPerson(actor) ? { by: lead === "" ? PERSON_LABEL : lead, person: true } : { by: actor.label };
}

/**
 * Whether `sign` is this actor's own.
 *
 * The name *and* the mark: a session that signs under the lead's label is somebody else, so a
 * comparison on the label alone would read its sign back as the person's — and a repeated sign
 * would re-stamp instead of being the signature already there.
 */
export function signedAs(sign: SignRecord | undefined, actor: Actor, lead: Lead): boolean {
	if (sign === undefined) return false;
	const mark = signMark(actor, lead);
	return sign.by === mark.by && sign.person === mark.person;
}

/**
 * The lead's name as a config file says it, or the running one when it says nothing usable.
 *
 * A blank string is not a lead called nothing: it is a file that said nothing, so the layer
 * below keeps its answer, and a name is flattened and capped by the same rule every label is.
 * The one stated value that is an answer rather than a name is the empty string: the default
 * team names a lead, so clearing it has to be sayable.
 */
export function normalizeLead(raw: unknown, base: Lead): Lead {
	if (typeof raw !== "string") return base;
	return raw === "" ? "" : normalizeLabel(raw, base);
}

/**
 * Whether `actor` is the lead.
 *
 * A label compare, the way a teammate is addressed — not `holds`, which asks whether a session
 * owns a card and prefers the ids when both sides have one.
 */
export function isLead(actor: Pick<Actor, "label">, lead: Lead): boolean {
	return sameLabel(actor.label, lead);
}

/** The two signs a card carries. */
export type Sign = "approve" | "review";
export type { NoticeField } from "./contract.ts";

/** The two signs, in the order a person is likely to want them. */
const SIGN_KINDS: readonly Sign[] = ["approve", "review"];

/** `word` as one of the two signs, or `undefined` when it is not one. */
export function signOf(word: string): Sign | undefined {
	return SIGN_KINDS.find((sign) => sign === word);
}

/**
 * The spot-check this execution made, whether or not the card has since outgrown it.
 *
 * A sign kept across a `reclaim` — which is what happens when somebody other than its signer takes
 * the card back — is evidence that a spot-check happened, and not evidence about the execution the
 * card is in today. So the meaning of the sign follows the lane: in `execute` it answers only when
 * it was made after the card entered, and a new execution owes the lead a new look. Everywhere else
 * the sign is a fact about the work the card finished, and a finished card's sign is the one that
 * closed it.
 *
 * A card whose history was elided has no entry to compare against, so it keeps its sign: an
 * unreadable record is not a reason to demand a signature that may already be there.
 *
 * The lane is only half the question — {@link currentReview} asks the other — and this stays the
 * answer to "did this execution have a sign at all", which is what lets the `done` refusal say
 * "run it again" rather than "no spot-check recorded".
 */
export function laneReview(card: Card): SignRecord | undefined {
	const review = card.review;
	if (review === undefined) return undefined;
	const since = card.lane === "execute" ? laneSince(card) : undefined;
	return since === undefined || review.at >= since ? review : undefined;
}

/**
 * The spot-check that speaks for the card now: the one this execution made, while the card has not
 * been written since.
 *
 * One rule for every reader — the lead's queue (`gateOf`), the card's reason line (`reasonFor`), and
 * the `done` gate (`spotCheckRefusal`) — because two of them read a stale sign as current
 * while the third refused it: a card absent from NEEDS YOU and drawn "spot-checked by X" at the
 * moment its close was refused with "was written after its spot-check". The staleness half is
 * {@link signStale}'s, so "the work moved under the signature" cannot be one rule here and another
 * there.
 */
export function currentReview(card: Card): SignRecord | undefined {
	const review = laneReview(card);
	return review !== undefined && !signStale(card, review) ? review : undefined;
}

/**
 * The rule, and the three bodies it calls, as the browser receives them.
 *
 * `reasonFor` asks this rule on the page as well as in the transcript, and a page has no import
 * graph: a body that calls a helper has to reach the page with the bodies that helper calls, or the
 * first card face that draws a signed card throws where every static check is green. One block
 * because every caller that carries one carries all four, and beside the rule so a helper added to
 * it is one line from the splice that would have to carry it.
 */
export const CURRENT_REVIEW_JS = [laneSince, laneReview, signStale, currentReview].map(pageSource).join("\n\n");

/**
 * What the caller found out about the session holding a card, bound to the owner it is about.
 *
 * The binding is the point: a fact about one session must not take another session's card, so a
 * fact computed for an owner the lock no longer reads is no fact at all.
 */
export interface HolderFact {
	/** The owner the state was computed for. */
	owner: CardOwner;
	/** What the bus said about it; `quiet` and `gone` are the two that let a peer take the card. */
	state: SessionPresence;
}

/**
 * A card's notes after one more, with {@link MAX_NOTES} kept and the rest counted: one body for the two
 * writers a note has, because the cap is the record's and a clipped list is the same arithmetic in both,
 * and a clipped list on a sign would be a different list from the one a note writes.
 */
export function appendNote(card: Card, by: string, at: number, text: string): Pick<Card, "notes" | "notesDropped"> {
	const notes = [...card.notes, { by, at, text }];
	const overflow = Math.max(0, notes.length - MAX_NOTES);
	return { notes: overflow === 0 ? notes : notes.slice(overflow), notesDropped: card.notesDropped + overflow };
}

/**
 * Whether the card has been written since its sign last spoke for it.
 *
 * A sign owns two writes: the stamp, and `#398`'s record that its owner heard, so the later of the two is
 * compared. The field is `stateAt`, not `updatedAt`: a landing note is a message about the card, not a
 * change to it, so every reader of this rule — the gate, the queue, the reason line — inherits one answer.
 *
 * A card from before `stateAt` has none, and this fallback reads it loosely: **a state write between the sign
 * and the newest note is invisible**, because only a lane change logs a transition — so a `contract` or `edit`
 * leaves no trace and the later note reads fresh.
 *
 * It holds only because such a card was written entirely by older code, whose next write stores the field, and
 * because the landing gate still proves the work the sign is over.
 */
export function signStale(card: Card, record: SignRecord): boolean {
	const noted = card.stateAt === undefined && card.notes.at(-1)?.at === card.updatedAt;
	const mark = card.stateAt ?? (noted ? (card.log?.at(-1)?.at ?? card.createdAt) : card.updatedAt);
	return mark > Math.max(record.at, record.told?.at ?? 0);
}

/**
 * The sign a card holds for one gate: the approval, or the spot-check the current execution owes.
 *
 * One reader for both, because everything after the sign — announcing it, recording that it was
 * heard, asking whether it owes a message — is a question about that one record.
 */
export function signRecord(card: Card, sign: Sign): SignRecord | undefined {
	return sign === "approve" ? card.contract?.approved : currentReview(card);
}

/**
 * Whether the card owes somebody a notice its own record says never landed.
 *
 * Two notices read as one fact: a handoff the bus never took, wherever the card sits, and the sign
 * that opens the move the card is on — `approve` in `plan`, `review` in `execute`. The lead's rollup
 * groups these cards and the transcript's row says so on the card, so the rule is stated here once
 * instead of in each of the two surfaces that read it.
 */
export function owesNotice(card: Card): boolean {
	if (owesHandoff(card)) return true;
	if (card.lane !== "plan" && card.lane !== "execute") return false;
	const record = signRecord(card, card.lane === "plan" ? "approve" : "review");
	return record !== undefined && record.told === undefined;
}

/**
 * Whether a call by this actor owes the card's owner the sign's message.
 *
 * A fresh stamp owes one. A repeat owes one only while the record says the first never landed:
 * that is the only way a failed send is ever re-sent, and a sign already heard owes nothing.
 */
export function owesAnnouncement(card: Card, sign: Sign, actor: Actor, lead: Lead): boolean {
	const record = signRecord(card, sign);
	return record === undefined || !signedAs(record, actor, lead) || record.told === undefined;
}

/**
 * Record that a notice was settled, so the card stops owing it.
 *
 * For a sign the signer's own operation: `signedAs` is the gate. For a handoff there is no
 * signature — the door that wrote the owner announces it — so only the record's absence gates it.
 */
export function announced(
	card: Card,
	op: Extract<CardOp, { kind: "announced" }>,
	actor: Actor,
	config: BoardConfig,
	now: number,
): Prepared {
	const told = TELL_FIELDS[op.notice];
	// A sign is its own signer's to announce; a handoff has no signature, and only its absence gates.
	if (op.notice !== "assign") {
		const record = signRecord(card, op.notice);
		const named = op.notice === "approve" ? "approval" : "spot-check";
		if (record === undefined) return { error: `${cardRef(card.id)} has no ${named} to announce.` };
		if (!signedAs(record, actor, config.lead)) {
			return {
				error: `${cardRef(card.id)}'s ${named} is ${record.by}'s to announce, and this session is ${actor.label}.`,
			};
		}
	}
	if (told.read(card) !== undefined) return { changed: false, fields: null };
	return { changed: true, fields: told.patch(card, now) };
}
