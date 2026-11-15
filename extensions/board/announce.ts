/**
 * The message a sign sends: how `approve` and `review` reach the card's owner.
 *
 * The gate is the lead's and the card is worked by its owner, and neither session reads the
 * other's transcript — so the sign is the fact the owner acts on, and it travels the way a
 * handoff does: an event that waits in the inbox and starts no turn, instead of a board the
 * owner has no reason to read twice.
 *
 * Three facts make the result honest, and each is a question this module asks before it says
 * anything. Who: the peer the roster lists under the card's owner, so a card whose holder id
 * has aged out still reaches the session that holds the label (`recipient.ts`). Whether it will
 * be read: a record with its watch off reports mail at its next turn rather than raising one,
 * which is the one thing a lead can act on, and the page's Team tab already says it. And when:
 * only a fresh stamp owes a message — a note on a card that was already signed is a write the
 * owner has nothing to hear about.
 *
 * It is sent after the write, so a bus that fails costs a line on the result and never the
 * signature: a refusal here would report an unrecorded sign that the card holds, and the
 * owner's next read would contradict it.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Card } from "../../lib/workflow/card.ts";
import { readyText } from "../../lib/workflow/contract.ts";
import { type Lead, type Sign, notToldLine, signedText } from "../../lib/workflow/lead.ts";
import type { Actor } from "../../lib/workflow/rules.ts";
import type { BoardStore } from "../../lib/workflow/store.ts";
import { messageOf } from "../../lib/errors.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { ALARM_REASON, peerAlarm } from "../../lib/session-roster.ts";
import { type SendResult, send } from "../../lib/session-tool.ts";
import { type Recipient, recipientOf } from "./recipient.ts";

/**
 * How a sign reaches the card's owner: one bus message, or a suite's record of one.
 *
 * A `send` from the caller's own context — the nested tool call inside a tool, the request a
 * command makes — so both doors a sign has tell the owner the same way.
 */
export type Notify = (ctx: ExtensionContext, input: { kind: "event"; to: string; text: string }) => Promise<SendResult>;

/**
 * What a sign's message did, and the line the result carries for it.
 *
 * `done` is the half the card records: an announcement is settled when the bus took the message, or
 * when there was no owner to tell. A send that failed leaves it false, so the sign keeps owing the
 * message and its signer's next attempt is the retry.
 */
export interface Announced {
	/** The clause for the result — who heard, or why nobody did — or nothing with nobody to tell. */
	line?: string;
	/** Whether the announcement is settled: the one fact that stops a sign owing its message. */
	done: boolean;
}

/**
 * What the caller knows about the team, both parts optional.
 *
 * `roster` is the bus's records read as data, which works with `session-bus` unloaded; `now` is
 * the clock the roster's liveness rule is judged on. A caller with neither still sends — the
 * card's own word addresses it, and the bus's answer is the fact reported.
 */
export interface Audience {
	roster?: () => Promise<readonly RosterSession[] | undefined>;
	now?: () => number;
}

/** The production bus, bound to the extension's `pi`: the same message a handoff travels on. */
export function notifyOverBus(pi: Pick<ExtensionAPI, "events" | "getAllTools">): Notify {
	return (ctx, input) => send(pi, ctx, input);
}

/**
 * Tell the card's owner that one of its gates is signed, and say so on the result.
 *
 * A thrown send is caught here for the same reason a refused one is reported: the sign is
 * recorded either way, so the sentence says who did not hear it rather than undoing the write.
 * `by` is the name the sign recorded rather than the actor's label: the owner is being told who
 * signed, and the person's label is a pronoun only their own line prints.
 */
export async function announce(
	card: Card,
	sign: Sign,
	by: string,
	ctx: ExtensionContext,
	notify: Notify,
	audience: Audience = {},
): Promise<Announced> {
	const owner = card.owner;
	// Nobody to tell is settled: there is no message owed, and a repeat sign should not keep asking.
	if (owner === undefined) return { done: true };
	const recipient = recipientOf(owner, await rosterOf(audience), audience.now?.() ?? 0);
	const answer = await notify(ctx, { kind: "event", to: recipient.to, text: signedText(card, sign, by) }).catch(
		(error: unknown) => ({ ok: false as const, error: messageOf(error) }),
	);
	if (!answer.ok) return { line: `  ${notToldLine(recipient.label, answer.error)}`, done: false };
	// The label the bus wrote for, not the one the card kept: a rename between the claim and the
	// sign is exactly the case the roster resolved, and the result should name the peer it reached.
	const told = answer.delivered[0] ?? recipient.label;
	return { line: `  told ${told}${notAudible(recipient)}`, done: true };
}

/**
 * What a contract's "ready to approve" message came to: the clause the result carries, if any.
 *
 * One clause, because unlike a sign there is nothing to record: the round is the durable truth and
 * the card keeps no `told` for a retry to read — so a failed send is a line on this result and the
 * next write that completes a contract asks again.
 */
