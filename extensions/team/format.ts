/**
 * The model-facing text for one `team` call.
 *
 * A handoff is stated as what happened and what did not: `handed off` names the peer
 * and the card, a failed send says the card is untouched, and an assignment that lost
 * a race after the send says the peer should claim it. Nothing here claims the peer
 * read the message — `delivered` means a message file was written for it.
 */

import { type Card, cardRef } from "../../lib/board/card.ts";

/** A card that was handed over, and the peer that got the message. */
export function formatHandoff(card: Card, to: string, delivered: readonly string[]): string {
	const who = delivered.length > 0 ? delivered.join(", ") : to;
	return [
		`${cardRef(card.id)} handed off to ${who}.`,
		`  ${card.title}`,
		card.paths.length > 0 ? `  paths: ${card.paths.join(", ")}` : undefined,
		"  The card is already owned by the peer; the handoff is in its inbox.",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/** The send that never landed: the card was not touched. */
export function formatHandoffFailure(card: Card, to: string, reason: string): string {
	return `${cardRef(card.id)} was not handed off to ${to}: ${reason}\n  The card is unchanged.`;
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
