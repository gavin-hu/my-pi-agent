/**
 * Board fixtures: one card, complete.
 *
 * Every board and team suite carried its own `card()` builder, and the copies had
 * drifted on exactly what hurts a card test — which fields one set and which it left
 * off behind a cast. The shape and its version live here; a suite keeps only the
 * scenario that makes its cases read: the billing card, a numbered card, one a minute
 * old. Value-only: every call returns a fresh object, so no two tests share one.
 */

import { type Card, CARD_VERSION } from "../../../lib/board/card.ts";

/** A card, complete, in the backlog: every field the store writes, at a neutral value. */
export function boardCard(id = "4", overrides: Partial<Card> = {}): Card {
	return {
		v: CARD_VERSION,
		id,
		title: `Card ${id}`,
		lane: "backlog",
		paths: [],
		notes: [],
		notesDropped: 0,
		rev: 1,
		createdAt: 0,
		updatedAt: 0,
		by: "billing-lead",
		...overrides,
	};
}

/**
 * The billing card the store, read, and transport suites write: one path, two fixed
 * times. A suite that lists it asks about a card's facts, not about its defaults.
 */
export function billingCard(overrides: Partial<Card> = {}): Card {
	return boardCard("4", {
		title: "Billing webhook accepts orders",
		paths: ["src/billing"],
		createdAt: 1_000,
		updatedAt: 1_000,
		...overrides,
	});
}

/** A numbered card whose title carries its id, for the suites that compare several. */
export function numberedCard(id: string, overrides: Partial<Card> = {}): Card {
	return boardCard(id, { title: `feature ${id}`, createdAt: 1_000, updatedAt: 1_000, ...overrides });
}

/**
 * Numbered cards a minute old at `now`: the shape the rollup and `/team` suites show,
 * where the age keeps a card out of the idle bucket without changing any other fact.
 */
export function minuteOldCards(now: number): (id: string, overrides?: Partial<Card>) => Card {
	return (id, overrides = {}) => numberedCard(id, { createdAt: now - 60_000, updatedAt: now - 60_000, ...overrides });
}

/** The text the model reads from a tool result, which is what a board and a team case assert on. */
export function resultText(result: { content: Array<{ text: string }> }): string {
	return result.content.map((block) => block.text).join("\n");
}
