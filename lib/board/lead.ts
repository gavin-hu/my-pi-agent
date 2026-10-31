/**
 * Who may sign a card's two gates: the lead, and the person at the keyboard.
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
 * Pure: a name compare and a sentence, no clock and no file.
 */

import { normalizeLabel } from "../session-label.ts";
import { cardRef, type Card } from "./card.ts";
import type { Actor } from "./rules.ts";

/** The lead's team name: the label a signature has to carry. */
export type Lead = string;

/**
 * The person at the keyboard, as a write is made.
 *
 * `/board approve` and `/board review` write as this label, so a repository worked by one
 * session is not stuck behind its own holder rule, and the record says who signed.
 */
export const PERSON_LABEL = "you";

/** The id the person's actor carries: a prefix no session id uses, so a label cannot stand in. */
export const PERSON_ID = "person:you";

/** The actor a command writes as: the person's label, and an id a session cannot have. */
export function personActor(): Actor {
	return { id: PERSON_ID, label: PERSON_LABEL };
}

/** Whether `actor` is the person at the keyboard rather than a session. */
export function isPerson(actor: Pick<Actor, "id">): boolean {
	return actor.id === PERSON_ID;
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
export const SIGN_KINDS: readonly Sign[] = ["approve", "review"];

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
			`Next: \`execute\` is open — board action "move" with lane "execute". \`done\` still needs the lead's \`review\`.`,
	},
	review: {
		notSigner: (card, actor, lead) =>
			`${cardRef(card.id)} is spot-checked by the lead (${lead}), and this session is ${actor.label} — ${askLead(lead)}, or the person signs with \`/board review ${card.id}\`.`,
		holder: "A card is spot-checked by the lead, who does not hold it.",
		release: "A lead releases a card before spot-checking it.",
		missing: (card, lead) =>
			`${cardRef(card.id)} has no spot-check recorded. The lead (${lead}) records one with \`review\` (${askLead(lead)}), or the person with \`/board review ${card.id}\`.`,
		signed: (card, by) =>
			`Signature: ${cardRef(card.id)} "${card.title}" — spot-checked by ${by}.\n` +
			`Next: \`done\` is open — board action "move" with lane "done", while the plan it recorded is still in the store.`,
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

/** What a lane that needs a sign nobody gave says: the lead approves it, or the person signs. */
export function missingSign(card: Card, lead: Lead, sign: Sign): string {
	return SIGN_WORDS[sign].missing(card, lead);
}

/**
 * What a sign sends the card's owner: who signed, and the move it unlocked.
 *
 * The gate is the lead's and the card is worked by its owner, so the one session that can act on
 * the sign is the one told. Without it the owner learns by polling a board it has no reason to
 * read twice, and the lead learns which card is ready the same way.
 */
export function signedText(card: Card, sign: Sign, by: Actor): string {
	return SIGN_WORDS[sign].signed(card, by.label);
}
