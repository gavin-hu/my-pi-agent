/**
 * The contract: the three lines a card promises, the boundary the model's arguments pass,
 * and the sign an approval leaves.
 *
 * The caps are asserted here because the model writes them: a goal that wraps a row or a
 * scope-out that grows a card file is refused at the boundary rather than clamped later.
 */

import { describe, expect, test } from "bun:test";
import {
	CONTRACT_FIELDS,
	contractApproved,
	contractComplete,
	isContract,
	isHandoff,
	isSign,
	MAX_CONTRACT,
	mergedContract,
	missingContractFields,
	normalizeContractField,
	normalizeInstruction,
	normalizeVerify,
} from "./contract.ts";

const COMPLETE = { goal: "g", acceptance: "a", scopeOut: "s" };

describe("normalizeContractField", () => {
	test("keeps one sanitized line", () => {
		expect(normalizeContractField("goal", "  a goal\nwith a break  ")).toEqual({ text: "a goal with a break" });
	});

	test("refuses an absent, empty, or over-long line, naming the field", () => {
		expect(normalizeContractField("goal", undefined)).toEqual({ error: "goal is required." });
		expect(normalizeContractField("acceptance", "   ")).toEqual({ error: "acceptance is required." });
		expect(normalizeContractField("scopeOut", "x".repeat(MAX_CONTRACT + 1))).toEqual({
			error: `scopeOut must be at most ${MAX_CONTRACT} characters.`,
		});
		expect(normalizeContractField("goal", 7)).toEqual({ error: "goal is required." });
	});
});

describe("the optional verify line", () => {
	test("is one sanitized line, and empty is how it is taken back off", () => {
		// Unlike the three required fields, empty is an answer here: a card read rather than run
		// can stop naming a command, so this clears instead of refusing.
		expect(normalizeVerify("  bun run check\n")).toEqual({ text: "bun run check" });
		expect(normalizeVerify("")).toEqual({ text: "" });
		expect(normalizeVerify(7)).toHaveProperty("error");
		expect(normalizeVerify("x".repeat(MAX_CONTRACT + 1))).toHaveProperty("error");
	});

	test("keeps a card's completeness gate exactly where it was", () => {
		// The field is optional, so a contract without it is still complete and still approvable:
		// the gate a reviewer reads is the three lines it always was.
		expect(missingContractFields(COMPLETE)).toEqual([]);
		expect(missingContractFields({ ...COMPLETE, verify: "bun run check" })).toEqual([]);
	});

	test("rides a change like any other contract line, so the sign goes with it", () => {
		// The failure this card exists to prevent: a spot-check that ran the old command standing
		// as evidence for a promise the card no longer makes.
		const approved = { ...COMPLETE, verify: "bun run check", approved: { by: "lead", at: 5 } };
		const renamed = mergedContract(approved, { verify: "bun test" });
		expect(renamed.verify).toBe("bun test");
		expect(renamed.approved).toBeUndefined();
		// Cleared means absent, not an empty line a reader would draw.
		const cleared = mergedContract(approved, { verify: "" });
		expect(cleared.verify).toBeUndefined();
		// And a write that changes nothing else keeps it where it was.
		expect(mergedContract(approved, {}).verify).toBe("bun run check");
	});

	test("is read by isContract, and a line this build cannot trust drops the card", () => {
		expect(isContract(COMPLETE)).toBe(true);
		expect(isContract({ ...COMPLETE, verify: "bun run check" })).toBe(true);
		expect(isContract({ ...COMPLETE, verify: "" })).toBe(false);
		expect(isContract({ ...COMPLETE, verify: "x".repeat(MAX_CONTRACT + 1) })).toBe(false);
	});
});

describe("missingContractFields", () => {
	test("a card with no contract is missing all three, in order", () => {
		expect(missingContractFields(undefined)).toEqual([...CONTRACT_FIELDS]);
	});

	test("names only the blank lines, so a refusal says what to write", () => {
		expect(missingContractFields({ goal: "g", acceptance: "", scopeOut: "s" })).toEqual(["acceptance"]);
		expect(contractComplete({ goal: "g", acceptance: "", scopeOut: "s" })).toBe(false);
		expect(contractComplete(COMPLETE)).toBe(true);
	});
});

describe("an approval", () => {
	test("is absent until somebody signs, and the sign is a name and a moment", () => {
		expect(contractApproved({ ...COMPLETE })).toBe(false);
		expect(contractApproved({ ...COMPLETE, approved: { by: "billing-lead", at: 1 } })).toBe(true);
	});

	test("an edited line drops the sign, because it named a wording", () => {
		const approved = { ...COMPLETE, approved: { by: "billing-lead", at: 1 } };
		const reworded = mergedContract(approved, { scopeOut: "no refunds" });
		expect(reworded).toEqual({ goal: "g", acceptance: "a", scopeOut: "no refunds" });
		expect(reworded.approved).toBeUndefined();
	});

	test("merging keeps every line it was not given", () => {
		expect(mergedContract({ goal: "g", acceptance: "a", scopeOut: "s" }, { acceptance: "b" })).toEqual({
			goal: "g",
			acceptance: "b",
			scopeOut: "s",
		});
	});
});

