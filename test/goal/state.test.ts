import { describe, expect, test } from "bun:test";
import { isActiveGoal, reconstructGoal } from "../../extensions/goal/state.ts";
import type { Goal } from "../../extensions/goal/types.ts";
import { resultEntry } from "./helpers.ts";

const active = (objective: string): Goal => ({ objective, status: "active" });
const achieved = (objective: string): Goal => ({ objective, status: "achieved" });

describe("reconstructGoal", () => {
	test("returns null for an empty branch", () => {
		expect(reconstructGoal([])).toBeNull();
	});

	test("uses the last goal written on the branch", () => {
		const entries = [
			resultEntry(active("first")),
			{ type: "message", message: { role: "assistant", content: "ok" } },
			resultEntry(achieved("second")),
		];
		expect(reconstructGoal(entries)).toEqual(achieved("second"));
	});

	test("ignores results from other tools", () => {
		expect(reconstructGoal([resultEntry(active("mine")), resultEntry(active("theirs"), "todo")])).toEqual(
			active("mine"),
		);
	});

	test("a clear (null goal) resets state", () => {
		expect(reconstructGoal([resultEntry(active("one")), resultEntry(null)])).toBeNull();
	});

	test("ignores non-message and malformed entries", () => {
		const entries = [
			{ type: "label", targetId: "x" },
			{ type: "message", message: { role: "toolResult", toolName: "goal", details: {} } },
			resultEntry(active("kept")),
			null,
		];
		expect(reconstructGoal(entries)).toEqual(active("kept"));
	});

	test("ignores malformed custom entries instead of throwing or wiping state", () => {
		const malformed = ["nope", 42, true, [], null, undefined, {}, { goal: undefined }];
		for (const data of malformed) {
			expect(() =>
				reconstructGoal([resultEntry(active("kept")), { type: "custom", customType: "goal", data }]),
			).not.toThrow();
			expect(reconstructGoal([resultEntry(active("kept")), { type: "custom", customType: "goal", data }])).toEqual(
				active("kept"),
			);
		}
	});

	test("an explicit null custom goal clears state", () => {
		expect(
			reconstructGoal([resultEntry(active("one")), { type: "custom", customType: "goal", data: { goal: null } }]),
		).toBeNull();
	});

	test("does not alias the stored goal", () => {
		const stored = active("original");
		const result = reconstructGoal([resultEntry(stored)]);
		result!.objective = "mutated";
		expect(stored.objective).toBe("original");
	});

	test("re-sanitizes a stored objective and ignores an over-long one", () => {
		expect(reconstructGoal([resultEntry({ objective: "safe\u001b[31mRED", status: "active" })])).toEqual(
			active("safe [31mRED"),
		);
		expect(
			reconstructGoal([resultEntry(active("kept")), resultEntry({ objective: "x".repeat(5000), status: "active" })]),
		).toEqual(active("kept"));
	});

	test("ignores a malformed tool-result goal instead of wiping state", () => {
		const malformed = {
			type: "message",
			message: { role: "toolResult", toolName: "goal", details: { goal: { objective: 42 }, action: "set" } },
		};
		expect(reconstructGoal([resultEntry(active("kept")), malformed])).toEqual(active("kept"));
	});

	test("does not replay a rejected call as a state write", () => {
		const rejected = {
			type: "message",
			message: {
				role: "toolResult",
				toolName: "goal",
				details: { goal: null, action: "clear", error: "objective is too long" },
			},
		};
		expect(reconstructGoal([resultEntry(active("kept")), rejected])).toEqual(active("kept"));
	});
});

describe("isActiveGoal", () => {
	test("is true only for an active goal", () => {
		expect(isActiveGoal(active("go"))).toBe(true);
		expect(isActiveGoal(achieved("go"))).toBe(false);
		expect(isActiveGoal(null)).toBe(false);
	});
});
