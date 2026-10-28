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
	isSign,
	MAX_CONTRACT,
	mergedContract,
	missingContractFields,
	normalizeContractField,
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
});
