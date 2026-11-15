/**
 * The workflow's notices: what each transition tells the session that must act on it.
 *
 * One table, one record per row, so a transition's sentence, its audience, its key and the field
 * that settles it have one home. The doors — `board` and `team` — write the card and then hand the
 * notice to their transport; nothing else builds workflow mail, and nothing here knows the bus
 * beyond the kind it writes with.
 *
 * Six rows, because six transitions say something. Three are *owed* — a handoff, an approval and a
 * spot-check have a field on the card that records the message landed — and their `told` half is
 * what makes a repeat a retry. `ready`, `offer` and `reclaim` carry none: they are sent once and
 * never counted as unheard, because the card has nowhere to say they were heard.
 *
 * Pure: no clock (the caller passes the moment), no files, and no extension.
 */

import { clipText } from "../format.ts";
import type { MessageKind } from "../session-mail.ts";
import { MAX_MESSAGE_TEXT } from "../session-tool.ts";
import { type Card, type CardOwner, cardRef } from "./card.ts";
import { askLead, type Handoff, leadName, SIGN_WORDS } from "./contract.ts";
import { type Lead, type Sign } from "./lead.ts";
import { TELL_FIELDS } from "./contract.ts";
import { type PeerRow, peerNamed } from "../session-roster.ts";
import type { Actor } from "./rules.ts";

/** One transition a notice is composed for. */
export type NoticeKind = "assign" | "ready" | "offer" | "approve" | "review" | "reclaim";

/**
 * Who a notice is for, as a role rather than a session.
 *
 * Resolving a role to a label is the door's business, where the roster is read: the domain must
 * not grow a transport. `others` is the one that resolves to a broadcast.
 */
export type NoticeAudience = "owner" | "lead" | "others" | "former-owner";

/** What one row's sentence needs beyond the card. */
export interface NoticeContext {
	/** The board's lead, named in a sentence and addressed by the `ready` row. */
	lead: Lead;
	/** The signer's name, for a sign; the session that took the card, for a reclaim. */
	by?: string;
	/** The label a handoff hands the card to. */
	to?: string;
	/** The handoff's or offer's note. */
	note?: string;
}

/**
 * One row of the table.
 *
 * `told` is the row's half of "the message landed": absent means the notice is never owed twice.
 * Present, `read` says whether the card records it and `patch` is the write that records one — so
 * `announced` settles whatever the row says without a switch of its own.
 */
export interface Notice {
	kind: MessageKind;
	audience: NoticeAudience;
	key: (card: Card) => string;
	told?: {
		read: (card: Card) => { at: number } | undefined;
		patch: (card: Card, at: number) => Partial<Card>;
	};
	text: (card: Card, context: NoticeContext) => string;
}

/**
 * The moment a notice's key names: the durable one for that transition — a handoff's own stamp, an
 * offer's timestamp, a sign's — never the card's `updatedAt`, which any later note moves. A retry
 * after a note is therefore the same key, and the bus folds it into the copy still waiting.
 */
function noticeKey(card: Card, notice: NoticeKind, at: number | undefined): string {
	return `card:${card.id}:${notice}:${at ?? card.updatedAt}`;
}

/** The six rows: three with a told half, and three sent once. */
export const NOTICES: Record<NoticeKind, Notice> = {
	assign: {
		kind: "handoff",
		audience: "owner",
		key: (card) => noticeKey(card, "assign", card.owner?.handoff?.at),
		told: TELL_FIELDS.assign,
		text: (card, context) => handoffText(card, context.to ?? "the peer", context.lead, context.note),
	},
	ready: {
		kind: "event",
		audience: "lead",
		key: (card) => noticeKey(card, "ready", card.updatedAt),
		text: (card, context) => readyText(card, context.lead),
	},
	offer: {
		kind: "event",
		audience: "others",
		key: (card) => noticeKey(card, "offer", card.offeredAt),
		text: (card, context) => offerText(card, context.lead, context.note),
	},
	approve: {
		kind: "event",
		audience: "owner",
		key: (card) => noticeKey(card, "approve", card.contract?.approved?.at),
		told: TELL_FIELDS.approve,
		text: (card, context) => signedText(card, "approve", context.by ?? context.lead),
	},
	review: {
		kind: "event",
		audience: "owner",
		key: (card) => noticeKey(card, "review", card.review?.at),
		told: TELL_FIELDS.review,
		text: (card, context) => signedText(card, "review", context.by ?? context.lead),
	},
	reclaim: {
		kind: "event",
		audience: "former-owner",
		key: (card) => noticeKey(card, "reclaim", card.updatedAt),
		text: (card, context) => reclaimText(card, context.by ?? context.lead, context.lead),
	},
};

