/**
 * The frame as it goes on the wire: the rollup's cards named, not repeated.
 *
 * Every card is in exactly one lane, so a rollup that carried the card objects again sent the
 * same record up to four times — the whole of a 5 MB frame on a worked board. These cases hold
 * the three facts the browser depends on: the names are the cards' ids in the order the rollup
 * holds them, the lanes still carry the cards the names are expanded against, and the signature
 * is untouched so a quiet frame still pushes nothing.
 */

import { describe, expect, test } from "bun:test";
import { boardCard } from "../../test/helpers/fixtures/board.ts";
import { boardWire, buildView } from "./view.ts";

const NOW = 5_000;

const ME = { id: "s-lead", label: "billing-lead" };
const WHERE = "~/.pi/agent/board/8872d3adda0e";
const REPO = "my-pi-agent";
const ROOT = "/Users/someone/my-pi-agent";

const view = buildView({
	me: ME,
	cards: [
		boardCard("1", { updatedAt: NOW }),
		boardCard("2", { lane: "execute", owner: { label: "billing-core" }, updatedAt: NOW }),
		boardCard("3", { lane: "done", owner: { label: "billing-core" }, updatedAt: NOW }),
	],
	now: NOW,
	bytes: 2_048,
	where: WHERE,
	repo: REPO,
	root: ROOT,
});

describe("boardWire", () => {
	test("names the rollup's cards by id, in the order the rollup holds them", () => {
		const wire = boardWire(view);
		// The full view carries the cards; the wire carries the names of the same cards.
		expect(view.round.done.map((entry) => entry.id)).toEqual(["3"]);
		expect(wire.round.done).toEqual(["3"]);
		expect(view.round.unassigned.map((entry) => entry.id)).toEqual(["1"]);
		expect(wire.round.unassigned).toEqual(["1"]);
		expect(wire.round.owners[0]?.cards).toEqual(["2"]);
		expect(wire.round.owners[0]?.done).toEqual(["3"]);
	});

	test("leaves the lanes carrying cards, which is what the browser expands the ids against", () => {
		const wire = boardWire(view);
		expect(wire.lanes.flatMap((lane) => lane.cards.map((entry) => entry.id))).toEqual(["1", "2", "3"]);
		expect(wire.total).toBe(view.total);
	});

	test("leaves the signature alone, so a quiet frame still pushes nothing", () => {
		// A wire change that moved the signature would wake every open page on every tick.
		expect(boardWire(view).sig).toBe(view.sig);
	});

	test("sends each card once, so the frame is a fraction of the full one", () => {
		const full = JSON.stringify(view).length;
		const wire = JSON.stringify(boardWire(view)).length;
		// A rollup that repeated the lanes cost this frame three more copies of its cards.
		expect(wire).toBeLessThan(full);
	});
});
