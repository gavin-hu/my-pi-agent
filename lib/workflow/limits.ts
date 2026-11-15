/**
 * How many cards a pulled lane may hold, and the sentence that refuses the next one.
 *
 * The board is a pull system: a session takes a backlog card into `plan`, and from there
 * into `execute`. Both lanes are limited, because the binding constraint in this flow is
 * the person who approves a contract and spot-checks the work, not the number of cards a
 * session can start. The limit is a hard gate rather than a hint — a lane that is over its
 * limit is a queue nobody is reviewing, and a warning nobody reads is the same as no limit.
 *
 * The two numbers are turned into a {@link WipLimits} here and clamped to `1..MAX_WIP`, so a
 * typo cannot stop a board; where they are read from is `config.ts`, which reads the whole
 * `board` section once per store and hands it to `applyOp`. That keeps `rules.ts` pure: the
 * rule decides, the owner of the setting supplies the number, and this module is only the
 * arithmetic and the sentence.
 */

import { clampInteger } from "../json.ts";
import { type Card, cardRef, holds } from "./card.ts";
import { LANE_RULES, type Lane } from "./lanes.ts";

/** The lanes a limit applies to: the two a card is pulled into. */
export type LimitedLane = "plan" | "execute";

/** The limits one board enforces: two lanes, and one session. */
export type WipLimits = Record<LimitedLane, number> & {
	/**
	 * How many cards one session may hold in flight. The lane caps bound a team; this bounds a
	 * session, which is the "one card at a time" rule with a number behind it.
	 */
	perOwner: number;
};

/** A board's limits when nobody said otherwise: one card per session, three planning, five in flight. */
export const DEFAULT_WIP: WipLimits = { perOwner: 1, plan: 3, execute: 5 };

/** The largest limit a misconfigured file may ask for. */
export const MAX_WIP = 20;

/**
 * The limits a config section asks for, each clamped into range.
 *
 * A missing key keeps the default, so a user who sets only `execute` keeps the ordinary
 * `plan` limit rather than a zero that would freeze the board.
 */
export function normalizeWip(raw: Record<string, unknown> | undefined, base: WipLimits = DEFAULT_WIP): WipLimits {
	return {
		perOwner: clampInteger(raw?.perOwner, base.perOwner, 1, MAX_WIP),
		plan: clampInteger(raw?.plan, base.plan, 1, MAX_WIP),
		execute: clampInteger(raw?.execute, base.execute, 1, MAX_WIP),
	};
}

/** The limit a lane is held to, or `undefined` when the lane is not pulled. */
export function limitOf(lane: Lane, limits: WipLimits): number | undefined {
	return LANE_RULES[lane].pulled ? limits[lane as LimitedLane] : undefined;
}

/** How many cards the board holds in `lane`. */
export function countIn(lane: Lane, cards: readonly { lane: Lane }[]): number {
	return cards.filter((card) => card.lane === lane).length;
}

/**
 * Why the next card may not enter `lane`, or `undefined` when it may.
 *
 * The sentence names the lane, the number, the limit, and the ways out, because a refusal
 * that only says "full" sends the reader looking for a setting they were never shown.
 *
 * `from` is the lane the card is leaving, and the one case that changes the advice is a
 * resume out of `blocked`: that card cannot finish, and it is already parked, so the two
 * exits the ordinary sentence offers are the two it does not have.
 */
export function wipRefusal(
	lane: LimitedLane,
	cards: readonly { lane: Lane }[],
	limits: WipLimits,
	from?: Lane,
): string | undefined {
	const limit = limitOf(lane, limits) ?? DEFAULT_WIP[lane];
	const held = countIn(lane, cards);
	if (held < limit) return undefined;
	const what = lane === "plan" ? "being planned" : "executing";
	const waysOut =
		from === "blocked" ? "wait for a slot, or release it back to the pool" : "finish, block, or release one first";
	return `${held} cards are already ${what} (the limit is ${limit}); ${waysOut}.`;
}

/** The lanes a card is in flight in: pulled, or parked on a person, and not closed. */
const IN_FLIGHT: readonly Lane[] = ["plan", "execute", "blocked"];

/**
 * Why this owner may not take another card, or `undefined` when it may.
 *
 * The lane caps bound a *team*; this bounds one session, and it counts a `blocked` card — that
 * card is still the session's work, and `release` (or the lead's `reclaim`) is how the slot comes
 * back. The sentence names the held card because "you already hold one" leaves the reader counting
 * a board they may have no reason to open.
 */
export function ownerRefusal(
	owner: { id?: string; label: string },
	cards: readonly Card[],
	limits: WipLimits,
): string | undefined {
	const held = cards.filter((card) => IN_FLIGHT.includes(card.lane) && holds(card, owner));
	if (held.length < limits.perOwner) return undefined;
	const [first] = [...held].sort((a, b) => Number(a.id) - Number(b.id));
	const more = held.length > 1 ? ` and ${held.length - 1} more` : "";
	return `${owner.label} already holds ${cardRef(first.id)} (${first.lane})${more}: finish it, or release it to the pool first.`;
}
