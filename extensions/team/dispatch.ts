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
import type { Card } from "../../lib/board/card.ts";
import { cardRef, type CardOwner } from "../../lib/board/card.ts";
import type { Handoff } from "../../lib/board/contract.ts";
import type { Lead } from "../../lib/board/lead.ts";
import { askLead, leadName } from "../../lib/board/contract.ts";
import type { Actor } from "../../lib/board/rules.ts";
import { clipText } from "../../lib/format.ts";
import {
	listPeers,
	MAX_MESSAGE_TEXT,
	type DeliveryFailure,
	type Peer,
	send as sendTo,
} from "../../lib/session-tool.ts";
import { type PeerAlarm, peerAlarm, peerNamed } from "../../lib/session-roster.ts";

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
 * What the peer reads.
 *
 * It names the card and its outcome, says what to do next — record the plan, work, note,
 * and which moves are the peer's own — and then the paths it needs. The instruction comes
 * before the paths because the paths are the only line that can run past the bus's limit,
 * and a clipped message must not lose the step it was sent to give. It does **not** ask
 * the peer to claim the card — `assign` has already recorded the owner, and a claim by the
 * holder is a no-op. The claim is the failure path's own step.
 *
 * That failure path is the hedge closing the instruction block, and it is there rather than in
 * a second message because the message is sent before the write: the card can end up somebody
 * else's, or nobody's, and the only correction that cannot itself be lost is one the peer
 * already holds. So the line names both outcomes — leave a rival's card alone, claim a card
 * nobody holds — because a peer told only about the rival would write its contract against a
 * card the store refuses it. A handoff that landed satisfies neither condition and is
 * unchanged by it.
 */
export function handoffText(card: Card, to: string, lead: Lead, note?: string): string {
	const lines = [
		`Handoff: ${cardRef(card.id)} "${card.title}" is yours, ${to}.`,
		`It is already assigned to you — write its contract with board action "contract" if it has none, then note each phase.`,
		signatureLine(lead),
		`If the board shows another owner, the write lost a race: leave it alone and ${askLead(lead)}; if it shows nobody, claim it with board action "claim" before its contract.`,
		card.paths.length > 0 ? `Paths: ${card.paths.join(", ")}` : undefined,
		card.planPath === undefined ? undefined : `Plan: ${card.planPath}`,
		note === undefined ? undefined : `Note: ${note}`,
	].filter((line): line is string => line !== undefined);
	return clipText(lines.join("\n"), MAX_MESSAGE_TEXT);
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
			`Reply with \`session send to ${where}\`, starting your message with \`re: ${ask}\` — nothing is waiting on it.`,
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

/**
 * What every live session reads when the lead offers a card instead of assigning it.
 *
 * An offer names no owner: the first peer to claim the card takes it, so the text says
 * what the card is and that claiming is the next step, and it never implies the work is
 * already somebody's. The claim and the two gates come before the paths, for the reason
 * `handoffText` does: the step is what the message is for.
 */
export function offerText(card: Card, lead: Lead, note?: string): string {
	const lines = [
		`Offer: ${cardRef(card.id)} "${card.title}" is unclaimed.`,
		`First to claim it takes it: run board action "claim" with card "${card.id}", then write its contract and note each phase.`,
		signatureLine(lead),
		card.paths.length > 0 ? `Paths: ${card.paths.join(", ")}` : undefined,
		card.planPath === undefined ? undefined : `Plan: ${card.planPath}`,
		note === undefined ? undefined : `Note: ${note}`,
	].filter((line): line is string => line !== undefined);
	return clipText(lines.join("\n"), MAX_MESSAGE_TEXT);
}

/**
 * The moves a card has left, and which of them the peer may make itself.
 *
 * Both gates are the lead's signature — `lib/board/steps.ts` refuses `plan`→`execute`
 * without `approve` and `done` without `review`, and refuses a signer who holds the card —
 * so a message that said "move it to execute, blocked, or done" handed the peer an
 * instruction its own next call would refuse. The name is the configured lead, which is the
 * one a sign has to carry, and the way to ask it is `askLead` — `lib/board/sign-words.ts`'s one
 * phrase for the channel, printed here and in the two refusals a peer reads.
 */
function signatureLine(lead: Lead): string {
	return `Its three moves: \`blocked\` is yours to set; \`execute\` needs the lead (${leadName(lead)}) to \`approve\` the contract, and \`done\` needs the lead's \`review\` — ${askLead(lead)} when each is ready.`;
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

/**
 * The labels a message reached that cannot be woken: their record says they are not
 * listening.
 *
 * A label the bus could not answer for is left out — "the record does not say" is not
 * "nobody will read it" — and so is a peer the bus lists as listening. A quiet peer is left to
 * {@link quiet}: its watch is a fact about a session nothing says is still running, so the louder
 * sentence is the honest one.
 */
export function notListening(peers: readonly Peer[] | undefined, labels: readonly string[]): string[] {
	return alarmed(peers, labels, "not-listening");
}

/**
 * The labels whose session has gone quiet: the message waits on a heartbeat that aged out.
 *
 * The bus still wrote the file, so the send is not a failure — but saying "delivered" alone reads
 * as heard, and this is the fact that says nobody is known to be there to read it.
 */
export function quiet(peers: readonly Peer[] | undefined, labels: readonly string[]): string[] {
	return alarmed(peers, labels, "quiet");
}

/**
 * The labels the bus can answer for, whose record carries `alarm`.
 *
 * Which alarm a record carries, and which one wins, is `lib/session-roster.ts`'s: these two lists
 * are the same question asked of one sentence, and answering it here as well is how the two
 * surfaces came to word one peer twice.
 */
function alarmed(peers: readonly Peer[] | undefined, labels: readonly string[], alarm: PeerAlarm): string[] {
	if (peers === undefined) return [];
	return labels.filter((label) => {
		const peer = peerNamed(peers, label);
		return peer !== undefined && peerAlarm(peer) === alarm;
	});
}

/**
 * The actor a handoff names: the peer the bus lists, else the label that was asked for.
 *
 * `team assign` checks the card against this before it sends anything and records the same
 * actor afterwards, so the check and the write cannot disagree about who `to` is. That is
 * what makes an id the holder: a card records the id the bus gave it, `holds` compares ids
 * first, and only the resolved actor carries one.
 *
 * An id keeps its meaning — a caller that names a session gets that session, stopped or not, and
 * the send is what refuses it. A label names only the one session nothing else answers to: where
 * two live sessions share it, this answers nothing and the card records the label as unresolved,
 * so a message is never credited to the session that did not get it. The read's own age is the
 * caller's business rather than this function's — `assign` asks before its dry run and again after
 * the message, so the owner it records is the peer the message reached.
 */
export function actorFor(peers: readonly Peer[] | undefined, to: string): Actor {
	const peer = peerNamed(peers, to);
	return peer === undefined ? { label: to.trim() } : { id: peer.id, label: peer.label };
}

/**
 * The peer a handoff names, as the card records it when the bus cannot say who that is: the label a
 * message file was written for, else the one that was asked for, and `unresolved` on the handoff.
 *
 * The marker is the point. Without it the record would be a label alone, and `holds` falls back to
 * comparing labels — so the next session to draw that label would inherit every write on the card.
 * With it the record still names where mail goes, and authorises nothing.
 */
export function ownerFor(to: string, delivered: readonly string[], handoff: Handoff): CardOwner {
	const label = delivered[0] ?? to;
	return { label, handoff: { ...handoff, unresolved: true } };
}
