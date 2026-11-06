/**
 * The message a sign sends: how `approve` and `review` reach the card's owner.
 *
 * The gate is the lead's and the card is worked by its owner, and neither session reads the
 * other's transcript — so the sign is the fact the owner acts on, and it travels the way a
 * handoff does: an event that waits in the inbox and starts no turn, instead of a board the
 * owner has no reason to read twice.
 *
 * It is sent after the write, so a bus that fails costs a line on the result and never the
 * signature: a refusal here would report an unrecorded sign that the card holds, and the
 * owner's next read would contradict it.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Card } from "../../lib/board/card.ts";
import { type Sign, notToldLine, signedText } from "../../lib/board/lead.ts";
import { messageOf } from "../../lib/errors.ts";
import { type SendResult, send } from "../../lib/session-tool.ts";

/**
 * How a sign reaches the card's owner: one bus message, or a suite's record of one.
 *
 * A `send` from the caller's own context — the nested tool call inside a tool, the request a
 * command makes — so both doors a sign has tell the owner the same way.
 */
export type Notify = (ctx: ExtensionContext, input: { kind: "event"; to: string; text: string }) => Promise<SendResult>;

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
): Promise<string | undefined> {
	const owner = card.owner;
	if (owner === undefined) return undefined;
	const to = owner.id ?? owner.label;
	const answer = await notify(ctx, { kind: "event", to, text: signedText(card, sign, by) }).catch((error: unknown) => ({
		ok: false as const,
		error: messageOf(error),
	}));
	return answer.ok ? `  told ${owner.label}` : `  ${notToldLine(owner.label, answer.error)}`;
}
