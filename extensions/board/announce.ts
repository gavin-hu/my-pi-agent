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
import type { Card } from "../../lib/board/card.ts";
import { type Sign, notToldLine, signedText } from "../../lib/board/lead.ts";
import { messageOf } from "../../lib/errors.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
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
 * The clause for a peer that will not read the message now: its record aged out, or its watch is off.
 *
 * Quiet outranks the watch: a heartbeat past the bus's window says nothing is known to be there, and
 * a watch on a record that may be dead is the weaker fact. Only a record that says its watch is off
 * earns the second clause — an absent fact is not "nobody will read it", the rule `lib/board/view.ts`
 * states for the page's chip.
 */
function notAudible(recipient: Recipient): string {
	if (recipient.state === "quiet") return " (quiet: nothing says it is still there)";
	return recipient.listening === false ? " (not listening: it reads this at its next turn)" : "";
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
