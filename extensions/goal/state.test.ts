import { describe, expect, test } from "bun:test";
import { isActiveGoal, openTodoCount, reconstructGoal } from "./state.ts";
import type { Goal } from "./types.ts";
import { resultEntry } from "../../test/helpers/fixtures/goal.ts";

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

describe("isActiveGoal", () => {
	test("is true only for an active goal", () => {
		expect(isActiveGoal(active("go"))).toBe(true);
		expect(isActiveGoal(achieved("go"))).toBe(false);
		expect(isActiveGoal(null)).toBe(false);
	});
});
