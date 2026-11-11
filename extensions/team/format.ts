/**
 * The model-facing text for one `team` call.
 *
 * A handoff is stated as what happened and what did not: `handed off` names the peer
 * and the card, a failed send says the card is untouched, and an assignment that lost
 * a race after the send says the peer should claim it. Nothing here claims the peer
 * read the message — `delivered` means a message file was written for it.
 */

import { type Card, cardRef } from "../../lib/board/card.ts";
import { type DeliveryFailure, notDeliveredLine } from "../../lib/session-tool.ts";
import type { TeamAction } from "./types.ts";

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
	quiet: readonly string[] = [],
	failed: readonly DeliveryFailure[] = [],
): string {
	const who = delivered.length > 0 ? delivered.join(", ") : to;
	return [
		`${cardRef(card.id)} handed off to ${who}.`,
		`  ${card.title}`,
		card.paths.length > 0 ? `  paths: ${card.paths.join(", ")}` : undefined,
		"  The card is already owned by the peer; the handoff is in its inbox.",
		notListeningLine(notListening),
		quietLine(quiet),
		indent(notDeliveredLine(failed)),
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

/**
 * The line that names a peer whose record aged out, or nothing when none did.
 *
 * The other half of `notListeningLine`, and the reason both exist: the bus wrote a message file
 * either way, so `delivered` alone reads as heard — while a quiet record says nothing is known to be
 * there to read it.
 */
export function quietLine(labels: readonly string[]): string | undefined {
	if (labels.length === 0) return undefined;
	return `  Quiet: ${labels.join(", ")} — nothing says it is still there.`;
}

/** A continuation line, when a shared sentence has one to add. */
function indent(line: string | undefined): string | undefined {
	return line === undefined ? undefined : `  ${line}`;
}

/**
 * A question sent: who has it, and where the answer will arrive.
 *
 * No card is named, because an ask touches none — the reader's next question is whether it
 * landed, so the line leads with the peer and then says the one thing a send cannot: that
 * nothing is waiting on an answer.
 */
export function formatAsk(
	ask: string,
	delivered: readonly string[],
	notListening: readonly string[] = [],
	quiet: readonly string[] = [],
	to = "",
	failed: readonly DeliveryFailure[] = [],
): string {
	const who = delivered.length > 0 ? delivered.join(", ") : to === "" ? "nobody" : to;
	return [
		`Asked ${who} — ask ${ask}.`,
		`  The answer arrives as mail; reply with \`re: ${ask}\`, and nothing is waiting on it.`,
		notListeningLine(notListening),
		quietLine(quiet),
		indent(notDeliveredLine(failed)),
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/** The send that never landed: the card was not touched. */
export function formatHandoffFailure(card: Card, to: string, reason: string): string {
	return `${cardRef(card.id)} was not handed off to ${to}: ${reason}\n  The card is unchanged.`;
}

/**
 * A handoff or a question the join stopped before it was sent.
 *
 * `assign` and `ask` join first because the message names this session as the way back, so a
 * session the bus will not hold is a reply the peer's `session send` refuses. That makes this a
 * failure of the call rather than of the card, and the sentence says nothing reached anybody.
 *
 * The remedy is the join's own (`TeamState.fix`), not guessed here: the door a reader reaches
 * for by habit is `/team join`, which is the wrong one when no bus is loaded at all and a
 * one-way door for a lead, whose signature is the label the gates compare.
 */
export function formatNotSent(subject: string, state: { error: string; fix?: string }): string {
	const fix = state.fix === undefined ? "" : ` ${state.fix}`;
	return `${subject}: this session is not on the team — ${state.error}\n  Nothing was sent.${fix}`;
}

/**
 * A card offered to the team: who heard, and that nobody holds it yet.
 *
 * `offer` records the moment and no ownership, so the sentence has to say the ownership
 * question is still open — a reader who took "offered" for "assigned" would stop looking
 * at the card.
 */
export function formatOffer(
	card: Card,
	delivered: readonly string[],
	notListening: readonly string[] = [],
	quiet: readonly string[] = [],
	failed: readonly DeliveryFailure[] = [],
): string {
	const who = delivered.length > 0 ? delivered.join(", ") : "nobody";
	return [
		`${cardRef(card.id)} offered to ${who}.`,
		`  ${card.title}`,
		card.paths.length > 0 ? `  paths: ${card.paths.join(", ")}` : undefined,
		"  The card is unowned until one of them claims it.",
		notListeningLine(notListening),
		quietLine(quiet),
		indent(notDeliveredLine(failed)),
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/** The broadcast that never landed: no card was touched, and nobody heard. */
export function formatOfferFailure(card: Card, reason: string): string {
	return `${cardRef(card.id)} was not offered: ${reason}\n  The card is unchanged.`;
}

/**
 * The broadcast landed and recording the offer was then refused.
 *
 * The peers have an event and the board would not take the record, so the correction says
 * the offer stands as a message and the card is what the board now says — not that nothing
 * happened. It names the refusal and not its cause: a write can lose to another session's
 * write on the card *or* to another session holding the board, and only the store's own
 * sentence can say which. No second message follows it: an offer's only next step is a
 * claim, and a claim for a card somebody holds is refused naming the holder, so the stale
 * text cannot send a peer anywhere the store will not correct it.
 */
export function formatRacedOffer(card: Card, reason: string): string {
	return (
		`${cardRef(card.id)} was offered, but recording the offer was refused: ${reason}\n` +
		"  The peers have the message; the card is as the board shows it now."
	);
}

/**
 * The broadcast landed and recording the offer then threw.
 *
 * The one failure where a card is not unchanged and no rule refused it: the peers have an
 * event, and the store's own write threw half way — so what it answers is read afresh rather
 * than guessed at, and the lead is sent to the card before acting again. A bare reason read
 * as "nothing happened", and the retry it invited broadcast the same offer a second time.
 */
export function formatUnrecordedOffer(card: Card, reason: string): string {
	return (
		`${cardRef(card.id)} was offered, but recording the offer failed: ${reason}\n` +
		"  The peers have the message; read the card with `board` action `list` before offering it again."
	);
}

/**
 * The send landed and recording the owner was then refused.
 *
 * The peer has a message telling it the card is its, so the correction names the claim rather
 * than pretending nothing happened — and the claim is right either way: a card another session
 * took refuses it naming the holder, while a card left unowned because the board was busy is
 * the card the lead meant to hand over. The sentence states the refusal and lets the store's
 * own words say why, rather than asserting a cause it cannot see.
 */
export function formatRacedAssignment(card: Card, to: string, reason: string): string {
	return (
		`${cardRef(card.id)} was handed off to ${to}, but recording the owner was refused: ${reason}\n` +
		`  ${to} should run \`board\` action \`claim\` with card "${card.id}".`
	);
}

/**
 * The handoff landed and the assignment's write then threw.
 *
 * The peer holds a message saying the card is its, and the store threw somewhere in the
 * write it asked for — before or after the file landed, which only a read can say. So this
 * is the one failure whose card is not "unchanged": the sentence names the send, gives the
 * store's reason, and sends the lead to the card before assigning it again. The bare reason
 * this replaces read as "nothing happened", and the retry it invited was refused as held —
 * by a peer that had been told the card was already its.
 */
export function formatUnrecordedAssignment(card: Card, to: string, reason: string): string {
	return (
		`${cardRef(card.id)} was handed off to ${to}, but recording the owner failed: ${reason}\n` +
		`  ${to} has the message; read the card with \`board\` action \`list\` before assigning it again.`
	);
}

/**
 * A card taken back to the pool.
 *
 * `held` is what the crossing could not free: a release names its caller, so the old holder's own
 * path claims stay until that session stops, and the new owner's next claim is refused over them.
 * The clause is `lib/board/claims.ts`'s, so the board's door prints the same words.
 */
export function formatReclaimed(card: Card, previous: string, held?: string): string {
	return [
		`${cardRef(card.id)} reclaimed from ${previous} and back in Backlog; its notes are kept.`,
		`  ${card.title}`,
		held === undefined ? undefined : `  ${held}`,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/**
 * A card the lead took itself.
 *
 * The next step is the board's, so it is named: a claim is the one round action that
 * leaves a card in `plan` waiting on its owner, and a line that stopped at "yours" would
 * leave the lead holding a card nobody said what to do with.
 *
 * `team` is the clause `lib/board/join.ts` writes when the claim's own join did not land: the
 * card is the session's either way, so that failure is a line here rather than an error.
 */
export function formatClaimed(card: Card, team?: string): string {
	return [
		`${cardRef(card.id)} is yours, in plan.`,
		`  ${card.title}`,
		"  next: design it in plan mode, `plan` action `write`, then `board` action `contract`",
		team === undefined ? undefined : `  ${team}`,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/**
 * What a running call is doing, in the verb's own words.
 *
 * A partial result carries no details, so this line is all a human has while the call works:
 * the verb says what the wait is — the bus for `assign`, `offer`, and `ask`, the store for
 * `claim` and `reclaim` — because the card's summary cannot until the call settles.
 */
const WORKING: Record<TeamAction, string> = {
	assign: "Handing over…",
	offer: "Offering…",
	reclaim: "Reclaiming…",
	claim: "Claiming…",
	ask: "Asking…",
};

export function formatWorking(action: TeamAction): string {
	return WORKING[action];
}
