/**
 * How a workflow notice reaches the session that must act on it.
 *
 * The sentences, the audience role and the key are `lib/workflow/notice.ts`'s; this module is the
 * delivery half a board can do: resolve the role to a session (`recipient.ts`), send with the
 * shared `Deliver` seam, and record that the bus took it where the card has a field for it.
 *
 * Three facts make the result honest. Who: the peer the roster lists under the card's owner, the
 * live record of the lead's label, or everyone but this session for an offer. Whether it will be
 * read: a record with its watch off reads at its next turn rather than being woken. And when: only
 * a write that owes a notice delivers one — `steps.ts` says which, and a repeat delivers only while
 * the card says it was never heard.
 *
 * Delivery comes after the write, so a bus that fails costs a line on the result and never the
 * state it reports.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Card, owesHandoff } from "../../lib/workflow/card.ts";
import type { Lead, NoticeField } from "../../lib/workflow/contract.ts";
import { notToldLine } from "../../lib/workflow/lead.ts";
import { owesAnnouncement } from "../../lib/workflow/signs.ts";
import { composeNotice, type NoticeKind, NOTICES } from "../../lib/workflow/notice.ts";
import type { Actor } from "../../lib/workflow/rules.ts";
import type { BoardStore } from "../../lib/workflow/store.ts";
import { messageOf } from "../../lib/errors.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { ALARM_REASON, peerAlarm } from "../../lib/session-roster.ts";
import { type Deliver, type SendInput } from "../../lib/session-tool.ts";
import { type Recipient, recipientOf } from "./recipient.ts";

/**
 * What a notice did, and the clause the result carries for it.
 *
 * `delivered` is the half a card can record: the bus took the message, so the notice is settled.
 * A send that failed leaves it false, which is what keeps a sign or a handoff owing until the
 * caller repeats the verb.
 */
export interface Delivery {
	/** The clause for the result — who heard, or why nobody did — or nothing with nobody to tell. */
	line?: string;
	delivered: boolean;
	/** The card after the settlement was recorded, when the notice had a field to record it in. */
	card?: Card;
}

/** What the caller knows about the team, both parts optional. */
export interface Audience {
	/** The bus's records read as data, which works with `session-bus` unloaded. */
	roster?: () => Promise<readonly RosterSession[] | undefined>;
	/** The clock the roster's liveness rule is judged on. */
	now?: () => number;
}

/** One notice to deliver, and everything the door knows that its sentence needs. */
export interface DeliveryRequest {
	kind: NoticeKind;
	card: Card;
	/** The board's lead, who receives a `ready` and signs with a name. */
	lead: Lead;
	/** The session that assigned or reclaimed, for those sentences. */
	by?: string;
	/** The label a handoff names as the new owner. */
	to?: string;
	/** The handoff's or offer's note. */
	note?: string;
	ctx: ExtensionContext;
	deliver: Deliver;
	audience?: Audience;
}

/**
 * Send one workflow notice, and say what happened to it.
 *
 * Never throws: the board has already written what the notice reports, so a bus that is off, slow
 * or refused is a line on the result and not a reason to undo it.
 */
export async function deliverNotice(request: DeliveryRequest): Promise<Delivery> {
	const notice = composeNotice(request.kind, request.card, {
		lead: request.lead,
		...(request.by === undefined ? {} : { by: request.by }),
		...(request.to === undefined ? {} : { to: request.to }),
		...(request.note === undefined ? {} : { note: request.note }),
	});
	// A board that names no lead has no gate for a session to open: the person's door is the only
	// one, and the result already says so. Nothing to send, and nothing owed.
	if (notice.audience === "lead" && request.lead === "") return { delivered: false };
	const roster = await rosterOf(request.audience);
	const now = request.audience?.now?.() ?? 0;
	const recipient = recipientFor(notice.audience, request, roster, now);
	const input: SendInput = {
		kind: notice.kind,
		to: recipient.to,
		text: notice.text,
		key: notice.key,
		about: request.card.id,
	};
	const answer = await request.deliver.send(request.ctx, input).catch((error: unknown) => ({
		ok: false as const,
		error: messageOf(error),
	}));
	if (!answer.ok) return { line: `  ${notToldLine(recipient.label, answer.error)}`, delivered: false };
	const told = answer.delivered[0] ?? recipient.label;
	return { line: `  told ${told}${notAudible(recipient)}`, delivered: true };
}

