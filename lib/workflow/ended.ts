/**
 * What a card left behind when it was dropped: the record that its id is spent.
 *
 * A card's id is how a note, a handoff, or another card names one feature, so an id that comes
 * back is worse than an id that is gone — the same number would answer for two different
 * features. The store keeps one of these per ended card, writes it before the card file goes, and
 * never allocates its id again.
 *
 * The pile is a ledger, and this build never reads it back: the spent ids are the file names the
 * allocator skips, and the record itself is for a person opening the directory. {@link isEndedCard}
 * is the shape a reader would have to hold one to, and it is why the field is `lane` rather than
 * the `status` an older record spells — nothing migrates a record no code path opens. It lives
 * here rather than beside the card record because a card is the live thing and this is its
 * tombstone: the two never share a field, and only the store writes one.
 */

import { type CardOwner, isOwner } from "./card.ts";
import { type Lane, LANES } from "./lanes.ts";

/** The version of the tombstone record itself; it moves with neither the card record nor time. */
export const ENDED_VERSION = 1;

/** What a dropped card leaves: its spent id and what it was. */
export interface EndedCard {
	/** Schema version for the record itself; it moves with neither the card record nor time. */
	v: 1;
	/** The id that is now spent, without padding. */
	id: string;
	/** What the card was called, so a note that names its id still reads. */
	title: string;
	/** The lane it was in when it ended. */
	lane: Lane;
	/** Who ended it. */
	by: string;
	/** The owner it had, when it had one. */
	owner?: CardOwner;
	/** When it ended. */
	at: number;
	/** Why it ended: the operation, which is `drop` today. */
	why: "dropped";
}

/** Whether `value` is a tombstone this build can read. */
export function isEndedCard(value: unknown): value is EndedCard {
	if (typeof value !== "object" || value === null) return false;
	const ended = value as Record<string, unknown>;
	if (ended.v !== ENDED_VERSION) return false;
	if (typeof ended.id !== "string" || !/^[0-9]+$/.test(ended.id)) return false;
	if (typeof ended.title !== "string" || ended.title === "") return false;
	if (!LANES.includes(ended.lane as Lane)) return false;
	if (typeof ended.by !== "string" || ended.by === "") return false;
	if (!isOwner(ended.owner)) return false;
	if (typeof ended.at !== "number" || !Number.isInteger(ended.at)) return false;
	return ended.why === "dropped";
}
