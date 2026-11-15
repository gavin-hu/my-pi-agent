/**
 * The workflow's notices: what each transition tells the session that must act on it.
 *
 * One table, so a transition's sentence has one home. The doors — `board` and `team` — write the
 * card and then deliver the notice this module composes; nothing else builds workflow mail, and
 * nothing here knows the bus: a notice is `{kind, audience, key, text}`, and the door that owns
 * the context turns it into one send.
 *
 * The five transitions are the ones whose move changed hands: a handoff, a contract that became
 * approvable, the two signs, and a reclaim. An offer is not one of them — it changes nothing on
 * the card but `offeredAt` — so its text lives here while its message is still `team`'s.
 *
 * Pure: no clock (the caller passes the moment), no files, and no extension.
 */

import { clipText } from "../format.ts";
import { MAX_MESSAGE_TEXT } from "../session-tool.ts";
import { type Card, type CardOwner, cardRef } from "./card.ts";
import { askLead, type Handoff, leadName, SIGN_WORDS } from "./contract.ts";
import { type PeerRow, peerNamed } from "../session-roster.ts";
import type { Actor } from "./rules.ts";
import type { Lead, Sign } from "./lead.ts";
import type { Card as CardRecord } from "./card.ts";

/**
 * The notices a card's own record can settle: the handoff that made an owner, and the two signs.
 *
 * One list, because recording that a notice landed is one operation whichever field it writes —
 * `contract.approved.told`, `review.told`, or `owner.handoff.told`.
 */
export type NoticeField = Sign | "assign";

/** One transition a notice is owed for. */
export type NoticeKind = "assign" | "ready" | "approve" | "review" | "reclaim";

/** Who the notice is for: the card's owner, or the lead. */
export type NoticeAudience = "owner" | "lead";

/**
 * One message a transition owes.
 *
 * `key` is part of the notice rather than the door's business: two attempts at the same
 * transition must fold into one message, and the bus's fold is keyed. `text` is clipped to the
 * bus's limit here, because every body this module builds is one the bus will refuse if longer.
 */
export interface Notice {
	/** What the bus writes: a handoff hands over work, everything else is an event. */
	kind: "handoff" | "event";
	audience: NoticeAudience;
	/** The name a retry repeats, so the copy still waiting is the one it folds into. */
	key: string;
	text: string;
}

/** What one notice needs to be composed. */
export interface NoticeInput {
	card: Card;
	lead: Lead;
	/** The signer's name, for a sign; the session that took the card, for a reclaim. */
	by?: string;
	/** The label a handoff hands the card to. */
	to?: string;
	/** The handoff's note. */
	note?: string;
	/** When the write that owes it was made — the key's durable half. */
	at: number;
}

/** One notice, clipped to what the bus will take. */
export function noticeFor(kind: NoticeKind, input: NoticeInput): Notice {
	const { card, lead, at } = input;
	const key = `${kind}:${card.id}:${at}`;
	switch (kind) {
		case "assign":
			return {
				kind: "handoff",
				audience: "owner",
				key,
				text: handoffText(card, input.to ?? "the peer", lead, input.note),
			};
		case "ready":
			return { kind: "event", audience: "lead", key, text: readyText(card, lead) };
		case "approve":
			return {
				kind: "event",
				audience: "owner",
				key,
				text: signedText(card, "approve", input.by ?? lead),
			};
		case "review":
			return {
				kind: "event",
				audience: "owner",
				key,
				text: signedText(card, "review", input.by ?? lead),
			};
		case "reclaim":
			return {
				kind: "event",
				audience: "owner",
				key,
				text: reclaimText(card, input.by ?? lead, lead),
			};
	}
}

/** Whether the owner still has not heard the handoff that made it one. */
export function owesHandoff(card: CardRecord): boolean {
	const handoff = card.owner?.handoff;
	return handoff !== undefined && handoff.told === undefined;
}

/**
 * What the peer reads when a card is handed to it.
 *
 * The card is written before this message exists, so the peer is the owner by the time it reads
 * — the old two-branch hedge ("another owner, or nobody: claim it") described a race the order no
 * longer has. One condition survives, because a reclaim can land between the write and the read,
 * and a peer acting on a card it no longer holds is the failure worth a sentence.
 */
export function handoffText(card: Card, to: string, lead: Lead, note?: string): string {
	const lines = [
		`Handoff: ${cardRef(card.id)} "${card.title}" is yours, ${to}.`,
		`Write its contract with board action "contract" if it has none, then note each phase.`,
		signatureLine(lead),
		`If the board shows another owner, it was taken back after this message: leave it alone and ${askLead(lead)}.`,
		card.paths.length > 0 ? `Paths: ${card.paths.join(", ")}` : undefined,
		card.planPath === undefined ? undefined : `Plan: ${card.planPath}`,
		note === undefined ? undefined : `Note: ${note}`,
	].filter((line): line is string => line !== undefined);
	return clipText(lines.join("\n"), MAX_MESSAGE_TEXT);
}

/**
 * What a contract that just became approvable sends the lead: the card, and the two doors a sign has.
 *
 * The peer that wrote the wording is the only session that knows it is ready, and the gate is the
 * lead's — so this is the one message in the round that travels towards a signature rather than away
 * from one. It names the card's id because that is what the next call takes, and it is worded like
 * the refusals that ask for the same sign, so one gate is not described two ways.
 */
export function readyText(card: Card, lead: Lead): string {
	return clipText(
		`Contract ready: #${card.id} "${card.title}" — its four lines are whole and nothing is signed.\n` +
			`Next: the lead (${leadName(lead)}) approves with board action "approve", or the person with \`/board approve ${card.id}\`.`,
		MAX_MESSAGE_TEXT,
	);
}

/** What a sign sends the card's owner: who signed, and the move it unlocked. */
export function signedText(card: Card, sign: Sign, by: string): string {
	return clipText(SIGN_WORDS[sign].signed(card, by), MAX_MESSAGE_TEXT);
}

/**
 * What a reclaim sends the session that held the card.
 *
 * The transition takes work away from somebody, so its sentence says what happened and that the
 * card is not theirs to move any more. It names who took it back, because the owner's next move
 * is to ask that session — not to retry the write the card will refuse.
 */
export function reclaimText(card: Card, by: string, lead: Lead): string {
	return clipText(
		[
			`Taken back: ${cardRef(card.id)} "${card.title}" was reclaimed by ${by}, and is back in the pool.`,
			`It is nobody's now: ${askLead(lead)} if you had work in it that the lead should see.`,
		].join("\n"),
		MAX_MESSAGE_TEXT,
	);
}

/** What every live session reads when the lead offers a card instead of assigning it. */
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
export function actorFor(peers: readonly PeerRow[] | undefined, to: string): Actor {
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

/**
 * The moves a card has left, and which of them the peer may make itself.
 *
 * Both gates are the lead's signature — `lib/workflow/steps.ts` refuses `plan`→`execute` without
 * `approve` and `done` without `review`, and refuses a signer who holds the card — so a message
 * that said "move it to execute, blocked, or done" handed the peer an instruction its own next
 * call would refuse. The name is the configured lead, which is the one a sign has to carry.
 */
function signatureLine(lead: Lead): string {
	return `Its three moves: \`blocked\` is yours to set; \`execute\` needs the lead (${leadName(lead)}) to \`approve\` the contract, and \`done\` needs the lead's \`review\` — ${askLead(lead)} when each is ready.`;
}
