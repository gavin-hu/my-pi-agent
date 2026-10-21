import { describe, expect, test } from "bun:test";
import { openTodoCount, reconstructGoal, settledGoal } from "./state.ts";
import type { Goal } from "./types.ts";
import { resultEntry } from "../../test/helpers/fixtures/goal.ts";

const planning = (objective: string): Goal => ({ objective, status: "planning" });
const active = (objective: string): Goal => ({ objective, status: "active" });
const achieved = (objective: string): Goal => ({ objective, status: "achieved" });

/** A session entry carrying one todo tool result. */
function todoResult(todos: unknown): unknown {
	return { type: "message", message: { role: "toolResult", toolName: "todo", details: { todos, action: "write" } } };
}

describe("reconstructGoal", () => {
	// The replay rules live in `lib/goal-state.ts` and are tested there; this
	// proves the extension reads the branch through that one contract.
	test("reads the last goal written on the branch", () => {
		expect(reconstructGoal([resultEntry(active("first")), resultEntry(achieved("second"))])).toEqual(
			achieved("second"),
		);
	});

	test("reads a command entry and honours an explicit clear", () => {
		const command = { type: "custom", customType: "goal", data: { goal: active("from command") } };
		expect(reconstructGoal([command])).toEqual(active("from command"));
		expect(reconstructGoal([resultEntry(active("one")), resultEntry(null)])).toBeNull();
	});

	test("returns null for an empty branch", () => {
		expect(reconstructGoal([])).toBeNull();
	});

	test("reads the planning phase off the branch", () => {
		expect(reconstructGoal([resultEntry(planning("design it"))])).toEqual(planning("design it"));
		const command = { type: "custom", customType: "goal", data: { goal: planning("from command") } };
		expect(reconstructGoal([command])).toEqual(planning("from command"));
	});
});

describe("openTodoCount", () => {
	test("counts only the items the list still has open", () => {
		const branch = [
			todoResult([
				{ content: "Close the docs", status: "completed" },
				{ content: "Ship the parser", status: "in_progress" },
				{ content: "Write the notes", status: "pending" },
			]),
		];
		expect(openTodoCount(branch)).toBe(2);
	});

	test("is zero without a list", () => {
		expect(openTodoCount([])).toBe(0);
	});
});

describe("settledGoal", () => {
	test("promotes a planning goal once plan mode is off", () => {
		expect(settledGoal(planning("ship it"), false)).toEqual(active("ship it"));
	});

	test("leaves a planning goal alone while plan mode is on", () => {
		expect(settledGoal(planning("ship it"), true)).toBeNull();
	});

	test("never rewrites a final goal", () => {
		expect(settledGoal(active("ship it"), false)).toBeNull();
		expect(settledGoal(achieved("ship it"), false)).toBeNull();
		expect(settledGoal(null, false)).toBeNull();
	});
});
