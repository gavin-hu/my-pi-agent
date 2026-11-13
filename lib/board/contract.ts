/**
 * The contract: the three lines a card must state before it may be executed.
 *
 * A card is one feature, and the board's job in the PLAN lane is to say what "done" means
 * *before* anybody starts — goal, acceptance, and what is deliberately out of scope — so a
 * session that picks the card up does not renegotiate it, and a session that finishes it
 * can be checked against something it did not write. The contract is three one-line fields
 * on the card file: the plan file says how, the contract says what and why.
 *
 * A fourth line, {@link Contract.verify}, is optional: the command whose run the spot-check
 * records. It is a contract line like the others — a change to it drops the approval, because
 * the sign names the wording the reviewer checked — but the completeness gate does not ask for
 * it, so a card that names no command keeps the gate it had.
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
import type { Card } from "./card.ts";
import type { Lead } from "./lead.ts";
import type { Actor } from "./rules.ts";

/** The three lines of a contract, in the order a reader and a refusal name them. */
export const CONTRACT_FIELDS = ["goal", "acceptance", "scopeOut"] as const;

/** One line of a contract. */
export type ContractField = (typeof CONTRACT_FIELDS)[number];

/** Longest single contract line, in characters. One line, so it fits a row and a dialog rung. */
export const MAX_CONTRACT = 400;

/**
 * What a printer says for a line the contract still owes.
 *
 * One word, in one place, because two surfaces print a contract and they must not invent a
 * phrase each. It is the word `reason.ts` already speaks in the card's next step — "no contract yet
 * — missing acceptance, scopeOut" — so a reader who sees the transcript's line and the page's
 * reason line is reading the same fact, not two spellings of it.
 */
export const CONTRACT_LINE_OWED = "missing";

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
	/**
	 * What the signer's own call ran, when the contract named a command: the acceptance is a
	 * fact about a run, so the file keeps the command, its exit, when it finished, and the commit
	 * the board was on. A source that is not a run (`byInstruction`) carries none.
	 */
	verified?: Verification;
}

/**
 * One run of a contract's acceptance command, as the sign records it.
 *
 * The board executes nothing: the sign's own call runs the command and hands this over, so the
 * record is evidence of a run rather than an instruction to make one. `sha` is the commit the
 * repository was on at the run, absent outside a repository — evidence for a reader, never a
 * gate, because a board outside git has no commit to name.
 */
export interface Verification {
	/** The command as the contract wrote it, so a changed line cannot ride an old result. */
	cmd: string;
	/** What the command exited with. Only zero is a check that passed. */
	exit: number;
	/** When the run finished, on the board's clock. */
	at: number;
	/** The commit the repository was on, when it was a repository. */
	sha?: string;
	/**
	 * The tree the command ran in, absolute: the checkout, or the worktree the reviewer entered.
	 *
	 * A sha alone cannot say which tree it proves — a branch and `main` share a repository — so a
	 * reader deciding whether the evidence covers the work needs the tree beside it. Absent on
	 * signs written before the board recorded one.
	 */
	root?: string;
}

