/**
 * The snapshot the page renders: lanes, tallies, the rollup, and the signature
 * that decides whether a frame is pushed at all.
 *
 * The point of these cases is that the page cannot invent a state: every lane
 * holds exactly its status, the counts are summed from the lanes rather than
 * counted a second way, and `sig` moves only when a revision does.
 */

import { describe, expect, test } from "bun:test";
import { type Card, signatureOf } from "./card.ts";
import { buildView } from "./view.ts";

const NOW = 5_000;

/** A card in one lane. */
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
		by: "billing-lead",
	};
	return { ...base, ...overrides };
}

const ME = { id: "s-lead", label: "billing-lead" };
const WHERE = "~/.pi/agent/board/8872d3adda0e";

describe("buildView", () => {
	test("puts every card in its own lane, in lane order", () => {
		const view = buildView({
			me: ME,
			cards: [
				card("1"),
				card("2", { status: "doing", owner: { label: "billing-core" } }),
				card("3", { status: "blocked", owner: { label: "billing-core" } }),
				card("4", { status: "done", owner: { label: "billing-core" } }),
			],
			now: NOW,
			bytes: 2_048,
			where: WHERE,
		});
		expect(view.lanes.map((lane) => lane.status)).toEqual(["todo", "doing", "blocked", "done"]);
		expect(view.lanes.map((lane) => lane.cards.map((entry) => entry.id))).toEqual([["1"], ["2"], ["3"], ["4"]]);
	});

	test("counts each lane, and the total is their sum", () => {
		const view = buildView({
			me: ME,
			cards: [card("1"), card("2"), card("3", { status: "done", owner: { label: "x" } })],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		expect(view.counts).toEqual({ total: 3, todo: 2, doing: 0, blocked: 0, done: 1 });
	});

	test("carries the rollup of the same cards", () => {
		const view = buildView({
			me: ME,
			cards: [card("1", { status: "doing", owner: { label: "billing-core" } })],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		expect(view.round.owners.map((group) => group.label)).toEqual(["billing-core"]);
		expect(view.round.unplanned.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("names the serving session, not the browser", () => {
		const view = buildView({ me: { label: "ad-hoc" }, cards: [], now: NOW, bytes: 0, where: WHERE });
		expect(view.me).toEqual({ label: "ad-hoc" });
	});

	test("signature is the cards' signature, so a bump or a drop moves it", () => {
		const one = card("1");
		const view = buildView({ me: ME, cards: [one], now: NOW, bytes: 0, where: WHERE });
		expect(view.sig).toBe(signatureOf([one]));
		const bumped = buildView({ me: ME, cards: [{ ...one, rev: 2 }], now: NOW, bytes: 0, where: WHERE });
		expect(bumped.sig).not.toBe(view.sig);
		const dropped = buildView({ me: ME, cards: [], now: NOW, bytes: 0, where: WHERE });
		expect(dropped.sig).not.toBe(view.sig);
	});

	test("carries the size and the directory, so an unpruned board says so", () => {
		const view = buildView({ me: ME, cards: [], now: NOW, bytes: 6_144, where: WHERE });
		expect(view.bytes).toBe(6_144);
		expect(view.where).toBe(WHERE);
	});

	test("an empty board is four empty lanes", () => {
		const view = buildView({ me: ME, cards: [], now: NOW, bytes: 0, where: WHERE });
		expect(view.lanes.map((lane) => lane.cards)).toEqual([[], [], [], []]);
		expect(view.counts.total).toBe(0);
	});
});
