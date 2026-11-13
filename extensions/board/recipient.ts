/**
 * Who a sign is addressed to: the session the bus lists under the card's owner, and the one
 * fact about it a lead can act on — whether its watch will report the message at its next turn.
 *
 * A card records what a claim or a handoff knew at the time, and both halves of that record can
 * age: the id of a session that has stopped, and the label it held while some later session holds
 * the same label. The bus resolves an id first and refuses an unknown one rather than falling back
 * to the name (`resolveRecipients`), so the id a card kept is not the more durable answer it looks
 * like. The roster is the board's own read of the same records — the one the page's Team tab and
 * the round already use — so resolving here costs one read and needs no bus to be loaded.
 *
 * Pure: a filter over records a caller read, and the caller's clock for the liveness rule.
 */

import type { CardOwner } from "../../lib/board/card.ts";
import { type RosterSession, type RosterState, rosterStateOf } from "../../lib/session-roster.ts";
import { sameLabel } from "../../lib/session-label.ts";

/** One addressee: what to send to, what to call it, and whether it is listening. */
export interface Recipient {
	/** What the bus is addressed with: the live record's id, else what the card itself says. */
	to: string;
	/** The name to report — the live record's own, so a rename is not read back as the old one. */
	label: string;
	/** Whether that peer will be woken for its mail; absent when its record does not say. */
	listening?: boolean;
	/**
	 * What the roster says about it: `live`, or `quiet`.
	 *
	 * A gone record is not a recipient at all, so a recipient is never `gone`. Quiet is the fact a
	 * result has to carry — a message written for a session whose heartbeat aged out was not handled
	 * to anybody who is known to be there.
	 */
	state?: RosterState;
}

/**
 * The peer a card's owner names, as the bus's records answer it.
 *
 * The order is the bus's own — id, then one label — with two differences: a record the roster
 * calls `gone` is skipped rather than offered as a recipient, and an ambiguity falls back to the
 * card instead of being refused here, so the bus names the ambiguity in its own sentence. No
 * roster is "cannot say", not "nobody": the card's word stands and the send reports what happens.
 */
export function recipientOf(owner: CardOwner, roster: readonly RosterSession[] | undefined, now: number): Recipient {
	const card: Recipient = { to: owner.id ?? owner.label, label: owner.label };
	if (roster === undefined) return card;
	const live = roster.filter((session) => rosterStateOf(session, now) !== "gone");
	const held = owner.id === undefined ? undefined : live.find((session) => session.id === owner.id);
	const named = held ?? soleLabel(live, owner.label);
	if (named === undefined) return card;
	return {
		to: named.id,
		label: named.label,
		state: rosterStateOf(named, now),
		...(named.watching === undefined ? {} : { listening: named.watching.armed }),
	};
}

/** The one live record whose label matches, or nothing when none or several do. */
function soleLabel(live: readonly RosterSession[], label: string): RosterSession | undefined {
	const matches = live.filter((session) => sameLabel(session.label, label));
	return matches.length === 1 ? matches[0] : undefined;
}
