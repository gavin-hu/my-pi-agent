/**
 * The board's action table: the list the tool publishes, the read/write kind each action
 * carries — which plan mode and the todo nudge both classify a call by — and the refusal
 * sentence built from it.
 *
 * A table is only worth having if the two halves cannot disagree, so what is pinned here
 * is the shape: one kind per action, the reads being exactly the actions plan mode admits,
 * an unknown string never counting as a read, and a phrase that reads correctly for however
 * many reads the table holds.
 */

import { describe, expect, test } from "bun:test";
import { BOARD_ACTION_KIND, BOARD_ACTIONS, BOARD_READ_ACTIONS, isBoardReadAction, readActionsText } from "./actions.ts";

describe("the action table", () => {
	test("classifies every action it lists, and lists nothing it does not classify", () => {
		expect(Object.keys(BOARD_ACTION_KIND).sort()).toEqual([...BOARD_ACTIONS].sort());
		for (const action of BOARD_ACTIONS) expect(["read", "write"]).toContain(BOARD_ACTION_KIND[action]);
	});

	test("makes `list` the one action that reads, which is what plan mode admits", () => {
		expect([...BOARD_READ_ACTIONS]).toEqual(["list"]);
		expect(isBoardReadAction("list")).toBe(true);
	});

	test("counts every other action as a write, so none of them slips past plan mode", () => {
		const writes = BOARD_ACTIONS.filter((action) => action !== "list");
		expect(writes).toHaveLength(12);
		for (const action of writes) expect(isBoardReadAction(action), action).toBe(false);
	});

	test("does not read a value the tool has not normalized yet", () => {
		// The action is whatever the model sent: `board` itself refuses an unknown action,
		// but the read-only policy answers first, so a guess here would admit a write.
		expect(isBoardReadAction("list ")).toBe(false);
		expect(isBoardReadAction("LIST")).toBe(false);
		expect(isBoardReadAction("face")).toBe(false);
		expect(isBoardReadAction(undefined)).toBe(false);
		expect(isBoardReadAction(42)).toBe(false);
	});
});

describe("readActionsText", () => {
	test("names the reads the table holds, in its order", () => {
		// The refusal a model reads is the table said aloud, so it cannot name an action the
		// table classifies as a write.
		expect(readActionsText()).toBe("`list` reads");
	});

	test("inflects for one read and for several", () => {
		// Two actions is the case this function exists for: with only `list` in the table the
		// plural branch would ship untested, and it is exactly what a second read action needs.
		// `archive` stands in as the second name — the phrase reads whatever list it is given.
		expect(readActionsText(["list"])).toBe("`list` reads");
		expect(readActionsText(["list", "archive"])).toBe("`list` or `archive` read");
	});

	test("never builds an empty phrase, because the table always holds a read", () => {
		// The phrase is read as "only … it" in a refusal, so no reads at all would say
		// "only  it". The table is what keeps that impossible.
		expect(BOARD_READ_ACTIONS.length).toBeGreaterThan(0);
	});
});
