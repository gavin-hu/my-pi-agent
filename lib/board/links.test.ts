/**
 * The dependency graph: what a card waits for, who waits on it, and the links that
 * must never be written.
 *
 * The refusals are asserted by their sentence, because that sentence is the whole
 * answer a caller shows — the tool's error line and the page's banner are the same
 * words.
 */

import { describe, expect, test } from "bun:test";
import { CARD_VERSION, type Card, MAX_DEPENDS } from "./card.ts";
import {
	blockersOf,
	dependentsOf,
	dependedOn,
	indexOf,
	lanesText,
	normalizeDepends,
	openDependentsOf,
	waitingOn,
	wouldCycle,
} from "./links.ts";

/** A card that passes, so each case changes one field. */
function card(id: string, overrides: Partial<Card> = {}): Card {
	return {
		v: CARD_VERSION,
		id,
		title: `feature ${id}`,
		lane: "backlog",
		paths: [],
		notes: [],
		notesDropped: 0,
		rev: 1,
		createdAt: 1_000,
		updatedAt: 1_000,
		by: "billing-lead",
		...overrides,
	};
}

/** A card somebody holds, which is the only way one leaves the pool. */
function held(id: string, lane: "execute" | "blocked" | "done" = "execute", overrides: Partial<Card> = {}): Card {
	return card(id, { lane, owner: { label: "billing-core" }, ...overrides });
}

describe("blockersOf", () => {
	test("names the dependencies that are not finished, in the order the card lists them", () => {
		const board = indexOf([card("1"), held("2"), held("3", "done"), card("4", { dependsOn: ["3", "2", "1"] })]);
		const blockers = blockersOf(board.get("4") as Card, board);
		expect(blockers.map((entry) => entry.id)).toEqual(["2", "1"]);
	});

	test("a card with no links waits on nothing", () => {
		const board = indexOf([card("1")]);
		expect(blockersOf(board.get("1") as Card, board)).toEqual([]);
	});
});

describe("lanesText", () => {
	test("names each card with the lane that makes it a decision", () => {
		const board = indexOf([held("2"), held("3", "blocked")]);
		expect(lanesText(blockersOf(board.get("2") as Card, board))).toBe("");
		expect(lanesText([board.get("3") as Card, board.get("2") as Card])).toBe("#3 (blocked), #2 (execute)");
	});

	test("adds the card's title when the reader is the page's card face", () => {
		// The page has the room and the reader has to know which card it is; a refusal
		// sentence stays ids and lanes, so the same list still reads short in a row.
		const board = indexOf([held("2"), held("3", "blocked")]);
		const cards = [board.get("3") as Card, board.get("2") as Card];
		expect(lanesText(cards, { titles: true })).toBe("#3 (blocked) feature 3, #2 (execute) feature 2");
		expect(lanesText(cards)).toBe(lanesText(cards, { titles: false }));
	});

	test("says nothing for an empty list", () => {
		expect(lanesText([])).toBe("");
		expect(lanesText([], { titles: true })).toBe("");
	});
});

describe("waitingOn", () => {
	test("says which card waits and what it waits on, lane and all", () => {
		const board = indexOf([held("2"), card("4", { dependsOn: ["2"] })]);
		expect(waitingOn(board.get("4") as Card, board)).toBe("#4 waits on #2 (execute).");
	});

	test("lists every open blocker", () => {
		const board = indexOf([card("1"), held("2"), card("4", { dependsOn: ["1", "2"] })]);
		expect(waitingOn(board.get("4") as Card, board)).toBe("#4 waits on #1 (backlog), #2 (execute).");
	});

	test("says nothing once every dependency is done", () => {
		const board = indexOf([held("2", "done"), card("4", { dependsOn: ["2"] })]);
		expect(waitingOn(board.get("4") as Card, board)).toBeUndefined();
	});
});

