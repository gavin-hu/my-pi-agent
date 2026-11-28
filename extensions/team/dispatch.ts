/**
 * The one thing `team` says that no card transition does: the ask, and where its answer goes.
 *
 * The transport is `lib/session-tool.ts`'s `Deliver`, so a suite fakes one seam for both verbs
 * and the tool's ordering is testable without a bus.
 */

import { randomBytes } from "node:crypto";
import { clipText } from "../../lib/format.ts";
import { MAX_MESSAGE_TEXT } from "../../lib/session-mail.ts";

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
