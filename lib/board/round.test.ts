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
import { buildRound, gateOf, UNWRITTEN_MS } from "./round.ts";
import { laneSince } from "./card.ts";

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

	test("a plan file with half a contract is unplanned, which the row used to call planned", () => {
		// The drift `gateOf` removed: the round read `planPath` plus a complete contract, the
		// transcript's row read `planPath` alone, so this card was `unplanned` here and `planned`
		// there. One rule in `round.ts` answers both now.
		const half = { goal: "g", acceptance: "a" } as Card["contract"];
		const round = buildRound([planned("1", half)], NOW);
		expect(round.unplanned.map((entry) => entry.id)).toEqual(["1"]);
		expect(round.unapproved).toEqual([]);
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
		// needs no unwritten window to notice it: a card one millisecond old is already here, which
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

	test("a spot-check that a reclaim carried into the pool does not count for the next execution", () => {
		// The sign stays on the record as evidence; the execution it names is gone, so the lead owes
		// a fresh look rather than the round reporting the work as already checked.
		const again = doing("1", {
			review: { by: "lead", at: NOW - 1_000 },
			log: [
				{ lane: "backlog", at: NOW - 500, by: "billing-core" },
				{ lane: "execute", at: NOW, by: "billing-core" },
			],
		});
		expect(buildRound([again], NOW).unreviewed.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("unreviewed and unwritten are the same card when its owner has gone quiet", () => {
		// Two facts, one card: the lead still owes the spot-check, and nobody has written it.
		const round = buildRound([doing("1", { updatedAt: NOW - UNWRITTEN_MS })], NOW);
		expect(round.unreviewed.map((entry) => entry.id)).toEqual(["1"]);
		expect(round.unwritten.map((entry) => entry.id)).toEqual(["1"]);
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

	test("unwritten is an executing card nobody has written for the window", () => {
		const round = buildRound(
			[doing("1", { updatedAt: NOW - UNWRITTEN_MS }), doing("2", { updatedAt: NOW - UNWRITTEN_MS + 1 })],
			NOW,
		);
		expect(round.unwritten.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("unwritten reads the card's own clock, not a session's liveness", () => {
		// A freshly noted card is not unwritten however long its owner has been gone: the
		// board cannot see a process, and says so by measuring the card.
		const round = buildRound([doing("1", { updatedAt: NOW, createdAt: 0 })], NOW);
		expect(round.unwritten).toEqual([]);
	});

	test("a card can be both unplanned and unwritten, because both are worth knowing", () => {
		// A card re-planned after it started: still in the board's plan lane, and its owner
		// has not written it since. Both groups say something a lead acts on.
		const round = buildRound([planning("1")], NOW);
		expect(round.unplanned.map((entry) => entry.id)).toEqual(["1"]);
		const executing = buildRound([doing("1", { updatedAt: NOW - UNWRITTEN_MS })], NOW);
		expect(executing.unwritten.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("an empty board has empty groups", () => {
		expect(buildRound([], NOW)).toEqual({
			owners: [],
			unassigned: [],
			unplanned: [],
			unapproved: [],
			unreviewed: [],
			blocked: [],
			unwritten: [],
			done: [],
			archivable: [],
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

describe("the gate a card owes", () => {
	/** An executing card that entered its lane at `since`, with a sign made at `at`. */
	const reviewed = (since: number, at: number): Card =>
		doing("1", {
			planPath: "plans/1.md",
			review: { by: "billing-lead", at },
			log: [
				{ lane: "backlog", at: since - 2_000, by: "billing-lead" },
				{ lane: "execute", at: since, by: "billing-core" },
			],
		});

	test("answers for the two lanes a card is worked in, and for nothing else", () => {
		// The pool owes a plan nobody has started and a blocked card owes a decision: both are
		// their own groups in the rollup, and a route gate here would name them twice.
		expect(gateOf(card("1", { lane: "backlog" }))).toBeUndefined();
		expect(gateOf(card("1", { lane: "blocked" }))).toBeUndefined();
		expect(gateOf(card("1", { lane: "done" }))).toBeUndefined();
	});

	test("names the contract a plan card has not finished writing", () => {
		expect(gateOf(planned("1"))).toBe("contract");
		// One line short is the same gate: the contract is what the card owes, not a signature.
		const half = { goal: "g", acceptance: "a" } as Card["contract"];
		expect(gateOf(planned("1", half))).toBe("contract");
	});

	test("names the contract when a complete one has no plan to execute against", () => {
		// The artifact rule: a contract names the file the work is run against, and a card planned
		// before it existed has none — `execute` would refuse it, so it owes a contract.
		expect(gateOf(planning("1", { ...COMPLETE, approved: { by: "lead", at: NOW } }))).toBe("contract");
	});

	test("names the approval of a complete contract nobody has read", () => {
		expect(gateOf(planned("1", COMPLETE))).toBe("approval");
	});

	test("answers nothing for a plan card that is signed and ready", () => {
		expect(gateOf(planned("1", { ...COMPLETE, approved: { by: "lead", at: NOW } }))).toBeUndefined();
	});

	test("names the spot-check an execute card has not had", () => {
		expect(gateOf(doing("1", { planPath: "plans/1.md" }))).toBe("review");
	});

	test("reads a spot-check older than the lane entry as the one still owed", () => {
		// A reclaim carries a sign back into the pool, so the sign speaks for the execution it was
		// made in and not for this one: the row could not see this while it read `planPath`.
		const stale = reviewed(NOW - 60_000, NOW - 61_000);
		expect(laneSince(stale)).toBe(NOW - 60_000);
		expect(gateOf(stale)).toBe("review");
	});

	test("answers nothing for an execute card whose spot-check is this execution's", () => {
		expect(gateOf(reviewed(NOW - 60_000, NOW - 59_000))).toBeUndefined();
	});
});
