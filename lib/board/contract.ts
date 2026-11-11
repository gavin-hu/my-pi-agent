/**
 * The contract: the three lines a card must state before it may be executed.
 *
 * A card is one feature, and the board's job in the PLAN lane is to say what "done" means
 * *before* anybody starts — goal, acceptance, and what is deliberately out of scope — so a
 * session that picks the card up does not renegotiate it, and a session that finishes it
 * can be checked against something it did not write. The contract is three one-line fields
 * on the card file: the plan file says how, the contract says what and why.
 *
 * The approval is part of the contract because it is a statement about *this* wording: a
 * changed line is an unapproved one, and every write here drops the sign. A {@link Sign}
 * records who read it and when, which is all a file can say about a person.
 *
 * Value-only: the field caps, the boundary the model's arguments pass, and the shapes
 * `isCard` validates. No I/O, no clock, and no card — a caller that has one reads
 * `card.contract`.
 */

import { sanitizeLine } from "../format.ts";

/** The three lines of a contract, in the order a reader and a refusal name them. */
export const CONTRACT_FIELDS = ["goal", "acceptance", "scopeOut"] as const;

/** One line of a contract. */
export type ContractField = (typeof CONTRACT_FIELDS)[number];

/** Longest single contract line, in characters. One line, so it fits a row and a dialog rung. */
export const MAX_CONTRACT = 400;

/** Who read something and when: an approval of a contract, or a spot-check of finished work. */
export interface Sign {
	/** Who signed, as the file records it: the session's label, or the lead's name for the person. */
	by: string;
	/** When it signed. */
	at: number;
	/**
	 * `true` when the person at the keyboard signed, rather than a session.
	 *
	 * The name and the mark together are the identity a repeated sign is compared against:
	 * the person signs as the lead's name, so without this a session wearing that label would
	 * read back as the same signer.
	 */
	person?: true;
	/**
	 * The one line saying why the gate was overridden, in the signer's words, and absent when it
	 * was not: a sign that carries this is a close made by instruction, and a reader says so.
	 */
	byInstruction?: string;
	/**
	 * When the sign's message to the card's owner was settled, and absent while it is still owed.
	 *
	 * Settled means the bus took the message, or there was no owner to tell: a send that failed
	 * leaves this absent, which is what makes a repeat sign the way it is ever re-sent. A sign
	 * written before this field existed carries none either, so a reader says "not told" only
	 * where that could still change — a gate that is open.
	 */
	told?: { at: number };
}

/** What a card promises before it may be executed. */
export interface Contract {
	/** What the feature is for, in one line. */
	goal: string;
	/** How a reader can tell it is done, in one line. */
	acceptance: string;
	/** What this deliberately does not do, so a reviewer does not ask for it. */
	scopeOut: string;
	/** Who approved this wording, and when. Absent until somebody who does not hold the card reads it. */
	approved?: Sign;
}

/** A rejected field, phrased for the model: what was wrong, not that something was. */
export type FieldError = { error: string };

/**
 * The reason a sign overrode its gate: one sanitized line, or the reason it cannot be one.
 *
 * The cap is the contract line's, for the same reason it exists there: the line is drawn on a
 * row and in a dialog rung, so a signer's essay would be the thing that broke the card face.
 */
export function normalizeInstruction(raw: unknown): { text: string } | FieldError {
	if (typeof raw !== "string") return { error: "override needs the one line saying why." };
	const text = sanitizeLine(raw).trim();
	if (text === "") return { error: "override needs the one line saying why." };
	if (text.length > MAX_CONTRACT) return { error: `override must be at most ${MAX_CONTRACT} characters.` };
	return { text };
}

/** One contract line as stored: one sanitized line, or the reason it cannot be one. */
export function normalizeContractField(field: ContractField, raw: unknown): { text: string } | FieldError {
	if (typeof raw !== "string") return { error: `${field} is required.` };
	const text = sanitizeLine(raw).trim();
	if (text === "") return { error: `${field} is required.` };
	if (text.length > MAX_CONTRACT) return { error: `${field} must be at most ${MAX_CONTRACT} characters.` };
	return { text };
}

