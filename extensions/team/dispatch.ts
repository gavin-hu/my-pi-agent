/**
 * The handoff: what `team assign` tells the peer, and how it tells it.
 *
 * The peer is a session that is already running, so this is a message and not a
 * process: `session send` writes it into the recipient's inbox, and its armed watch is
 * what raises the turn. Nothing here starts anything, and a send that fails leaves the
 * card exactly as it was — the order is deliberate, because a card assigned without a
 * message is a card nobody knows about.
 *
 * The transport is a seam (`Dispatch`), so the tool's ordering is testable without a
 * bus, and the one production implementation is `lib/session-tool.ts`'s.
 */

import { randomBytes } from "node:crypto";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { clipText } from "../../lib/format.ts";
import {
	listPeers,
	MAX_MESSAGE_TEXT,
	type DeliveryFailure,
	type Peer,
	send as sendTo,
} from "../../lib/session-tool.ts";

/** How a handoff reaches a peer, and what the bus can say about the peers there are. */
export interface Dispatch {
	/**
	 * Send the text as `kind`, and report what the bus did with it: the labels a message
	 * file was written for, and the peers it could not be written for. Throws only when
	 * nobody got it.
	 */
	send(input: {
		kind: "handoff" | "event" | "ask";
		to: string;
		text: string;
		/** A name for this message: a resend with the same key folds into the copy still waiting. */
		key?: string;
		/** The message or ask id this one answers. */
		replyTo?: string;
		/** What the message is about — a card id, in the workflow's use. */
		about?: string;
	}): Promise<{ delivered: string[]; failed: DeliveryFailure[] }>;
	/**
	 * Every session the bus lists, when it can say.
	 *
	 * Its record is what makes an assignment survive a rename — `holds` compares ids
	 * before labels — and what makes the report able to name a peer that cannot be
	 * woken. It never throws: a resolve that fails must not undo a handoff that landed.
	 */
	peers(): Promise<Peer[] | undefined>;
}

/**
 * What the lead asks when it names no question.
 *
 * One sentence, because `question` is optional and an ask with no text would be a message
 * a peer cannot act on: the round says what a session holds, so what it cannot say is how
 * the work is going.
 */
export const DEFAULT_QUESTION = "how is it going?";

/**
 * What an `ask` says: the question, and the one way back.
 *
 * The reply target is written out because an `ask` is the one kind with no protocol of its
 * own — the bus names the sender, but nothing in the message says a reply is wanted or where
 * it goes — and "nothing is waiting on it" is what keeps a peer from treating it as a
 * handoff. Clipped to the bus's limit like every other body here.
 */
export function askText(question: string, ask: string, reply: ReplyRoute): string {
	// The route says which kind of name it is: a peer that follows a label-shaped example sends to a
	// label and loses exactly what the id is for, and a fallback that reads like an id would be worse.
	const where = reply.byId
		? `"${reply.to}" (a session id, not a label)`
		: `"${reply.to}" (the label — the bus holds no id for this session)`;
	return clipText(
		[
			`Ask ${ask}: ${question}`,
			`Reply with \`session send to ${where} replyTo "${ask}"\` — nothing is waiting on it; the bus prints it as \`re: ${ask}\`.`,
		].join("\n"),
		MAX_MESSAGE_TEXT,
	);
}

/**
 * A short id for one ask, quotable in the reply.
 *
 * Minted here rather than taken from the bus's `messageId`: that one is written into the record when
 * the message is sent, and this id has to be inside the text being sent. Three random bytes is
 * enough for a session's questions, and the prefix keeps it from reading as a session id.
 */
export function askId(): string {
	return `a${randomBytes(3).toString("hex")}`;
}

/**
 * Where a peer's answer goes: the asker's session id when the bus holds one, and its label when the
 * bus cannot say who the asker is.
 *
 * The id is the point — it survives the asker renaming itself or its record being pruned — and
 * `byId` is what lets the sentence name which one a peer was given instead of implying an id.
 */
export interface ReplyRoute {
	/** The string a peer passes to `session send`. */
	to: string;
	/** Whether `to` is a session id rather than a label. */
	byId: boolean;
}

/** The production dispatch: `lib/session-tool.ts`, with a failure turned into a throw. */
export function sessionDispatch(pi: Pick<ExtensionAPI, "events" | "getAllTools">, ctx: ExtensionToolContext): Dispatch {
	return {
		async send(input) {
			const result = await sendTo(pi, ctx, input);
			// `assign` and `offer` branch on a failed send, so this seam reports it the way
			// they read it: the bus's sentence, as the reason the card was not handed over. A
			// send that reached somebody is not a failure — it is a success with a list of the
			// peers it missed, which they print.
			if (!result.ok) throw new Error(result.error);
			return { delivered: result.delivered, failed: result.failed };
		},
		peers: () => listPeers(ctx),
	};
}
