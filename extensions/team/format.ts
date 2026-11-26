/**
 * The model-facing text for one `team` call.
 *
 * A handoff is stated as what happened and what did not: `handed off` names the peer
 * and the card, a failed send says the card is untouched, and an assignment that lost
 * a race after the send says the peer should claim it. Nothing here claims the peer
 * read the message — `delivered` means a message file was written for it.
 */

import { type Card, cardRef } from "../../lib/workflow/card.ts";
import type { AddTeammateResult } from "../../lib/workflow/config.ts";
import { teamPhrase } from "../../lib/workflow/round-text.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { ALARM_REASON } from "../../lib/session-roster.ts";
import { type DeliveryFailure, notDeliveredLine } from "../../lib/session-tool.ts";
import type { TeamAction } from "./types.ts";

/**
 * A list of peers as a line prints it.
 *
 * A label is another session's text, like a message body or a path: it is sanitized where a sentence
 * is built, not left to the renderer, because the model reads these lines as well. `notDeliveredLine`
 * does the same to the failures beside them, so the two halves of one result cannot disagree about
 * what a peer's name is allowed to contain.
 */
function namesOf(labels: readonly string[]): string {
	return labels.map(sanitizeLine).join(", ");
}

/**
 * `/team join` landed: the label peers address, whether mail will reach this session, and what the
 * bar will draw for the name it just took.
 */
export function formatJoined(label: string, watching: { armed: boolean }, note?: string): string {
	const line = `team: ${teamPhrase({ label, listening: watching.armed })}.`;
	return note === undefined ? line : `${line} ${note}`;
}

/** `/team join` did not land, so nothing about this session changed. */
export function formatNotJoined(reason: string): string {
	return `team: not on the team — ${reason}`;
}

/**
 * What `/team exit` gave up: the name it was addressed by, and the claims that went back.
 *
 * The label is said to be free, because that is the fact a session comes back for: nothing else on
 * the bus holds the name it just left.
 */
export function formatLeft(label: string, released: readonly string[]): string {
	const line = `team: ${sanitizeLine(label)} is off the team — its record is gone and the label is free.`;
	return released.length === 0 ? line : `${line} Released: ${namesOf(released)}.`;
}

/** `/team exit` did not land, and the bus's own sentence says why. */
export function formatNotLeft(reason: string): string {
	return `team: still on the team — ${sanitizeLine(reason)}`;
}

/**
 * What still holds a session on the team, and the door that would free it.
 *
 * A pair rather than a sentence because `formatStillOn` joins the reasons into one head and prints
 * the doors under it: a reader who leaves twice with the same card is owed the verb, not the
 * reasoning that led to it.
 */
export interface LeaveBlocker {
	/** The fact, as the head sentence joins it: `#935 execute is yours`. */
	reason: string;
	/** The verb that frees it, with the one clause a reader needs beside it. */
	door: string;
}

/** `/team exit` refused: the session is still on the team, and each door under it says why not. */
export function formatStillOn(blockers: readonly LeaveBlocker[]): string {
	const head = `team: still on the team — ${blockers.map((blocker) => blocker.reason).join(" and ")}.`;
	return [head, ...blockers.map((blocker) => `  ${blocker.door}`)].join("\n");
}

/**
 * What the join line says after the name: the bar's verdict on a typed label, else where a bare
 * join's name came from.
 *
 * One function because a join makes at most one of the two facts — a typed label is the one door that
 * writes the team, a picked one is read from it — and a line saying both would be about a change the
 * reader did not make and a choice they did not make either. Nothing when the team already held a
 * typed name: the bar names the session either way, and a second sentence would be about a change
 * that did not happen.
 */
export function joinNote(named: AddTeammateResult | undefined, picked: string | undefined): string | undefined {
	if (named !== undefined) {
		if (!named.ok) return `The bar will not name you: ${named.reason}.`;
		return named.changed ? "team.teammates now holds it, so the bar names you." : undefined;
	}
	if (picked === undefined) return undefined;
	return "Team name from `team.teammates` — `/team join <label>` picks another.";
}

