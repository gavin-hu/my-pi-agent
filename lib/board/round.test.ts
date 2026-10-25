/**
 * The rollup: the lead's answer to "who is holding what, and what needs me".
 *
 * It is computed from the cards alone, so these cases pin what a card can say —
 * and the two things it deliberately cannot: whether a session is still alive, and
 * whether two owners are one owner beyond their labels matching.
 */

import { describe, expect, test } from "bun:test";
import { type Card, CARD_STATUSES } from "./card.ts";
import { buildRound, IDLE_MS } from "./round.ts";

const NOW = 1_000_000;

/** A card in a given lane, held by `owner` unless it is a todo. */
function card(id: string, overrides: Partial<Card> = {}): Card {
	const base: Card = {
		v: 1,
		id,
		title: `Card ${id}`,
		status: "todo",
		paths: [],
		notes: [],
		notesDropped: 0,
		rev: 1,
		createdAt: 0,
		updatedAt: NOW,
		by: "lead",
	};
	return { ...base, ...overrides };
}

/** A doing card, which is where most groups come from. */
function doing(id: string, overrides: Partial<Card> = {}): Card {
	return card(id, { status: "doing", owner: { id: `s-${id}`, label: "billing-core" }, ...overrides });
}

describe("buildRound", () => {
	test("groups unfinished cards by owner, ordered by label", () => {
		const round = buildRound(
			[
				doing("1", { owner: { label: "web" } }),
				doing("2", { owner: { label: "api" } }),
				doing("3", { owner: { label: "web" } }),
			],
			NOW,
		);
		expect(round.owners.map((group) => group.label)).toEqual(["api", "web"]);
		expect(round.owners[1]?.cards.map((entry) => entry.id)).toEqual(["1", "3"]);
	});

	test("one owner spelled two ways is one owner, keeping the first spelling", () => {
		const round = buildRound(
			[doing("1", { owner: { label: "Billing-Core" } }), doing("2", { owner: { label: "billing-core" } })],
			NOW,
		);
		expect(round.owners).toHaveLength(1);
		expect(round.owners[0]?.label).toBe("Billing-Core");
		expect(round.owners[0]?.cards).toHaveLength(2);
	});

	test("a finished card is history, not an owner's live work", () => {
		const round = buildRound([doing("1"), card("2", { status: "done", owner: { label: "billing-core" } })], NOW);
		expect(round.owners[0]?.cards.map((entry) => entry.id)).toEqual(["1"]);
		expect(round.done.map((entry) => entry.id)).toEqual(["2"]);
	});

	test("unassigned is every todo card", () => {
		const round = buildRound([card("1"), doing("2"), card("3")], NOW);
		expect(round.unassigned.map((entry) => entry.id)).toEqual(["1", "3"]);
	});

	test("unplanned is a doing card with no plan recorded, so a skipped plan shows", () => {
		const round = buildRound([doing("1"), doing("2", { plan: "~/.pi/agent/plans/k/two.md" })], NOW);
		expect(round.unplanned.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("blocked and done are their own lists", () => {
		const round = buildRound(
			[
				card("1", { status: "blocked", owner: { label: "billing-core" } }),
				card("2", { status: "done", owner: { label: "x" } }),
			],
			NOW,
		);
		expect(round.blocked.map((entry) => entry.id)).toEqual(["1"]);
		expect(round.done.map((entry) => entry.id)).toEqual(["2"]);
	});

	test("idle is a doing card nobody has touched for the idle window", () => {
		const round = buildRound(
			[doing("1", { updatedAt: NOW - IDLE_MS }), doing("2", { updatedAt: NOW - IDLE_MS + 1 })],
			NOW,
		);
		expect(round.idle.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("idle reads the card's own clock, not a session's liveness", () => {
		// A freshly noted card is not idle however long its owner has been gone: the
		// board cannot see a process, and says so by measuring the card.
		const round = buildRound([doing("1", { updatedAt: NOW, createdAt: 0 })], NOW);
		expect(round.idle).toEqual([]);
	});

	test("a card can be both unplanned and idle, because both are worth knowing", () => {
		const round = buildRound([doing("1", { updatedAt: NOW - IDLE_MS })], NOW);
		expect(round.unplanned.map((entry) => entry.id)).toEqual(["1"]);
		expect(round.idle.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("an empty board has empty groups", () => {
		expect(buildRound([], NOW)).toEqual({
			owners: [],
			unassigned: [],
			unplanned: [],
			blocked: [],
			idle: [],
			done: [],
		});
	});

	test("the lane lists partition the board; owner groups overlap them on purpose", () => {
		const cards = [
			card("1"),
			doing("2"),
			card("3", { status: "blocked", owner: { label: "billing-core" } }),
			card("4", { status: "done", owner: { label: "billing-core" } }),
		];
		const round = buildRound(cards, NOW);
		const doingOf = round.owners.flatMap((group) => group.cards).filter((entry) => entry.status === "doing");
		const lanes = [...round.unassigned, ...doingOf, ...round.blocked, ...round.done];
		expect(lanes.map((entry) => entry.id).sort()).toEqual(cards.map((entry) => entry.id).sort());
		// An owner's panel shows the blocked card too, and the Blocked group is the
		// same card from the lead's angle: two panels, one card.
		expect(round.owners.flatMap((group) => group.cards).map((entry) => entry.id)).toEqual(["2", "3"]);
		expect(CARD_STATUSES).toHaveLength(4);
	});
});