/** What a card promises before it may be executed. */
export interface Contract {
	/** What the feature is for, in one line. */
	goal: string;
	/** How a reader can tell it is done, in one line. */
	acceptance: string;
	/** What this deliberately does not do, so a reviewer does not ask for it. */
	scopeOut: string;
	/**
	 * The command that proves the acceptance, when the card has one to run.
	 *
	 * Absent is the ordinary case and not a gap: a card that names no command is spot-checked by
	 * a reader, exactly as before this line existed.
	 */
	verify?: string;
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

/**
 * The optional `verify` line: one sanitized line, or empty to take it back off the contract.
 *
 * Unlike the three required fields, empty is an answer here — a card whose acceptance is read
 * rather than run can stop naming a command — so this returns `{ text: "" }` instead of
 * refusing. The cap is the contract line's: it is drawn on the same row as its neighbours.
 */
export function normalizeVerify(raw: unknown): { text: string } | FieldError {
	if (typeof raw !== "string") return { error: "verify must be a command line; omit it to leave the contract's." };
	const text = sanitizeLine(raw).trim();
	if (text.length > MAX_CONTRACT) return { error: `verify must be at most ${MAX_CONTRACT} characters.` };
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
	changed: Partial<Record<ContractField | "verify", string>>,
): Contract {
	const verify = changed.verify ?? contract?.verify;
	const next: Contract = {
		goal: changed.goal ?? contract?.goal ?? "",
		acceptance: changed.acceptance ?? contract?.acceptance ?? "",
		scopeOut: changed.scopeOut ?? contract?.scopeOut ?? "",
		// Cleared by an empty string rather than left as one: absent and "" are one fact.
		...(verify === undefined || verify === "" ? {} : { verify }),
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
	// A record this build cannot read is the card's, not a fact to trust: the done gate reads this
	// field, so a hand-edited run would be evidence it never was.
	if (sign.verified !== undefined && !isVerification(sign.verified)) return false;
	if (sign.byInstruction === undefined) return true;
	const reason = normalizeInstruction(sign.byInstruction);
	return !("error" in reason) && reason.text === sign.byInstruction;
}

/**
 * Whether `value` is a recorded run: a command, a whole exit code, a whole moment, and a commit
 * that is a string when it is there.
 *
 * The exit code is kept as it ran rather than required to be zero — a file may hold the run that
 * failed, and the gate is what refuses it — so this checks the shape and not the verdict.
 */
export function isVerification(value: unknown): value is Verification {
	if (typeof value !== "object" || value === null) return false;
	const run = value as Record<string, unknown>;
	if (typeof run.cmd !== "string" || run.cmd.trim() === "") return false;
	if (typeof run.exit !== "number" || !Number.isInteger(run.exit)) return false;
	if (typeof run.at !== "number" || !Number.isInteger(run.at)) return false;
	if (run.root !== undefined && (typeof run.root !== "string" || run.root === "")) return false;
	return run.sha === undefined || (typeof run.sha === "string" && run.sha !== "");
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

/**
 * Whether `value` is a contract this build can read.
 *
 * Shape, not completeness: the three lines are strings within the cap, and a line may be empty,
 * because a contract is written a field at a time — `missingContractFields` and `contractComplete`
 * are where "written yet" is asked, and `approve` asks them before it signs. What is refused here is
 * a record this build cannot trust: a key that is missing (a hand edit — the writer always states all
 * three), a line that is not a string, one past the cap, or an `approved` that is not a sign. An
 * empty `verify` is no command, the same fact `mergedContract` states by leaving the key out.
 */
export function isContract(value: unknown): value is Contract {
	if (typeof value !== "object" || value === null) return false;
	const contract = value as Record<string, unknown>;
	for (const field of CONTRACT_FIELDS) {
		const line = contract[field];
		if (typeof line !== "string" || line.length > MAX_CONTRACT) return false;
	}
	if (contract.verify !== undefined) {
		const line = contract.verify;
		if (typeof line !== "string" || line.length > MAX_CONTRACT) return false;
	}
	return contract.approved === undefined || isSign(contract.approved);
}

// --- The two gates, as words -------------------------------------------------

/**
 * What a refusal says when the project names no lead: the key that names one.
 *
 * One phrase because four sentences continue it, and a project that has not named its lead yet
 * should read one instruction in all four rather than four paraphrases of it.
 */
const NO_LEAD = "and this board names none: set `team.lead` in `bytefly.json`";

/**
 * The lead as a sentence names it: the team's word, or the key that would name one.
 *
 * A refusal that prints an empty parenthesis reads as a bug; this prints the setting a reader can
 * fix instead, in the same place the name would have gone.
 */
export function leadName(lead: Lead): string {
	return lead === "" ? "`team.lead`" : lead;
}

/**
 * How a session asks the lead for a sign.
 *
 * The gates are the lead's, and the sessions that want one are its peers on the same bus, so the
 * way to ask is a message: it waits in the lead's inbox and starts no turn, which is exactly what
 * a handoff is. With no lead named there is nobody to ask, so the sentence names the setting
 * rather than a peer.
 */
export function askLead(lead: Lead): string {
	return lead === "" ? "set `team.lead` in `bytefly.json`" : `ask ${lead} with \`session send\``;
}

/** The words one sign is refused with, wherever the refusal is written. */
export interface SignWords {
	/** What a session that is not the lead is told. */
	readonly notSigner: (id: string, actor: Pick<Actor, "label">, lead: Lead) => string;
	/** What a holder that is not the lead is told. */
	readonly holder: string;
	/** What a holder that is the lead has to do first. */
	readonly release: string;
	/** What the move gate says when nobody has signed: the way out, naming the lead. */
	readonly missing: (id: string, lead: Lead) => string;
	/** What the card's owner reads when the sign lands: who signed, and the move it unlocked. */
	readonly signed: (card: Pick<Card, "id" | "title" | "review">, by: string) => string;
}

/** The two words a gate is signed with, as `lead.ts`'s `Sign` names them. */
type SignKind = "approve" | "review";

export const SIGN_WORDS: Record<SignKind, SignWords> = {
	approve: {
		notSigner: (id, actor, lead) =>
			lead === ""
				? `#${id}'s contract is signed by the lead, ${NO_LEAD}, or the person signs it with \`/board approve ${id}\`.`
				: `#${id}'s contract is signed by the lead (${lead}), and this session is ${actor.label} — ${askLead(lead)}, or the person signs it with \`/board approve ${id}\`.`,
		holder: "Its contract is signed by the lead, who does not hold it.",
		release: "A lead releases a card before signing it.",
		missing: (id, lead) =>
			lead === ""
				? `#${id} is in plan; its contract is not approved yet, ${NO_LEAD}, or the person approves it with \`/board approve ${id}\`.`
				: `#${id} is in plan; its contract is not approved yet. The lead (${lead}) approves with \`approve\` (${askLead(lead)}), or the person with \`/board approve ${id}\`.`,
		signed: (card, by) =>
			`Signature: #${card.id} "${card.title}" — its contract is approved by ${by}.\n` +
			`Next: \`execute\` is open — board action "move" with lane "execute", while the lane has room. \`done\` still needs the lead's \`review\`.`,
	},
	review: {
		notSigner: (id, actor, lead) =>
			lead === ""
				? `#${id} is spot-checked by the lead, ${NO_LEAD}, or the person signs with \`/board review ${id}\`.`
				: `#${id} is spot-checked by the lead (${lead}), and this session is ${actor.label} — ${askLead(lead)}, or the person signs with \`/board review ${id}\`.`,
		holder: "A card is spot-checked by the lead, who does not hold it.",
		release: "A lead releases a card before spot-checking it.",
		missing: (id, lead) =>
			lead === ""
				? `#${id} has no spot-check recorded, ${NO_LEAD}, or the person records one with \`/board review ${id}\`.`
				: `#${id} has no spot-check recorded. The lead (${lead}) records one with \`review\` (${askLead(lead)}), or the person with \`/board review ${id}\`.`,
		// Two signs, two announcements: a spot-check opens the last move, while one made by
		// instruction is already the close, so telling its owner that `done` is open would send it
		// after a move its card made before the sign existed.
		signed: (card, by) => {
			const why = card.review?.byInstruction;
			if (why !== undefined) {
				return (
					`Signature: #${card.id} "${card.title}" — closed by instruction, signed by ${by}: ${why}.\n` +
					`Next: nothing is open — the card is already done, and its record says how it was closed.`
				);
			}
			return (
				`Signature: #${card.id} "${card.title}" — spot-checked by ${by}.\n` +
				`Next: \`done\` is open — board action "move" with lane "done", while the plan it recorded is still in the store.`
			);
		},
	},
};
