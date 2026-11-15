/**
 * The WIP limits: the numbers themselves, and the one sentence a full lane refuses with.
 *
 * A limit is only a gate if the refusal names the number and the way out, so the cases here are
 * about the sentence as much as the count — and about a misconfigured file being clamped rather
 * than freezing a board. Where the numbers are read from is `config.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { Card } from "./card.ts";
import { countIn, DEFAULT_WIP, limitOf, MAX_WIP, normalizeWip, ownerRefusal, wipRefusal } from "./limits.ts";

/** `n` cards in one lane, which is all a count needs. */
function cards(lane: Card["lane"], count: number): Card[] {
	return Array.from({ length: count }, () => ({ lane }) as Card);
}

/** A card `owner` holds in `lane`, which is all the per-session count needs. */
function held(
	lane: Card["lane"],
	id: string,
	owner: { id?: string; label: string } = { id: "s-core", label: "billing-core" },
): Card {
	return { id, lane, owner } as Card;
}

describe("normalizeWip", () => {
	test("an absent setting keeps the defaults", () => {
		expect(normalizeWip(undefined)).toEqual({ perOwner: 1, plan: 3, execute: 5 });
		expect(DEFAULT_WIP).toEqual({ perOwner: 1, plan: 3, execute: 5 });
	});

	test("clamps into range, and a missing key keeps the default it had", () => {
		expect(normalizeWip({ plan: 1 })).toEqual({ perOwner: 1, plan: 1, execute: 5 });
		expect(normalizeWip({ plan: 0, execute: 99 })).toEqual({ perOwner: 1, plan: 1, execute: MAX_WIP });
		expect(normalizeWip({ plan: "4", execute: 2.6 })).toEqual({ perOwner: 1, plan: 4, execute: 3 });
		// A value that says nothing is not a zero: it is the default.
		expect(normalizeWip({ plan: null, execute: "lots" })).toEqual({ perOwner: 1, plan: 3, execute: 5 });
	});

	test("the per-session cap is a number like the lanes, clamped the same way", () => {
		expect(normalizeWip({ perOwner: 3 })).toEqual({ perOwner: 3, plan: 3, execute: 5 });
		expect(normalizeWip({ perOwner: 0 })).toEqual({ perOwner: 1, plan: 3, execute: 5 });
		expect(normalizeWip({ perOwner: 99 })).toEqual({ perOwner: MAX_WIP, plan: 3, execute: 5 });
	});
});

describe("limitOf and countIn", () => {
	test("only the pulled lanes are limited", () => {
		expect(limitOf("plan", DEFAULT_WIP)).toBe(3);
		expect(limitOf("execute", DEFAULT_WIP)).toBe(5);
		expect(limitOf("backlog", DEFAULT_WIP)).toBeUndefined();
		expect(limitOf("blocked", DEFAULT_WIP)).toBeUndefined();
		expect(limitOf("done", DEFAULT_WIP)).toBeUndefined();
	});

	test("counts one lane, not the board", () => {
		expect(countIn("execute", [...cards("execute", 2), ...cards("plan", 1)])).toBe(2);
	});
});

describe("wipRefusal", () => {
	test("says nothing while the lane has room", () => {
		expect(wipRefusal("plan", cards("plan", 2), DEFAULT_WIP)).toBeUndefined();
	});

	test("names the count, the limit, and the ways out", () => {
		expect(wipRefusal("plan", cards("plan", 3), DEFAULT_WIP)).toBe(
			"3 cards are already being planned (the limit is 3); finish, block, or release one first.",
		);
		expect(wipRefusal("execute", cards("execute", 5), DEFAULT_WIP)).toBe(
			"5 cards are already executing (the limit is 5); finish, block, or release one first.",
		);
	});

	test("a configured limit is the one the sentence states", () => {
		expect(wipRefusal("execute", cards("execute", 2), { perOwner: 1, plan: 3, execute: 2 })).toContain(
			"the limit is 2",
		);
	});

	test("a resume out of blocked is told the two exits it has", () => {
		// The ordinary sentence offers `finish`, `block`, and `release`, and a parked card can do
		// none of the first two: it is blocked, and it cannot finish from there.
		expect(wipRefusal("plan", cards("plan", 3), DEFAULT_WIP, "blocked")).toBe(
			"3 cards are already being planned (the limit is 3); wait for a slot, or release it back to the pool.",
		);
		// Every other caller keeps the sentence it had.
		expect(wipRefusal("plan", cards("plan", 3), DEFAULT_WIP, "backlog")).toContain("finish, block, or release");
	});
});

describe("ownerRefusal", () => {
	const CORE = { id: "s-core", label: "billing-core" };

	test("says nothing while the session has room", () => {
		expect(ownerRefusal(CORE, [], DEFAULT_WIP)).toBeUndefined();
		expect(ownerRefusal(CORE, [held("plan", "4")], { ...DEFAULT_WIP, perOwner: 2 })).toBeUndefined();
	});

	test("names the held card and the way out", () => {
		expect(ownerRefusal(CORE, [held("plan", "4")], DEFAULT_WIP)).toBe(
			"billing-core already holds #4 (plan): finish it, or release it to the pool first.",
		);
	});

	test("counts a blocked card, and not a finished or unowned one", () => {
		expect(ownerRefusal(CORE, [held("blocked", "4")], DEFAULT_WIP)).toContain("#4 (blocked)");
		expect(ownerRefusal(CORE, [held("done", "4")], DEFAULT_WIP)).toBeUndefined();
		expect(ownerRefusal(CORE, [{ id: "4", lane: "backlog" } as Card], DEFAULT_WIP)).toBeUndefined();
	});

	test("matches by id first, the way a holder is compared", () => {
		// A record written before ids were kept is still the same session's by its label.
		expect(ownerRefusal(CORE, [held("plan", "4", { label: "billing-core" })], DEFAULT_WIP)).toContain("#4");
		// A record carrying another id is somebody else, whatever name it wore.
		expect(
			ownerRefusal(CORE, [held("plan", "4", { id: "s-other", label: "billing-core" })], DEFAULT_WIP),
		).toBeUndefined();
	});

	test("names the first card and counts the rest when the cap is above one", () => {
		const two = { ...DEFAULT_WIP, perOwner: 2 };
		expect(ownerRefusal(CORE, [held("plan", "9"), held("execute", "10")], two)).toContain("#9 (plan) and 1 more");
	});
});