describe("normalizeInstruction", () => {
	test("keeps one sanitized line, in the signer's words", () => {
		expect(normalizeInstruction("  closed on my instruction\nfor 0.22.0 ")).toEqual({
			text: "closed on my instruction for 0.22.0",
		});
	});

	test("refuses an absent, empty, or over-long reason, in the words of the field", () => {
		expect(normalizeInstruction(undefined)).toEqual({ error: "override needs the one line saying why." });
		expect(normalizeInstruction("   ")).toEqual({ error: "override needs the one line saying why." });
		expect(normalizeInstruction(7)).toEqual({ error: "override needs the one line saying why." });
		expect(normalizeInstruction("x".repeat(MAX_CONTRACT + 1))).toEqual({
			error: `override must be at most ${MAX_CONTRACT} characters.`,
		});
	});
});

describe("isContract and isSign", () => {
	test("accepts what this build writes, and an older contract with no sign", () => {
		expect(isContract(COMPLETE)).toBe(true);
		expect(isContract({ ...COMPLETE, approved: { by: "billing-lead", at: 1 } })).toBe(true);
	});

	test("refuses a missing or empty line, an over-long one, and a sign that is not one", () => {
		expect(isContract({ goal: "g", acceptance: "a" })).toBe(false);
		expect(isContract({ ...COMPLETE, goal: "" })).toBe(false);
		expect(isContract({ ...COMPLETE, acceptance: "x".repeat(MAX_CONTRACT + 1) })).toBe(false);
		expect(isContract({ ...COMPLETE, approved: { by: "", at: 1 } })).toBe(false);
		expect(isContract({ ...COMPLETE, approved: { by: "x", at: 1.5 } })).toBe(false);
		expect(isContract("not a contract")).toBe(false);
	});

	test("a sign is a label and a whole moment", () => {
		expect(isSign({ by: "billing-lead", at: 0 })).toBe(true);
		expect(isSign({ by: "billing-lead" })).toBe(false);
		expect(isSign(undefined)).toBe(false);
	});

	test("a sign carries the person's mark, or nothing at all", () => {
		// The mark says the key rather than a session wrote it, so `true` is the only value the write
		// path produces: a hand-edited `false` is a record this build cannot read back as a sign.
		expect(isSign({ by: "billing-lead", at: 0, person: true })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, person: false })).toBe(false);
		expect(isContract({ ...COMPLETE, approved: { by: "billing-lead", at: 1, person: true } })).toBe(true);
	});

	test("a sign says when its message was settled, and only as a whole moment", () => {
		// A malformed announcement would read as "still owed" for the rest of the card's life: the sign
		// would keep asking its signer to say the same thing again.
		expect(isSign({ by: "billing-lead", at: 0, told: { at: 4 } })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, told: { at: 1.5 } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, told: {} })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, told: "just now" })).toBe(false);
	});

	test("a handoff says the same fact as a sign, and a card refuses one that is malformed", () => {
		// Same rule as a sign's: a stamp, and a settled message or none. A handoff with no stamp, or a
		// `told` that is not one, would read as "still owed" for the rest of the card's life.
		expect(isHandoff({ at: 1 })).toBe(true);
		expect(isHandoff({ at: 1, told: { at: 2 } })).toBe(true);
		expect(isHandoff({ at: 1.5 })).toBe(false);
		expect(isHandoff({ told: { at: 2 } })).toBe(false);
		expect(isHandoff({ at: 1, told: "yes" })).toBe(false);
		expect(isHandoff({ at: 1, told: { at: "now" } })).toBe(false);
		expect(isHandoff(undefined)).toBe(false);
	});

	test("a spot-check's run names its tree, and a record without one still reads", () => {
		// The tree is the half a sha cannot say: the same commit backs a branch and its checkout, so a
		// record that names only the commit reads as proof of whichever tree the reader assumed. Signs
		// written before the board recorded one carry no field, and must keep reading.
		const run = { cmd: "bun run check", exit: 0, at: 4, sha: "1d3a8ce3" };
		expect(isSign({ by: "billing-lead", at: 0, verified: run })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, root: "/repo/.pi/worktrees/x" } })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, root: "" } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, root: 7 } })).toBe(false);
	});

	test("a sign by instruction is trusted only as the line a signer would have written", () => {
		expect(isSign({ by: "you", at: 0, byInstruction: "closed on my instruction" })).toBe(true);
		// A stored sign the write path would never produce: an empty reason, a wrapping one, and a
		// wrapping one whose newline has been flattened but not capped.
		expect(isSign({ by: "you", at: 0, byInstruction: "" })).toBe(false);
		expect(isSign({ by: "you", at: 0, byInstruction: "two\nlines" })).toBe(false);
		expect(isSign({ by: "you", at: 0, byInstruction: "x".repeat(MAX_CONTRACT + 1) })).toBe(false);
	});
});