export interface ReadyNoticed {
	/** Who heard the lead's gate is open, or why nobody did. */
	line?: string;
}

/**
 * Tell `team.lead` that a card's contract became approvable.
 *
 * The one message in the round that travels towards a signature: the peer wrote the wording and
 * cannot sign it, and the lead would otherwise learn it from a board it has no reason to read twice.
 * A board that names no lead sends nothing — there is no gate for a session to open, and the result
 * already tells the peer the person signs.
 *
 * The addressee is resolved the way a sign's is — `recipientOf` over the roster, with the lead's
 * label — so a lead that renamed itself is reached by its live id, and a record whose watch is off
 * reads as `not listening` in the same words the round prints. A label nothing answers keeps the
 * label, which is what lets the bus refuse it in its own sentence.
 */
export async function notifyReady(options: {
	card: Card;
	lead: Lead;
	ctx: ExtensionContext;
	notify: Notify;
	audience?: Audience;
}): Promise<ReadyNoticed> {
	if (options.lead === "") return {};
	const roster = await rosterOf(options.audience ?? {});
	const recipient = recipientOf({ label: options.lead }, roster, options.audience?.now?.() ?? 0);
	const answer = await options
		.notify(options.ctx, { kind: "event", to: recipient.to, text: readyText(options.card, options.lead) })
		.catch((error: unknown) => ({ ok: false as const, error: messageOf(error) }));
	if (!answer.ok) return { line: `  ${notToldLine(recipient.label, answer.error)}` };
	return { line: `  told ${answer.delivered[0] ?? recipient.label}${notAudible(recipient)}` };
}

/**
 * The clause for a peer that will not read the message now: its record aged out, or its watch is off.
 *
 * Which of the two it is, and which outranks which, is `lib/session-roster.ts`'s `peerAlarm`, and the
 * words are `ALARM_REASON`'s — the round prints the same two sentences on its own lines, so a peer
 * cannot be told it is asleep by one surface and quiet by the other.
 */
function notAudible(recipient: Recipient): string {
	const alarm = peerAlarm(recipient);
	if (alarm === undefined) return "";
	return ` (${alarm === "quiet" ? "quiet" : "not listening"}: ${ALARM_REASON[alarm]})`;
}

/** One sign to settle: the message it owes, and the record that settles it. */
export interface SignToSettle {
	/**
	 * The board, asked for after the message.
	 *
	 * A getter rather than a store because resolving one can throw — the command's is a lookup that
	 * can fail — and a sign whose record cannot be written still tells its owner, so the resolve has
	 * to sit inside the same caught step as the write.
	 */
	store: () => Promise<BoardStore>;
	card: Card;
	sign: Sign;
	/** The name the sign recorded, so the owner is told who signed rather than what it is called. */
	by: string;
	/** The actor the record is written as: `announced` compares it with the sign's own mark. */
	actor: Actor;
	ctx: ExtensionContext;
	notify: Notify;
	/** The moment the sign was recorded, passed in because a spot-check's run bounds it. */
	at: number;
	/** What the caller knows of the bus: who to reach, and the clock the clause reads it on. */
	audience?: Audience;
}

/** What settling came to, as parts rather than a sentence: each door keeps its own words. */
export interface SettledSign {
	/** The card as the record left it, when the record landed. */
	card?: Card;
	/** The clause for the result: who heard, or that the record did not land. */
	line?: string;
	/** Why the record could not be written, when the message went and the record did not. */
	error?: string;
}

/**
 * Tell the card's owner a gate was signed, then record that they were told.
 *
 * Both halves of one fact, which is why one body owns them: the message is the half a person acts
 * on, and the record is the retry — a record that did not land says so, because a repeat would
 * otherwise send the same message again. Either half failing is a part of the answer and never a
 * throw: the sign is on the card already, and a door has nowhere to put a stack trace.
 */
export async function settleSign(options: SignToSettle): Promise<SettledSign> {
	const answer = await announce(options.card, options.sign, options.by, options.ctx, options.notify, options.audience);
	if (!answer.done) return { line: answer.line };
	const kept = await options
		.store()
		.then((store) =>
			store.mutate(options.card.id, { kind: "announced", sign: options.sign }, options.actor, options.at),
		)
		.catch((error: unknown) => ({ ok: false as const, error: messageOf(error) }));
	// The clause keeps the message's own indentation: on a result it is one line, not two.
	if (!kept.ok) return { line: `${answer.line ?? ""} (not recorded: ${kept.error})`, error: kept.error };
	return { card: kept.card, line: answer.line };
}

/**
 * The roster a caller offered, or nothing when it cannot answer.
 *
 * The read is a bus directory that may not be there, and it runs after a card was written: a
 * roster that fails costs the two facts it would have added, never the sign or its message.
 */
async function rosterOf(audience: Audience): Promise<readonly RosterSession[] | undefined> {
	if (audience.roster === undefined) return undefined;
	try {
		return await audience.roster();
	} catch {
		return undefined;
	}
}
