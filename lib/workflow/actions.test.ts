/**
 * The board's action table: the list the tool publishes, the two classifications each action
 * carries — the read/write kind plan mode and rewind ask about, and the state/work effect the
 * todo nudge asks about — the refusal sentence built from the kind, and the answers for a value
 * the tool has not normalized yet.
 *
 * A table is only worth having if the two halves cannot disagree, so what is pinned here
 * is the shape: one kind and one effect per action, the reads being exactly the actions plan
 * mode admits, `review` being the only action that can change a tree, an unknown string never
 * counting as either, and a phrase that reads correctly for however many reads the table holds.
 */

import { describe, expect, test } from "bun:test";
import {
	BOARD_ACTION_EFFECT,
	BOARD_ACTION_KIND,
	BOARD_ACTIONS,
	BOARD_READ_ACTIONS,
	boardWriteRefusal,
	isBoardReadAction,
	isBoardWorkAction,
	readActionsText,
} from "./actions.ts";

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
		expect(writes).toHaveLength(15);
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

	test("classifies every action's effect, and names the two that are work", () => {
		// A card is written to `~/.pi/agent/board/<repo.key>`, which is not the checkout, so a
		// claim or a note is the board's state. `review` runs the contract's verify command as a
		// real child process in the tree the card names, and `land` fetches, merges and pushes the
		// trunk itself — the one action whose work is the checkout's history rather than its files.
		// Both are work for the reason `bash` is: a distinction the read/write kind cannot draw,
		// because each is a write either way.
		expect(Object.keys(BOARD_ACTION_EFFECT).sort()).toEqual([...BOARD_ACTIONS].sort());
		for (const action of BOARD_ACTIONS) expect(["state", "work"]).toContain(BOARD_ACTION_EFFECT[action]);
		expect(BOARD_ACTIONS.filter((action) => BOARD_ACTION_EFFECT[action] === "work")).toEqual(["review", "land"]);
	});

	test("answers work for `review` and `land`, and never for a value it has not normalized", () => {
		expect(isBoardWorkAction("review")).toBe(true);
		expect(isBoardWorkAction("land")).toBe(true);
		for (const action of BOARD_ACTIONS) {
			if (action === "review" || action === "land") continue;
			expect(isBoardWorkAction(action), action).toBe(false);
		}
		// The nudge spends a model request on a false positive, so an unreadable value is not work.
		expect(isBoardWorkAction("review ")).toBe(false);
		expect(isBoardWorkAction("REVIEW")).toBe(false);
		expect(isBoardWorkAction(undefined)).toBe(false);
		expect(isBoardWorkAction(42)).toBe(false);
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

describe("boardWriteRefusal", () => {
	test("names the verb, the reads, and the order that avoids the refusal", () => {
		const text = boardWriteRefusal("claim", "plan exit to proceed.");
		expect(text).toContain("`claim` changes the board");
		expect(text).toContain("only `list` reads it");
		expect(text).toContain("claim the card before you plan");
		expect(text).toContain("record its plan once the plan is approved");
		// Plan mode supplies its own exit guidance, so the sentence has one source per fact.
		expect(text.endsWith("plan exit to proceed.")).toBe(true);
	});

	test("names the tool itself when the call carried no verb", () => {
		expect(boardWriteRefusal(undefined, "guidance")).toContain("`board` changes the board");
		expect(boardWriteRefusal("  ", "guidance")).toContain("`board` changes the board");
	});
});