/**
 * A card that was handed over, and the peers the message reached.
 *
 * `notListening` is the one fact the send cannot tell you and the record can: a peer
 * that is not listening reads the handoff at its next turn rather than being woken for
 * it. Saying so is the difference between "delivered" and "delivered and read".
 *
 * There is no `to` beside the delivered list: a send that returned wrote at least one inbox
 * (`SendResult`), so the peers it reached are the whole answer, and a send that reached nobody is
 * the refusal the caller already has.
 */
export function formatHandoff(
	card: Card,
	delivered: readonly string[],
	notListening: readonly string[] = [],
	quiet: readonly string[] = [],
	failed: readonly DeliveryFailure[] = [],
): string {
	return [
		`${cardRef(card.id)} handed off to ${namesOf(delivered)}.`,
		`  ${card.title}`,
		card.paths.length > 0 ? `  paths: ${card.paths.join(", ")}` : undefined,
		"  The card is already owned by the peer; the handoff is in its inbox.",
		card.owner?.handoff?.unresolved === true ? UNRESOLVED_LINE : undefined,
		notListeningLine(notListening),
		quietLine(quiet),
		indent(notDeliveredLine(failed)),
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/**
 * What a sender reads when the bus could not name the peer the handoff went to.
 *
 * The card is real and the message is in an inbox; what is missing is the session it belongs to,
 * so the only write left is the lead's or the person's reclaim, and the peer claims it back with
 * an id. The sentence says that rather than leaving the sender to find out at its next move, and it
 * names `board`, because both verbs it asks for are that tool's.
 */
const UNRESOLVED_LINE =
	"  The bus could not name that session: only the lead can move the card — ask the lead to `board` reclaim it, " +
	"then `board` claim it.";

/**
 * The line that names a peer which will not be woken, or nothing when every peer is
 * listening.
 *
 * One sentence for both verbs: what the mail does instead, and no pronoun, because the
 * list can hold one peer or three.
 */
export function notListeningLine(labels: readonly string[]): string | undefined {
	if (labels.length === 0) return undefined;
	return `  Not listening: ${namesOf(labels)} — ${ALARM_REASON["not-listening"]}.`;
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
	return `  Quiet: ${namesOf(labels)} — ${ALARM_REASON.quiet}.`;
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
	failed: readonly DeliveryFailure[] = [],
): string {
	return [
		`Asked ${namesOf(delivered)} — ask ${ask}.`,
		`  The answer arrives as mail; reply with \`replyTo "${ask}"\`, and nothing is waiting on it.`,
		notListeningLine(notListening),
		quietLine(quiet),
		indent(notDeliveredLine(failed)),
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/**
 * The write that landed and the message that did not.
 *
 * The order is state first, so this is the one half-failure left: the card is the peer's and the
 * peer has not been told. Repeating `assign` re-sends the same key, which folds if the first copy
 * ever lands.
 */
export function formatOfferUnsent(card: Card, reason: string): string {
	return `${cardRef(card.id)} is offered and recorded, but the broadcast did not reach anybody: ${reason}\n  Offer it again to retry; the event is keyed, so a copy still waiting folds.`;
}

export function formatHandoffUnsent(card: Card, to: string, reason: string): string {
	return `${cardRef(card.id)} is ${to}'s, but the handoff did not reach it: ${reason}\n  Assign it again to retry; the message is keyed, so a copy still waiting folds.`;
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
 * The wildcard, refused by the two verbs that reach exactly one peer.
 *
 * `*` is the bus's broadcast and `offer` is the one verb here that means it, so the sentence names
 * `offer`: a reader who typed `*` learns the verb that would have done it rather than the transport's
 * kind rule — which is where this was answered before, after `ask` had joined and after `assign` had
 * already written the owner.
 */
export function formatBroadcast(action: TeamAction): string {
	return `${action} reaches one peer; \`*\` is \`offer\`'s broadcast to every live session.`;
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
	return [
		`${cardRef(card.id)} offered to ${namesOf(delivered)}.`,
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
 * What a running call is doing, in the verb's own words.
 *
 * A partial result carries no details, so this line is all a human has while the call works:
 * every verb here waits on the bus, and the card's summary cannot say so until the call settles.
 */
const WORKING: Record<TeamAction, string> = {
	assign: "Handing over…",
	offer: "Offering…",
	ask: "Asking…",
};

export function formatWorking(action: TeamAction): string {
	return WORKING[action];
}