/** One notice, composed: what the door sends, with the key and the text already resolved. */
export interface Composed {
	kind: MessageKind;
	audience: NoticeAudience;
	key: string;
	text: string;
}

/** Compose one row for one card. */
export function composeNotice(kind: NoticeKind, card: Card, context: NoticeContext): Composed {
	const row = NOTICES[kind];
	return {
		kind: row.kind,
		audience: row.audience,
		key: row.key(card),
		text: clipText(row.text(card, context), MAX_MESSAGE_TEXT),
	};
}

/** One row's text, without composing a delivery: the doors that only need the words. */
export function noticeText(kind: NoticeKind, card: Card, context: NoticeContext): string {
	return clipText(NOTICES[kind].text(card, context), MAX_MESSAGE_TEXT);
}

/**
 * What the peer reads when a card is handed to it.
 *
 * The card is written before this message exists, so the peer is the owner by the time it reads.
 * One condition survives, because a reclaim can land between the write and the read.
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
	return lines.join("\n");
}

/** What a contract that just became approvable sends the lead: the card, and the two doors a sign has. */
export function readyText(card: Card, lead: Lead): string {
	return (
		`Contract ready: #${card.id} "${card.title}" — its four lines are whole and nothing is signed.\n` +
		`Next: the lead (${leadName(lead)}) approves with board action "approve", or the person with \`/board approve ${card.id}\`.`
	);
}

/** What a sign sends the card's owner: who signed, and the move it unlocked. */
export function signedText(card: Card, sign: Sign, by: string): string {
	return SIGN_WORDS[sign].signed(card, by);
}

/**
 * What a reclaim sends the session that held the card.
 *
 * The transition takes work away from somebody, so its sentence says what happened and that the
 * card is not theirs to move any more. It names who took it back, because the owner's next move is
 * to ask that session, not to retry the write the card will refuse.
 */
export function reclaimText(card: Card, by: string, lead: Lead): string {
	return [
		`Taken back: ${cardRef(card.id)} "${card.title}" was reclaimed by ${by}, and is back in the pool.`,
		`It is nobody's now: ${askLead(lead)} if you had work in it that the lead should see.`,
	].join("\n");
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

/** The moves a card has left, and which of them the peer may make itself. */
function signatureLine(lead: Lead): string {
	return `Its three moves: \`blocked\` is yours to set; \`execute\` needs the lead (${leadName(lead)}) to \`approve\` the contract, and \`done\` needs the lead's \`review\` — ${askLead(lead)} when each is ready.`;
}

/** The actor a handoff names: the peer the bus lists, else the label that was asked for. */
export function actorFor(peers: readonly PeerRow[] | undefined, to: string): Actor {
	const peer = peerNamed(peers, to);
	return peer === undefined ? { label: to.trim() } : { id: peer.id, label: peer.label };
}

/**
 * The peer a handoff names, as the card records it when the bus cannot say who that is: the label a
 * message file was written for, and `unresolved` on the handoff, which withdraws authority.
 */
export function ownerFor(to: string, delivered: readonly string[], handoff: Handoff): CardOwner {
	const label = delivered[0] ?? to;
	return { label, handoff: { ...handoff, unresolved: true } };
}
