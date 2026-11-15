/**
 * What kind of work a card is, and whether it breaks an existing user.
 *
 * The kind answers what the card changes about the package — the question a changelog line
 * answers — and the marker says whether an existing user must act, which cuts across every
 * kind rather than naming one. Both are absent on most records and neither has a default: a
 * card nobody classified draws no label instead of wearing a guess.
 *
 * Its own module because the record's shape and caps are one job and the kind's table and
 * normalizers are another; `card.ts` imports the type and holds the two fields. Value-only,
 * like the record: no I/O, no state.
 */

import { sanitizeLine } from "../format.ts";
import type { FieldError } from "./card.ts";

/**
 * The kinds of work a card can be, each named by what it delivers.
 *
 * A type is not a stage and not an urgency: a feature adds, changes, or removes something
 * a user sees; a bug makes the package do what it said; a refactor leaves the outcome
 * alone; docs, tests, and chores touch only what explains, proves, or ships it. The list is
 * closed, so an unclassifiable card is refused a word rather than given one nobody can act
 * on, and short, so two readers classify one card the same way.
 */
export const CARD_TYPES = ["feature", "bug", "refactor", "docs", "test", "chore"] as const;

/** One kind a card can be. */
export type CardType = (typeof CARD_TYPES)[number];

/**
 * The type as stored: one of {@link CARD_TYPES}, or the reason it cannot be.
 *
 * An absent type is the absence itself rather than a default, because a default would make
 * every unclassified card read as a feature and put a word on the face nobody wrote.
 */
export function normalizeType(raw: unknown): { type?: CardType } | FieldError {
	if (raw === undefined) return {};
	const allowed = CARD_TYPES.join(", ");
	if (typeof raw !== "string") return { error: `type must be one of ${allowed}.` };
	const type = sanitizeLine(raw).trim().toLowerCase();
	const known = CARD_TYPES.find((entry) => entry === type);
	return known === undefined ? { error: `type must be one of ${allowed}.` } : { type: known };
}

/** The breaking marker as stored: true, false, or the reason it cannot be. */
export function normalizeBreaking(raw: unknown): { breaking: boolean } | FieldError {
	if (raw === undefined) return { breaking: false };
	if (typeof raw !== "boolean") return { error: "breaking must be true or false." };
	return { breaking: raw };
}

/** Whether the card is a breaking change, with the absent marker read as its meaning. */
export function breakingOf(card: { breaking?: boolean }): boolean {
	return card.breaking === true;
}
