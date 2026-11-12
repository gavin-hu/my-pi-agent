/**
 * Who may act on a card's two gates and its return to the pool: the lead, and the person at the
 * keyboard.
 *
 * `approve` and `review` are the board's one human judgement — a contract somebody read and a
 * piece of work somebody looked at — so the signature has to belong to somebody accountable
 * rather than to whichever peer answered first. The lead is a team name in `bytefly.json`
 * (`board.lead`, defaulting to the page's seat — `board/seat.ts` — in `config.ts`), because that is
 * the one identity a pure rule can be handed and a card file can record; the person is the one
 * actor a file can name that is not a holder, which is what keeps a repository worked by one
 * session able to close a card at all.
 *
 * The signer is refused in two shapes and this module owns both: a session that is not the lead
 * (`signRefusal`), and a lead that holds the card it means to sign (`holderRefusal` — release it
 * first, since a session signing its own wording is the gate approving itself). The words of each
 * sign live in one table here, so the two gates and the lane requirements that ask for a
 * signature cannot drift into four slightly different sentences: a refusal names `askLead` as the
 * way to ask, and `signedText` is what the sign sends the card's owner.
 *
 * `reclaim` is the third decision here, because it is the same question asked of another verb: the
 * holder may always take its own card back, the lead takes anybody's as a repair, and a peer takes
 * one only from a session the bus says has stopped. What the return keeps is the one rule about a
 * signature that is not about making it — a spot-check is evidence, so only its own signer
 * withdraws it.
 *
 * The announcement is the fourth: a sign nobody heard is a gate nobody knows is open, so the card
 * records when its message was settled (`Sign.told`) and a repeat sign owes it again while it is
 * absent. That record is written by its own operation, refused to anybody but the sign's signer —
 * `signedAs`, never a name compare, because the person signs as the lead's name.
 *
 * Pure: a name compare and a sentence, no clock and no file.
 */

import { normalizeLabel } from "../session-label.ts";
import { cardRef, type Card, type CardOwner, holds, laneSince, MAX_NOTES, normalizeNote } from "./card.ts";
import { type Sign as SignRecord, type Verification, isVerification, normalizeInstruction } from "./contract.ts";
import type { BoardConfig } from "./config.ts";
import { LANE_RULES } from "./lanes.ts";
import type { Actor, CardOp, Prepared } from "./rules.ts";
import type { SessionPresence } from "../session-roster.ts";

/** The lead's team name: the label a signature has to carry. */
export type Lead = string;

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
 * stores. The mark is what tells the two apart afterwards.
 */
