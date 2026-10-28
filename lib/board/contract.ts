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
	/** The session that signed, as the label a card records. */
	by: string;
	/** When it signed. */
	at: number;
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

/** Whether `value` is a sign this build can trust: a name and a whole moment. */
export function isSign(value: unknown): value is Sign {
	if (typeof value !== "object" || value === null) return false;
	const sign = value as Record<string, unknown>;
	return typeof sign.by === "string" && sign.by !== "" && typeof sign.at === "number" && Number.isInteger(sign.at);
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