/** The fields a contract still needs, in {@link CONTRACT_FIELDS} order. */
export function missingContractFields(contract: Contract | undefined): ContractField[] {
	if (contract === undefined) return [...CONTRACT_FIELDS];
	return CONTRACT_FIELDS.filter((field) => contract[field].trim() === "");
}

/** Whether a contract is complete enough to be approved. */
export function contractComplete(contract: Contract | undefined): boolean {
	return missingContractFields(contract).length === 0;
}

/** Whether a contract has been approved, by anybody at all. */
export function contractApproved(contract: Contract | undefined): boolean {
	return contract?.approved !== undefined;
}

/**
 * The contract with `changed` applied, and no approval on it.
 *
 * A changed line is an unapproved one: the sign names a wording, so keeping it across an
 * edit would let a session approve one contract and execute another. A caller that changed
 * nothing does not call this.
 */
export function mergedContract(
	contract: Contract | undefined,
	changed: Partial<Record<ContractField, string>>,
): Contract {
	const next: Contract = {
		goal: changed.goal ?? contract?.goal ?? "",
		acceptance: changed.acceptance ?? contract?.acceptance ?? "",
		scopeOut: changed.scopeOut ?? contract?.scopeOut ?? "",
	};
	return next;
}

/**
 * Whether `value` is a sign this build can trust: a name, a whole moment, and a reason that is
 * already the line {@link normalizeInstruction} would write.
 *
 * The reason is checked against the normalizer rather than by a second rule, so a hand-edited
 * `byInstruction` cannot read back as a sign while the write path would have refused it.
 */
export function isSign(value: unknown): value is Sign {
	if (typeof value !== "object" || value === null) return false;
	const sign = value as Record<string, unknown>;
	if (typeof sign.by !== "string" || sign.by === "" || typeof sign.at !== "number" || !Number.isInteger(sign.at)) {
		return false;
	}
	if (sign.person !== undefined && sign.person !== true) return false;
	// A malformed announcement would read as "still owed" for the rest of the card's life, so it is
	// refused with the rest of the record rather than tolerated.
	if (sign.told !== undefined && !isTold(sign.told)) return false;
	if (sign.byInstruction === undefined) return true;
	const reason = normalizeInstruction(sign.byInstruction);
	return !("error" in reason) && reason.text === sign.byInstruction;
}

/**
 * A handoff, and whether the bus took its message.
 *
 * `told` means the bus wrote the message, not that its owner read it: mail is pruned after a day, so
 * this record can only answer for the moment of the handoff.
 */
export interface Handoff {
	/** When the handoff was recorded. */
	at: number;
	/** When the bus settled the message it carried; absent while it never did. */
	told?: { at: number };
	/**
	 * The bus could not name the session this handoff was written for, so the owner has no id.
	 *
	 * It withdraws authority, never addressability: `holds` refuses a label match against this owner,
	 * while the announce path still sends to the label it carries. A reader that took "unresolved"
	 * for "unreachable" would look for a bug that is not there.
	 */
	unresolved?: true;
}

/** Whether `value` is a handoff this build wrote: a stamp, and a settled message or none. */
export function isHandoff(value: unknown): value is Handoff {
	if (typeof value !== "object" || value === null) return false;
	const { at, told, unresolved } = value as Record<string, unknown>;
	return (
		typeof at === "number" &&
		Number.isInteger(at) &&
		(told === undefined || isTold(told)) &&
		(unresolved === undefined || unresolved === true)
	);
}

/**
 * When a handoff's or a sign's message was settled, as the record stores it.
 *
 * Exported because `card.ts` validates an owner's handoff with it: the two records carry the same
 * fact in the same shape, and a second copy of this check is how they drift.
 */
export function isTold(value: unknown): value is { at: number } {
	if (typeof value !== "object" || value === null) return false;
	const told = value as Record<string, unknown>;
	return typeof told.at === "number" && Number.isInteger(told.at);
}

/** Whether `value` is a contract this build can trust. */
export function isContract(value: unknown): value is Contract {
	if (typeof value !== "object" || value === null) return false;
	const contract = value as Record<string, unknown>;
	for (const field of CONTRACT_FIELDS) {
		const line = contract[field];
		if (typeof line !== "string" || line === "" || line.length > MAX_CONTRACT) return false;
	}
	return contract.approved === undefined || isSign(contract.approved);
}
