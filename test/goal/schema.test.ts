import { describe, expect, test } from "bun:test";
import { MAX_OBJECTIVE, normalizeGoal } from "../../extensions/goal/schema.ts";

describe("normalizeGoal", () => {
	test("treats a missing or blank objective as a clear", () => {
		expect(normalizeGoal(undefined)).toBeNull();
		expect(normalizeGoal(null)).toBeNull();
		expect(normalizeGoal({})).toBeNull();
		expect(normalizeGoal({ objective: "" })).toBeNull();
		expect(normalizeGoal({ objective: "   \n\t " })).toBeNull();
	});

	test("treats a non-string objective as a clear", () => {
		expect(normalizeGoal({ objective: 42 })).toBeNull();
		expect(normalizeGoal({ objective: ["nope"] })).toBeNull();
	});

	test("defaults the status to active", () => {
		expect(normalizeGoal({ objective: "Ship the parser" })).toEqual({
			objective: "Ship the parser",
			status: "active",
		});
	});

	test("accepts and normalizes an explicit status", () => {
		expect(normalizeGoal({ objective: "Ship it", status: "achieved" })).toEqual({
			objective: "Ship it",
			status: "achieved",
		});
		expect(normalizeGoal({ objective: "Ship it", status: "ACHIEVED" })?.status).toBe("achieved");
		expect(normalizeGoal({ objective: "Ship it", status: "  Active " })?.status).toBe("active");
	});

	test("trims and collapses whitespace so the objective stays on one line", () => {
		expect(normalizeGoal({ objective: "  first\nsecond\tthird   fourth  " })).toEqual({
			objective: "first second third fourth",
			status: "active",
		});
	});

	test("strips control characters that could corrupt the terminal", () => {
		expect(normalizeGoal({ objective: "safe\u001b[31mRED\u0007" })?.objective).toBe("safe [31mRED");
	});

	test("rejects an unknown status", () => {
		expect(() => normalizeGoal({ objective: "Ship it", status: "blocked" })).toThrow("status must be one of");
	});

	test("rejects an over-long objective", () => {
		expect(() => normalizeGoal({ objective: "x".repeat(MAX_OBJECTIVE + 1) })).toThrow(
			`longer than ${MAX_OBJECTIVE}`,
		);
	});

	test("accepts an objective at the length limit", () => {
		expect(normalizeGoal({ objective: "x".repeat(MAX_OBJECTIVE) })?.objective).toHaveLength(MAX_OBJECTIVE);
	});
});
