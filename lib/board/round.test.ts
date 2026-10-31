/**
 * The rollup: the lead's answer to "who is holding what, and what needs me".
 *
 * It is computed from the cards alone, so these cases pin what a card can say —
 * and the two things it deliberately cannot: whether a session is still alive, and
 * whether two owners are one owner beyond their labels matching.
 */

import { describe, expect, test } from "bun:test";
import { type Card } from "./card.ts";
import { boardCard as cardFixture } from "../../test/helpers/fixtures/board.ts";
import { LANES } from "./lanes.ts";
import { buildRound, IDLE_MS } from "./round.ts";

const NOW = 1_000_000;

/** A card in a given lane, held by `owner` unless it is a todo. */
function card(id: string, overrides: Partial<Card> = {}): Card {
	return cardFixture(id, { updatedAt: NOW, by: "lead", ...overrides });
}

/** An executing card, which is where most groups come from. */
function doing(id: string, overrides: Partial<Card> = {}): Card {
	return card(id, { lane: "execute", owner: { id: `s-${id}`, label: "billing-core" }, ...overrides });
}

/** A card in `plan` whose plan was never recorded: the contract may or may not be written. */
function planning(id: string, contract: Card["contract"] = undefined): Card {
	return card(id, {
		lane: "plan",
		owner: { id: `s-${id}`, label: "billing-core" },
		...(contract === undefined ? {} : { contract }),
	});
}

/** A card in `plan` with its plan recorded, which is what `execute` asks for. */
function planned(id: string, contract: Card["contract"] = undefined): Card {
	return { ...planning(id, contract), planPath: `plans/${id}.md` };
}

const COMPLETE = { goal: "g", acceptance: "a", scopeOut: "s" };

describe("buildRound", () => {
	test("keeps an owner whose every card is done, and counts each kind once", () => {
		const round = buildRound(
			[
				doing("1"),
				card("2", { lane: "done", owner: { id: "s-ben", label: "ben" } }),
				card("3", { lane: "done", owner: { id: "s-ben", label: "ben" } }),
			],
			NOW,
		);
		// A teammate who finished has not left: the group stays, holding no live card.
		const ben = round.owners.find((group) => group.label === "ben");
		expect(ben?.cards).toEqual([]);
		expect(ben?.done.map((entry) => entry.id)).toEqual(["2", "3"]);
		// The live tally still reads what the lanes read: a done card is counted in `done`.
		expect(round.owners.flatMap((group) => group.cards).map((entry) => entry.id)).toEqual(["1"]);
		expect(round.done.map((entry) => entry.id)).toEqual(["2", "3"]);
	});

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
		const round = buildRound([doing("1"), card("2", { lane: "done", owner: { label: "billing-core" } })], NOW);
		expect(round.owners[0]?.cards.map((entry) => entry.id)).toEqual(["1"]);
		expect(round.done.map((entry) => entry.id)).toEqual(["2"]);
	});

	test("unassigned is every backlog card", () => {
		const round = buildRound([card("1"), doing("2"), card("3")], NOW);
		expect(round.unassigned.map((entry) => entry.id)).toEqual(["1", "3"]);
	});

	test("a complete, approved contract with no plan is unplanned, not awaiting approval", () => {
		// The migration case: `execute` refuses a card with no artifact, so the queue that
		// leads somewhere has to keep it rather than filing it as done with its decision.
		const approvedNoPlan = planning("1", {
			goal: "g",
			acceptance: "a",
			scopeOut: "s",
			approved: { by: "lead", at: NOW },
		});
		const round = buildRound([approvedNoPlan], NOW);
		expect(round.unplanned.map((entry) => entry.id)).toEqual(["1"]);
		expect(round.unapproved).toEqual([]);
	});

	test("unplanned is a plan card whose contract is still missing a line", () => {
		const round = buildRound([planning("1"), planned("2", COMPLETE)], NOW);
		expect(round.unplanned.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("unapproved is a complete contract nobody has signed, which is the lead's queue", () => {
		const round = buildRound(
			[planned("1", COMPLETE), planned("2", { ...COMPLETE, approved: { by: "billing-lead", at: NOW } })],
			NOW,
		);
		expect(round.unapproved.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("unreviewed is every executing card nobody has spot-checked, whatever its clock says", () => {
		// The lead owes a look at everything in `execute` until one is recorded, so the group
		// needs no idle window to notice it: a card one millisecond old is already here, which
		// is what a peer that finishes in ten minutes depends on.
		const round = buildRound(
			[
				doing("1", { updatedAt: NOW }),
				doing("2", { review: { by: "lead", at: NOW } }),
				planned("3", { ...COMPLETE, approved: { by: "lead", at: NOW } }),
			],
			NOW,
		);
		expect(round.unreviewed.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("unreviewed and idle are the same card when its owner has gone quiet", () => {
		// Two facts, one card: the lead still owes the spot-check, and nobody has touched it.
		const round = buildRound([doing("1", { updatedAt: NOW - IDLE_MS })], NOW);
		expect(round.unreviewed.map((entry) => entry.id)).toEqual(["1"]);
		expect(round.idle.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("blocked and done are their own lists", () => {
		const round = buildRound(
			[
				card("1", { lane: "blocked", owner: { label: "billing-core" } }),
				card("2", { lane: "done", owner: { label: "x" } }),
			],
			NOW,
		);
		expect(round.blocked.map((entry) => entry.id)).toEqual(["1"]);
		expect(round.done.map((entry) => entry.id)).toEqual(["2"]);
	});

	test("idle is an executing card nobody has touched for the idle window", () => {
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
		// A card re-planned after it started: still in the board's plan lane, and its owner
		// has not touched it since. Both groups say something a lead acts on.
		const round = buildRound([planning("1")], NOW);
		expect(round.unplanned.map((entry) => entry.id)).toEqual(["1"]);
		const executing = buildRound([doing("1", { updatedAt: NOW - IDLE_MS })], NOW);
		expect(executing.idle.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("an empty board has empty groups", () => {
		expect(buildRound([], NOW)).toEqual({
			owners: [],
			unassigned: [],
			unplanned: [],
			unapproved: [],
			unreviewed: [],
			blocked: [],
			idle: [],
			done: [],
		});
	});

	test("the lane lists partition the board; owner groups overlap them on purpose", () => {
		const cards = [
			card("1"),
			doing("2"),
			card("3", { lane: "blocked", owner: { label: "billing-core" } }),
			card("4", { lane: "done", owner: { label: "billing-core" } }),
		];
		const round = buildRound(cards, NOW);
		const doingOf = round.owners.flatMap((group) => group.cards).filter((entry) => entry.lane === "execute");
		const planned = [...round.unplanned, ...round.unapproved];
		const lanes = [...round.unassigned, ...planned, ...doingOf, ...round.blocked, ...round.done];
		expect(lanes.map((entry) => entry.id).sort()).toEqual(cards.map((entry) => entry.id).sort());
		// An owner's panel shows the blocked card too, and the Blocked group is the
		// same card from the lead's angle: two panels, one card.
		expect(round.owners.flatMap((group) => group.cards).map((entry) => entry.id)).toEqual(["2", "3"]);
		expect(LANES).toHaveLength(5);
	});
});