describe("dependentsOf and dependedOn", () => {
	test("finds the cards that name one, in id order", () => {
		const board = indexOf([card("1"), card("5", { dependsOn: ["1"] }), card("3", { dependsOn: ["1", "5"] })]);
		expect(dependentsOf("1", board).map((entry) => entry.id)).toEqual(["3", "5"]);
	});

	test("refuses a drop in the words the caller shows", () => {
		const board = indexOf([card("1"), card("5", { dependsOn: ["1"] })]);
		expect(dependedOn("1", board)).toBe("#1 is waited on by #5; drop that card first.");
	});

	test("says nothing when nothing waits on it", () => {
		const board = indexOf([card("1"), card("5")]);
		expect(dependedOn("1", board)).toBeUndefined();
	});

	test("a drop is refused by a finished card too: the link would be stranded either way", () => {
		// The drop question is about the edge, not the work, which is why the refusal reads
		// `dependentsOf` and not `openDependentsOf`.
		const board = indexOf([card("1"), held("5", "done", { dependsOn: ["1"] })]);
		expect(dependedOn("1", board)).toBe("#1 is waited on by #5; drop that card first.");
		expect(openDependentsOf("1", board)).toEqual([]);
	});
});

describe("openDependentsOf", () => {
	test("names what the card is holding up, and forgets what stopped waiting", () => {
		const board = indexOf([
			card("1"),
			card("5", { dependsOn: ["1"] }),
			held("3", "execute", { dependsOn: ["1", "5"] }),
			held("4", "done", { dependsOn: ["1"] }),
		]);
		// Open, in id order: #3 and #5, not the finished #4.
		expect(openDependentsOf("1", board).map((entry) => entry.id)).toEqual(["3", "5"]);
		expect(openDependentsOf("5", board).map((entry) => entry.id)).toEqual(["3"]);
		// A card nothing waits on, and a card whose only dependents are finished, read alike.
		expect(openDependentsOf("3", board)).toEqual([]);
	});
});

describe("wouldCycle", () => {
	test("refuses the direct loop", () => {
		const board = indexOf([card("2", { dependsOn: ["4"] }), card("4")]);
		expect(wouldCycle("4", ["2"], board)).toBe("#4 cannot wait on #2: that would make a loop.");
	});

	test("refuses a loop through a chain", () => {
		const board = indexOf([card("2", { dependsOn: ["3"] }), card("3", { dependsOn: ["4"] }), card("4")]);
		expect(wouldCycle("4", ["2"], board)).toBe("#4 cannot wait on #2: that would make a loop.");
	});

	test("allows a diamond, which is an order and not a loop", () => {
		const board = indexOf([card("1"), card("2", { dependsOn: ["1"] }), card("3", { dependsOn: ["1"] }), card("4")]);
		expect(wouldCycle("4", ["2", "3"], board)).toBeUndefined();
	});
});

describe("normalizeDepends", () => {
	test("keeps existing ids, deduplicated and canonical", () => {
		const board = indexOf([card("2"), card("3"), card("4")]);
		expect(normalizeDepends(["2", "#03", "2"], "4", board)).toEqual({ dependsOn: ["2", "3"] });
	});

	test("an empty list is legal: it removes every link", () => {
		expect(normalizeDepends([], "4", indexOf([card("4")]))).toEqual({ dependsOn: [] });
	});

	test("refuses what is not a list at all", () => {
		expect(normalizeDepends("2", "4", indexOf([card("4")]))).toEqual({
			error: "dependsOn must be a list of card ids.",
		});
	});

	test("refuses an entry that is not a card id", () => {
		const board = indexOf([card("4")]);
		expect(normalizeDepends(["two"], "4", board)).toEqual({ error: '"two" is not a card id.' });
	});

	test("refuses the card itself", () => {
		const board = indexOf([card("4")]);
		expect(normalizeDepends(["4"], "4", board)).toEqual({ error: "#4 cannot wait on itself." });
	});

	test("refuses an id the board does not hold", () => {
		const board = indexOf([card("4")]);
		expect(normalizeDepends(["7"], "4", board)).toEqual({ error: "#7 does not exist." });
	});

	test("refuses more links than a card may carry", () => {
		const ids = Array.from({ length: MAX_DEPENDS + 1 }, (_, at) => String(at + 1));
		const board = indexOf([card("20"), ...ids.map((id) => card(id))]);
		expect(normalizeDepends(ids, "20", board)).toEqual({
			error: `at most ${MAX_DEPENDS} dependencies are allowed.`,
		});
	});
});
