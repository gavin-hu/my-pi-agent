/**
 * The board's verb table: the list the tool publishes and the read/write kind each verb
 * carries, which plan mode and the todo nudge both classify a call by.
 *
 * A table is only worth having if the two halves cannot disagree, so what is pinned here
 * is the shape: one kind per verb, the reads being exactly the verbs plan mode admits, and
 * an unknown string never counting as a read.
 */

import { describe, expect, test } from "bun:test";
import { BOARD_ACTION_KIND, BOARD_ACTIONS, BOARD_READ_ACTIONS, isBoardReadAction } from "./verbs.ts";

describe("the verb table", () => {
	test("classifies every verb it lists, and lists nothing it does not classify", () => {
		expect(Object.keys(BOARD_ACTION_KIND).sort()).toEqual([...BOARD_ACTIONS].sort());
		for (const action of BOARD_ACTIONS) expect(["read", "write"]).toContain(BOARD_ACTION_KIND[action]);
	});

	test("makes `list` the one verb that reads, which is what plan mode admits", () => {
		expect([...BOARD_READ_ACTIONS]).toEqual(["list"]);
		expect(isBoardReadAction("list")).toBe(true);
	});

	test("counts every other verb as a write, so none of them slips past plan mode", () => {
		const writes = BOARD_ACTIONS.filter((action) => action !== "list");
		expect(writes).toHaveLength(12);
		for (const action of writes) expect(isBoardReadAction(action), action).toBe(false);
	});

	test("does not read a value the tool has not normalized yet", () => {
		// The action is whatever the model sent: `board` itself refuses an unknown verb,
		// but the read-only policy answers first, so a guess here would admit a write.
		expect(isBoardReadAction("list ")).toBe(false);
		expect(isBoardReadAction("LIST")).toBe(false);
		expect(isBoardReadAction("face")).toBe(false);
		expect(isBoardReadAction(undefined)).toBe(false);
		expect(isBoardReadAction(42)).toBe(false);
	});
});