/**
 * Settle a notice on the card after delivering it: the write a repeat reads.
 *
 * Only the three rows with a `told` half. `ready`, `offer` and `reclaim` have nowhere to record,
 * because they are never owed twice: their delivery is best effort and the round shows what is
 * still waiting.
 */
export async function settleNotice(options: {
	kind: NoticeField;
	store: BoardStore;
	card: Card;
	actor: Actor;
	ctx: ExtensionContext;
	deliver: Deliver;
	audience?: Audience;
	lead: Lead;
	/** The signer's name, for the sentence. */
	by?: string;
	/** The moment the record is stamped, read by the caller. */
	at: number;
}): Promise<Delivery> {
	const answered = await deliverNotice({
		kind: options.kind,
		card: options.card,
		lead: options.lead,
		...(options.by === undefined ? {} : { by: options.by }),
		ctx: options.ctx,
		deliver: options.deliver,
		...(options.audience === undefined ? {} : { audience: options.audience }),
	});
	if (!answered.delivered) return answered;
	const row = NOTICES[options.kind as NoticeKind];
	if (row.told === undefined) return answered;
	const kept = await options.store
		.mutate(options.card.id, { kind: "announced", notice: options.kind }, options.actor, options.at)
		.catch((error: unknown) => ({ ok: false as const, error: messageOf(error) }));
	if (!kept.ok) return { line: `${answered.line ?? ""} (not recorded: ${kept.error})`, delivered: false };
	return { ...answered, card: kept.card };
}

/**
 * Whether a write by this actor owes a notice, read off the card rather than remembered.
 *
 * A row with no `told` half is always sent once; a sign is owed by its own signer while the record
 * says the message never landed; a handoff while its owner's `told` is absent.
 */
export function owesNotice(card: Card, kind: NoticeKind, actor: Actor, lead: Lead): boolean {
	const row = NOTICES[kind];
	if (row.told === undefined) return true;
	if (kind === "assign") return owesHandoff(card);
	if (kind !== "approve" && kind !== "review") return true;
	return owesAnnouncement(card, kind, actor, lead);
}

/** Who one notice is for, resolved by role. */
function recipientFor(
	audience: "owner" | "lead" | "others" | "former-owner",
	request: DeliveryRequest,
	roster: readonly RosterSession[] | undefined,
	now: number,
): Recipient {
	if (audience === "others") return { to: "*", label: "everyone else" };
	if (audience === "lead") return recipientOf({ label: request.lead }, roster, now);
	// `owner` and `former-owner` both name the card's owner: the reclaim passes the card as it was,
	// so the role says why the sentence is addressed there rather than who.
	return recipientOf(request.card.owner ?? { label: request.lead }, roster, now);
}

/**
 * The clause for a peer that will not read the message now: its record aged out, or its watch is off.
 *
 * Which of the two it is, and which outranks which, is `lib/session-roster.ts`'s `peerAlarm`, and
 * the words are `ALARM_REASON`'s, so a peer cannot be told it is asleep by one surface and quiet
 * by another.
 */
function notAudible(recipient: Recipient): string {
	const alarm = peerAlarm(recipient);
	if (alarm === undefined) return "";
	return ` (${alarm === "quiet" ? "quiet" : "not listening"}: ${ALARM_REASON[alarm]})`;
}

/** The roster a caller offered, or nothing when it cannot answer. */
async function rosterOf(audience: Audience = {}): Promise<readonly RosterSession[] | undefined> {
	if (audience.roster === undefined) return undefined;
	try {
		return await audience.roster();
	} catch {
		return undefined;
	}
}
