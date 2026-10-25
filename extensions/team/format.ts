/**
 * The model-facing text for one `team` call.
 *
 * A handoff is stated as what happened and what did not: `handed off` names the peer
 * and the card, a failed send says the card is untouched, and an assignment that lost
 * a race after the send says the peer should claim it. Nothing here claims the peer
 * read the message — `delivered` means a message file was written for it.
 */

import { type Card, cardRef } from "../../lib/board/card.ts";

/** `/team join` landed: the label peers address, and whether mail will reach this session. */
export function formatJoined(label: string, watching: { armed: boolean }): string {
	const state = watching.armed ? "listening for handoffs" : "not listening";
	return `team: on the team as ${label}, ${state}.`;
}

/** `/team join` did not land, so nothing about this session changed. */
export function formatNotJoined(reason: string): string {
	return `team: not on the team — ${reason}`;
}

/**
 * A card that was handed over, and the peer that got the message.
 *
 * `notListening` is the one fact the send cannot tell you and the record can: a peer
 * that is not listening reads the handoff at its next turn rather than being woken for
 * it. Saying so is the difference between "delivered" and "delivered and read".
 */
export function formatHandoff(
	card: Card,
	to: string,
	delivered: readonly string[],
	notListening: readonly string[] = [],
): string {
	const who = delivered.length > 0 ? delivered.join(", ") : to;
	return [
		`${cardRef(card.id)} handed off to ${who}.`,
		`  ${card.title}`,
		card.paths.length > 0 ? `  paths: ${card.paths.join(", ")}` : undefined,
		"  The card is already owned by the peer; the handoff is in its inbox.",
		notListeningLine(notListening),
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/**
 * The line that names a peer which will not be woken, or nothing when every peer is
 * listening.
 *
 * One sentence for both verbs: what the mail does instead, and no pronoun, because the
 * list can hold one peer or three.
 */
export function notListeningLine(labels: readonly string[]): string | undefined {
	if (labels.length === 0) return undefined;
	return `  Not listening: ${labels.join(", ")} — it reads this at its next turn.`;
}

/** The send that never landed: the card was not touched. */
export function formatHandoffFailure(card: Card, to: string, reason: string): string {
	return `${cardRef(card.id)} was not handed off to ${to}: ${reason}\n  The card is unchanged.`;
}

/**
 * A card offered to the team: who heard, and that nobody holds it yet.
 *
 * `offer` writes nothing, so the sentence has to say the ownership question is still
 * open — a reader who took "offered" for "assigned" would stop looking at the card.
 */
export function formatOffer(card: Card, delivered: readonly string[], notListening: readonly string[] = []): string {
	const who = delivered.length > 0 ? delivered.join(", ") : "nobody";
	return [
		`${cardRef(card.id)} offered to ${who}.`,
		`  ${card.title}`,
		card.paths.length > 0 ? `  paths: ${card.paths.join(", ")}` : undefined,
		"  The card is unowned until one of them claims it.",
		notListeningLine(notListening),
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/** The broadcast that never landed: no card was touched, and nobody heard. */
export function formatOfferFailure(card: Card, reason: string): string {
	return `${cardRef(card.id)} was not offered: ${reason}\n  The card is unchanged.`;
}

/**
 * The send landed and the assignment then lost a race.
 *
 * The peer has a message telling it the card is its, so the correction names the
 * claim rather than pretending nothing happened.
 */
export function formatRacedAssignment(card: Card, to: string, reason: string): string {
	return (
		`${cardRef(card.id)} was handed off to ${to}, but the card changed before it could be assigned: ${reason}\n` +
		`  ${to} should run \`board\` action \`claim\` with card "${card.id}".`
	);
}

/** A card taken back to To do. */
export function formatReclaimed(card: Card, previous: string): string {
	return `${cardRef(card.id)} reclaimed from ${previous} and back in To do; its notes are kept.\n  ${card.title}`;
}