export function signMark(actor: Actor, lead: Lead): Pick<SignRecord, "by" | "person"> {
	return isPerson(actor) ? { by: lead, person: true } : { by: actor.label };
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
 */
export function normalizeLead(raw: unknown, base: Lead): Lead {
	return typeof raw === "string" ? normalizeLabel(raw, base) : base;
}

/**
 * Whether `actor` is the lead.
 *
 * A label compare, the way a teammate is addressed — not `holds`, which asks whether a session
 * owns a card and prefers the ids when both sides have one.
 */
export function isLead(actor: Pick<Actor, "label">, lead: Lead): boolean {
	return actor.label.toLowerCase() === lead.toLowerCase();
}

/** The two signs a card carries. */
export type Sign = "approve" | "review";

/** The two signs, in the order a person is likely to want them. */
const SIGN_KINDS: readonly Sign[] = ["approve", "review"];

/** `word` as one of the two signs, or `undefined` when it is not one. */
export function signOf(word: string): Sign | undefined {
	return SIGN_KINDS.find((sign) => sign === word);
}

/** The words one sign is refused with, wherever the refusal is written. */
interface SignWords {
	/** What a session that is not the lead is told. */
	readonly notSigner: (card: Card, actor: Actor, lead: Lead) => string;
	/** What a holder that is not the lead is told. */
	readonly holder: string;
	/** What a holder that is the lead has to do first. */
	readonly release: string;
	/** What the move gate says when nobody has signed: the way out, naming the lead. */
	readonly missing: (card: Card, lead: Lead) => string;
	/** What the card's owner reads when the sign lands: who signed, and the move it unlocked. */
	readonly signed: (card: Card, by: string) => string;
}

const SIGN_WORDS: Record<Sign, SignWords> = {
	approve: {
		notSigner: (card, actor, lead) =>
			`${cardRef(card.id)}'s contract is signed by the lead (${lead}), and this session is ${actor.label} — ${askLead(lead)}, or the person signs it with \`/board approve ${card.id}\`.`,
		holder: "Its contract is signed by the lead, who does not hold it.",
		release: "A lead releases a card before signing it.",
		missing: (card, lead) =>
			`${cardRef(card.id)} is in plan; its contract is not approved yet. The lead (${lead}) approves with \`approve\` (${askLead(lead)}), or the person with \`/board approve ${card.id}\`.`,
		signed: (card, by) =>
			`Signature: ${cardRef(card.id)} "${card.title}" — its contract is approved by ${by}.\n` +
			`Next: \`execute\` is open — board action "move" with lane "execute", while the lane has room. \`done\` still needs the lead's \`review\`.`,
	},
	review: {
		notSigner: (card, actor, lead) =>
			`${cardRef(card.id)} is spot-checked by the lead (${lead}), and this session is ${actor.label} — ${askLead(lead)}, or the person signs with \`/board review ${card.id}\`.`,
		holder: "A card is spot-checked by the lead, who does not hold it.",
		release: "A lead releases a card before spot-checking it.",
		missing: (card, lead) =>
			`${cardRef(card.id)} has no spot-check recorded. The lead (${lead}) records one with \`review\` (${askLead(lead)}), or the person with \`/board review ${card.id}\`.`,
		// Two signs, two announcements: a spot-check opens the last move, while one made by
		// instruction is already the close, so telling its owner that `done` is open would send it
		// after a move its card made before the sign existed.
		signed: (card, by) => {
			const why = card.review?.byInstruction;
			if (why !== undefined) {
				return (
					`Signature: ${cardRef(card.id)} "${card.title}" — closed by instruction, signed by ${by}: ${why}.\n` +
					`Next: nothing is open — the card is already done, and its record says how it was closed.`
				);
			}
			return (
				`Signature: ${cardRef(card.id)} "${card.title}" — spot-checked by ${by}.\n` +
				`Next: \`done\` is open — board action "move" with lane "done", while the plan it recorded is still in the store.`
			);
		},
	},
};

/**
 * How a session asks the lead for a sign.
 *
 * The gates are the lead's, and the sessions that want one are its peers on the same bus, so the
 * way to ask is a message: it waits in the lead's inbox and starts no turn, which is exactly what
 * a handoff is. The phrase is written once because two surfaces print it — the refusals below,
 * and `team`'s handoff, whose text told a peer to ask before this sentence had a home.
 */
export function askLead(lead: Lead): string {
	return `ask ${lead} with \`session send\``;
}

/**
 * Why `actor` may not sign `card`, or `undefined` when it may.
 *
 * The holder is the caller's own check: this asks only whether the actor is the person or the
 * lead, because those are the two answers the gate accepts.
 */
export function signRefusal(card: Card, actor: Actor, lead: Lead, sign: Sign): string | undefined {
	if (isPerson(actor) || isLead(actor, lead)) return undefined;
	return SIGN_WORDS[sign].notSigner(card, actor, lead);
}

/** What a holder is told when it means to sign its own card: what the lead does, or what it is. */
export function holderRefusal(actor: Actor, lead: Lead, sign: Sign): string {
	return isLead(actor, lead) ? SIGN_WORDS[sign].release : SIGN_WORDS[sign].holder;
}

/** Who holds the card, as every refusal that is about a holder opens. */
export function heldBy(card: Card): string {
	return `${cardRef(card.id)} is held by ${card.owner?.label ?? "another session"}.`;
}

/** What a lane that needs a sign nobody gave says: the lead approves it, or the person signs. */
export function missingSign(card: Card, lead: Lead, sign: Sign): string {
	return SIGN_WORDS[sign].missing(card, lead);
}

/**
 * What a `done` move is refused with when the contract named a command and the sign has no run.
 *
 * A card that names one is not spot-checked by a sentence any more, and the refusal is the place
 * that says so: it names the command, and both doors that would record it, because "review it
 * again" alone leaves a reader guessing which of the two they have.
 */
export function unverifiedSpotCheck(card: Card, cmd: string, lead: Lead): string {
	return `${cardRef(card.id)}'s contract names \`${cmd}\`, and its spot-check carries no result: the lead (${lead}) records one with \`review\`, or the person with \`/board review ${card.id}\`.`;
}

/**
 * What a `done` move is refused with when the run is older than the card it vouches for.
 *
 * A write after the sign — a note, an edit, a second move — is the card changing under the
 * evidence, so the run has to be made again. The sentence names what to re-run and both doors.
 */
export function staleSpotCheck(card: Card, cmd: string, lead: Lead): string {
	return `${cardRef(card.id)} was written after its spot-check, so the run no longer speaks for it — run \`${cmd}\` and review again: the lead (${lead}) with \`review\`, or the person with \`/board review ${card.id}\`.`;
}

/** What a `review` is refused with when the command it ran did not pass. */
export function failedSpotCheck(card: Card, cmd: string, exit: number): string {
	return `\`${cmd}\` exited ${exit}, so ${cardRef(card.id)} was not spot-checked.`;
}

/** What a `review` is refused with when the command outlived the bound the board gives it. */
export function killedSpotCheck(card: Card, cmd: string, boundMs: number): string {
	const minutes = Math.max(1, Math.round(boundMs / 60_000));
	return `\`${cmd}\` did not finish within ${minutes} minutes, so ${cardRef(card.id)} was not spot-checked.`;
}

/**
 * The spot-check that speaks for the work in the lane the card is in now.
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
 */
export function currentReview(card: Card): SignRecord | undefined {
	const review = card.review;
	if (review === undefined) return undefined;
	const since = card.lane === "execute" ? laneSince(card) : undefined;
	return since === undefined || review.at >= since ? review : undefined;
}

/**
 * What a sign sends the card's owner: who signed, and the move it unlocked.
 *
 * The gate is the lead's and the card is worked by its owner, so the one session that can act on
 * the sign is the one told. Without it the owner learns by polling a board it has no reason to
 * read twice, and the lead learns which card is ready the same way. `by` is the name the sign
 * recorded rather than the actor's label, because the owner is being told who signed and the
 * person's label is only ever what their own line prints.
 */
export function signedText(card: Card, sign: Sign, by: string): string {
	return SIGN_WORDS[sign].signed(card, by);
}

/**
 * What a result says when the card's owner did not hear about a sign.
 *
 * Two doors write a sign — the tool, and the person's `/board approve` — and each sends by the
 * one bus transport its context allows, so a bus that cannot answer costs both a line on the
 * result. The sentence is one body so a reader of either transcript is told the same fact in
 * the same words, and the signature is recorded either way, which is why this is a line on a
 * result and never a refusal.
 */
export function notToldLine(owner: string, reason: string): string {
	return `${owner} was not told (${reason})`;
}

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
 * A card's notes after one more, with {@link MAX_NOTES} kept and the rest counted.
 *
 * One body for the two writers a note has — `note`, and the note a sign carries — because the
 * cap is the record's and a clipped list is the same arithmetic in both.
 */
export function appendNote(card: Card, by: string, at: number, text: string): Pick<Card, "notes" | "notesDropped"> {
	const notes = [...card.notes, { by, at, text }];
	const overflow = Math.max(0, notes.length - MAX_NOTES);
	return { notes: overflow === 0 ? notes : notes.slice(overflow), notesDropped: card.notesDropped + overflow };
}

/**
 * Whether the card has been written since its sign last spoke for it.
 *
 * A sign owns two writes: the stamp, and `#398`'s record that its owner heard — so the moment to
 * compare is the later of the two. One reader for both places the rule is asked: the `done` gate
 * refuses a spot-check the work has outgrown, and a repeat sign re-makes a stamp that has gone
 * stale, so the arithmetic that decides "the work moved under the signature" cannot differ
 * between the gate and the sign that answers it.
 */
export function signStale(card: Card, record: SignRecord): boolean {
	return card.updatedAt > Math.max(record.at, record.told?.at ?? 0);
}

/**
 * Record the spot-check of finished work: the lead's, and never the holder's.
 *
 * `text` rides the sign here too, so "checked, and this is still wrong" is one call.
 *
 * `override` is the other way a finished card gets a sign, and it is somebody saying the gate
 * was jumped: the reason is required, the card must already be `done`, and no review may be on
 * it, because the one rule this relaxes is the lane and a reason is not a second signature. Who
 * may sign, and never the holder, is the same gate. The sign records how it was made, so a
 * forced close reads as one instead of as a clean one.
 *
 * `verified` is the run the signer's own call made of the command the contract names, and it is
 * held to three rules here rather than trusted: the card's contract has to name that command, the
 * exit has to be zero, and an override carries none — a close by instruction is a person saying
 * the gate was jumped, not a check that passed. A card whose contract names a command is refused
 * without one, which is what makes the evidence a gate rather than a note.
 */
export function review(
	card: Card,
	actor: Actor,
	now: number,
	config: BoardConfig,
	text?: unknown,
	override?: unknown,
	verified?: unknown,
): Prepared {
	const instruction = override === undefined ? undefined : normalizeInstruction(override);
	if (instruction !== undefined && "error" in instruction) return { error: instruction.error };
	if (instruction === undefined) {
		if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; it cannot be reviewed.` };
		if (card.lane !== "execute") {
			return { error: `${cardRef(card.id)} is in ${card.lane}; finished work is spot-checked in execute.` };
		}
	} else if (!LANE_RULES[card.lane].terminal) {
		return { error: `${cardRef(card.id)} is in ${card.lane}; an override signs a card that is already done.` };
	}
	if (holds(card, actor)) return { error: `${heldBy(card)} ${holderRefusal(actor, config.lead, "review")}` };
	const wrongSigner = signRefusal(card, actor, config.lead, "review");
	if (wrongSigner !== undefined) return { error: wrongSigner };
	const evidence = evidenceFor(card, config, instruction !== undefined, verified);
	if ("error" in evidence) return { error: evidence.error };
	const already = currentReview(card);
	const signed = signedAs(already, actor, config.lead);
	// A sign is a fact about a person and a moment, so an override never replaces one: it is how a
	// card with no spot-check gets a record, not how a record gets a different author.
	if (instruction !== undefined && already !== undefined && !(signed && already.byInstruction !== undefined)) {
		return {
			error: `${cardRef(card.id)} is already spot-checked by ${already.by}; an override signs a card that has no sign.`,
		};
	}
	const noted = signNote(card, text, actor, now);
	if ("error" in noted) return { error: noted.error };
	// The same rule as `approve`: a sign owes its message, and a repeat owes it while untold — the
	// only way a failed send is ever re-sent.
	const owes = owesAnnouncement(card, "review", actor, config.lead);
	// The same signer signs again for one of two reasons, and both re-make the stamp rather than
	// leaving the old one standing: they are saying something the card did not record yet (`noted`),
	// or the card has been written since their sign, which is exactly what the `done` gate refuses
	// with "review again" — a remedy a repeat could not otherwise perform, because its own note
	// moves the card again. Only a sign that says nothing, on a card it still speaks for, is the
	// no-op the repeat rule keeps.
	const redo =
		signed && instruction === undefined && (noted.wrote || (already !== undefined && signStale(card, already)));
	// A sign that is already there and stays: nothing to stamp, and an untold one still owes its
	// message. An override's repeat is one of these but its note is still a write, so it falls
	// through to the note-only return below.
	const repeat = signed && !redo;
	if (repeat && !noted.wrote) return { changed: false, fields: null, ...(owes ? { announce: true as const } : {}) };
	const stamp =
		instruction === undefined
			? { ...signMark(actor, config.lead), at: now }
			: { ...signMark(actor, config.lead), at: now, byInstruction: instruction.text };
	// The run rides the stamp it is evidence for. A re-made sign takes this call's run, because the
	// old one vouched for the card as it was before the write that made the stamp stale.
	const stamped = evidence.verified === undefined ? stamp : { ...stamp, verified: evidence.verified };
	// A repeat that only speaks (an override's note, a sign already there) keeps the stamp it found;
	// a re-made one replaces it, so the card's clock can never be newer than the sign it vouches for.
	const spotCheck = repeat ? {} : { review: stamped };
	// A fresh stamp drops its `told`, so it owes the message its owner already heard for the sign it
	// replaced: a re-made sign is a new fact, and the announcement is a write of its own.
	const announce = owes || redo;
	// As with `approve`: a second signer's note moves the card, and the owner's message follows the
	// stamp — or the untold sign a repeat still owes them.
	return { changed: true, fields: { ...spotCheck, ...noted.fields }, ...(announce ? { announce: true as const } : {}) };
}

/**
 * The run a spot-check carries, or the reason it cannot.
 *
 * The contract's command is the only one worth evidence: a result for any other command would
 * vouch for something the card never promised, and a result for the *old* command is the failure
 * this whole rule exists to prevent — a reviewer's green standing over wording the card has since
 * changed. An override never carries one: it is the close a gate did not get, and dressing it in
 * a run would make an instruction read as a check.
 */
function evidenceFor(
	card: Card,
	config: BoardConfig,
	instruction: boolean,
	raw: unknown,
): { verified?: Verification } | { error: string } {
	if (raw === undefined) {
		// Fail closed where a command is named: the card asked for a run, and a sign without one is
		// the belief this gate replaced.
		const named = card.contract?.verify;
		if (named !== undefined && !instruction) return { error: unverifiedSpotCheck(card, named, config.lead) };
		return {};
	}
	if (instruction) return { error: `${cardRef(card.id)}'s override carries no run; an instruction is not a check.` };
	if (!isVerification(raw)) return { error: `${cardRef(card.id)}'s run is not a command, an exit, and a moment.` };
	const named = card.contract?.verify;
	if (named === undefined) {
		return { error: `${cardRef(card.id)}'s contract names no command, so there is no run to record.` };
	}
	if (named !== raw.cmd) {
		return { error: `${cardRef(card.id)}'s contract names \`${named}\`, not \`${raw.cmd}\`; review the card again.` };
	}
	if (raw.exit !== 0) return { error: failedSpotCheck(card, raw.cmd, raw.exit) };
	return { verified: raw };
}

/**
 * The note a signer leaves with the sign, in the same write.
 *
 * Validated after the gate, as `note` validates after the holder check: a card that cannot be
 * signed at all is the answer worth reading first.
 */
export function signNote(
	card: Card,
	raw: unknown,
	actor: Actor,
	now: number,
): { fields: Partial<Card>; wrote: boolean } | { error: string } {
	if (raw === undefined) return { fields: {}, wrote: false };
	const parsed = normalizeNote(raw);
	if ("error" in parsed) return { error: parsed.error };
	return { fields: appendNote(card, actor.label, now, parsed.text), wrote: true };
}

/**
 * Take a card back to the pool, for the callers this module already answers for.
 *
 * The holder may always (a release by another name), the person and the lead may take anybody's,
 * and a peer only when the bus says the owner has stopped — `quiet` or `gone`. `absent` is refused
 * with no fact at all: a live session that never joined this bus has no record either, so no record
 * is not an answer.
 */
export function reclaim(card: Card, actor: Actor, config: BoardConfig, holder?: HolderFact): Prepared {
	if (LANE_RULES[card.lane].terminal) {
		return { error: `${cardRef(card.id)} is done; there is nothing to reclaim.` };
	}
	if (card.owner === undefined) return { error: `${cardRef(card.id)} has no owner to reclaim.` };
	const state = stateOf(card, holder);
	if (!mayTakeBack(card, actor, config.lead, state)) return { error: heldStill(card, config.lead, state) };
	return { changed: true, fields: backToPool(card, actor, config.lead) };
}

/** Whether this caller may take the card back. */
function mayTakeBack(card: Card, actor: Actor, lead: Lead, state: SessionPresence | undefined): boolean {
	if (holds(card, actor) || isPerson(actor) || isLead(actor, lead)) return true;
	return state === "quiet" || state === "gone";
}

/** The bus's answer about the card's holder, when the fact belongs to the owner the card names. */
function stateOf(card: Card, holder: HolderFact | undefined): SessionPresence | undefined {
	const owner = card.owner;
	if (owner === undefined || holder === undefined) return undefined;
	// A handoff the bus could not resolve is nobody's by label, so the fact binds to no caller.
	if (owner.handoff?.unresolved === true) return undefined;
	// The order `holds` compares in: the two ids when both sides have one, else the label.
	const same =
		owner.id !== undefined && holder.owner.id !== undefined
			? owner.id === holder.owner.id
			: owner.label.toLowerCase() === holder.owner.label.toLowerCase();
	return same ? holder.state : undefined;
}

/** What a card looks like back in the pool: nobody's, and its spot-check unless its signer took it. */
function backToPool(card: Card, actor: Actor, lead: Lead): Partial<Card> {
	return {
		lane: "backlog",
		owner: undefined,
		offeredAt: undefined,
		// A spot-check is evidence that somebody looked at the work, and taking the card back is not
		// a look: only the signer withdraws their own sign, so a third session keeps what it found.
		review: signedAs(card.review, actor, lead) ? undefined : card.review,
	};
}

/**
 * Why this caller may not take the card back, in the three shapes the bus leaves.
 *
 * A sentence each, because the caller's next move differs: a running peer is asked to release, a
 * session the bus has never recorded cannot be asked, and a board with no bus at all has nothing
 * to go on.
 */
function heldStill(card: Card, lead: Lead, state: SessionPresence | undefined): string {
	const owner = card.owner?.label ?? "another session";
	const held = `${cardRef(card.id)} is held by ${owner}.`;
	if (state === "live") {
		return `${held} That session is running, so only the lead (${lead}) takes a live peer's card back — ask ${owner} to release it, or ${askLead(lead)}.`;
	}
	if (state === "absent") {
		return `${held} The bus has no record of that session, and nothing says it stopped: only the lead (${lead}) takes the card back.`;
	}
	return `${held} Nothing here says whether that session is running, so only the lead (${lead}) takes the card back.`;
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
 * Record that a sign's message was settled, so its signer stops owning it one.
 *
 * The signer's own operation: `signedAs` is the gate, which accepts the person's `person: true`
 * sign and refuses a session wearing the lead's name, because recording an announcement is a
 * statement about a signature that session did not make. A record already there is the no-op —
 * two doors announcing one sign is one fact, not two.
 */
export function announced(
	card: Card,
	op: Extract<CardOp, { kind: "announced" }>,
	actor: Actor,
	config: BoardConfig,
	now: number,
): Prepared {
	const record = signRecord(card, op.sign);
	const named = op.sign === "approve" ? "approval" : "spot-check";
	if (record === undefined) return { error: `${cardRef(card.id)} has no ${named} to announce.` };
	if (!signedAs(record, actor, config.lead)) {
		return {
			error: `${cardRef(card.id)}'s ${named} is ${record.by}'s to announce, and this session is ${actor.label}.`,
		};
	}
	if (record.told !== undefined) return { changed: false, fields: null };
	const told = { ...record, told: { at: now } };
	if (op.sign === "approve" && card.contract !== undefined) {
		return { changed: true, fields: { contract: { ...card.contract, approved: told } } };
	}
	return { changed: true, fields: { review: told } };
}
