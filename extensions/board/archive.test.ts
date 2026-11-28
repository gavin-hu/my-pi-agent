/**
 * The sweep's bound: how much of a finished board moves, and what the sentence says.
 *
 * The sweep is one rule over the board — `archivableOf` — and a bound is the one thing a caller
 * adds to it, so these cases are about the two facts that can be wrong: which card is old enough
 * (when it finished, not when it was last touched), and whether the line a reader gets admits the
 * cards the bound kept. A bound that moved the wrong card is archiving one nobody chose; a bound
 * that says nothing reads as "that was all of it".
 */

import { describe, expect, test } from "bun:test";
import { type Card, laneSince } from "../../lib/workflow/card.ts";
import type { BoardStore } from "../../lib/workflow/store.ts";
import { billingCard as card } from "../../test/helpers/fixtures/board.ts";
import { boundOf, closedAt, sweepFinished, sweepText } from "./archive.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const ME = { id: "s1", label: "billing-core" } as const;

/** A finished card whose log says it entered `done` at `at`. */
function finishedAt(at: number, overrides: Partial<Card> = {}): Card {
	return card({
		lane: "done",
		owner: { label: "billing-core" },
		updatedAt: at,
		log: [{ lane: "done", at, by: "billing-core" }],
		...overrides,
	});
}

/**
 * A store a sweep can read and move.
 *
 * `sweepFinished` reaches `list` and `mutate` and nothing else, which is the guarantee this cast
 * names: every other method of a `BoardStore` is never called here, so none is written.
 */
function storeOver(cards: readonly Card[], moved: string[]): BoardStore {
	const store = {
		list: async () => [...cards],
		mutate: async (id: string) => {
			const held = cards.find((entry) => entry.id === id);
			if (held === undefined) throw new Error(`no card ${id}`);
			moved.push(id);
			return { ok: true, card: held, changed: true, dropped: false, archived: true };
		},
	};
	return store as unknown as BoardStore;
}

describe("boundOf", () => {
	test("is the bound a spec names, and nothing at all when there is no spec", () => {
		expect(boundOf("30d")).toEqual({ ok: true, bound: { spec: "30d", ms: 30 * DAY } });
		expect(boundOf(undefined)).toEqual({ ok: true });
	});

	test("refuses an unreadable spec in the sentence both doors say", () => {
		// `/board archive 30d` is the case: the flag is missing, and the shape of what is left is a
		// card id. The refusal has to say nothing was swept, because that is the fear.
		const read = boundOf("30");
		expect(read.ok).toBe(false);
		const error = read.ok ? "" : read.error;
		expect(error).toContain('"30" is not an age');
		expect(error).toContain("30d, 12h, or 90m");
		expect(error).toContain("Nothing was swept.");
	});
});

describe("closedAt", () => {
	test("is the stamp of the transition into the lane the card is in", () => {
		const finished = finishedAt(NOW - 40 * DAY);
		expect(closedAt(finished)).toBe(NOW - 40 * DAY);
		expect(laneSince(finished)).toBe(NOW - 40 * DAY);
	});

	test("falls back to the last write when the log was elided", () => {
		// A file old enough to have lost its log has one fact left: when it was written last. That
		// keeps it longer than its lane age rather than sweeping it on a guess.
		const elided = card({ lane: "done", owner: { label: "billing-core" }, updatedAt: NOW - 50 * DAY });
		expect(closedAt(elided)).toBe(NOW - 50 * DAY);
	});
});

describe("a bounded sweep", () => {
	test("moves only what the bound clears, and names the rest", async () => {
		const old = finishedAt(NOW - 40 * DAY);
		const young = finishedAt(NOW - 2 * DAY);
		const moved: string[] = [];
		const swept = await sweepFinished(storeOver([old, young], moved), ME, NOW, undefined, {
			spec: "30d",
			ms: 30 * DAY,
		});
		expect(moved).toEqual([old.id]);
		expect(swept.moved).toEqual([old.id]);
		expect(swept.held).toEqual([young.id]);
		expect(swept.kept).toEqual([]);
		expect(swept.bound).toBe("30d");
	});

	test("takes everything when no bound is given", async () => {
		// The option is opt-in: without it `archive` answers exactly what it answered before.
		const old = finishedAt(NOW - 40 * DAY);
		const young = finishedAt(NOW - 2 * DAY);
		const moved: string[] = [];
		const swept = await sweepFinished(storeOver([old, young], moved), ME, NOW);
		expect(moved.sort()).toEqual([old.id, young.id].sort());
		expect(swept.held).toEqual([]);
		expect(swept.bound).toBeUndefined();
	});

	test("never takes a card a live link waits on, bound or no bound", async () => {
		const waited = finishedAt(NOW - 40 * DAY);
		const waiting = card({ lane: "plan", owner: { label: "billing-core" }, dependsOn: [waited.id] });
		const moved: string[] = [];
		const swept = await sweepFinished(storeOver([waited, waiting], moved), ME, NOW, undefined, {
			spec: "30d",
			ms: 30 * DAY,
		});
		expect(moved).toEqual([]);
		expect(swept.kept).toEqual([waited.id]);
		expect(swept.held).toEqual([]);
	});
});

describe("sweepText", () => {
	test("names the bound beside the cards it moved", () => {
		const line = sweepText({ moved: ["3", "9"], kept: [], held: ["4"], failed: [], bound: "30d" });
		expect(line).toContain("2 cards archived");
		expect(line).toContain("1 card stayed: finished within 30d.");
	});

	test("a bound that held everything is an answer, not an empty board", () => {
		// The one sentence a person reads would otherwise say the board had nothing to sweep, which
		// is the opposite of what happened.
		const line = sweepText({ moved: [], kept: [], held: ["4", "5"], failed: [], bound: "90d" });
		expect(line).not.toContain("No finished cards");
		expect(line).toBe("2 cards stayed: finished within 90d.");
	});

	test("says nothing about a bound when there was none", () => {
		const line = sweepText({ moved: ["3"], kept: [], held: [], failed: [] });
		expect(line).not.toContain("stayed");
	});
});
