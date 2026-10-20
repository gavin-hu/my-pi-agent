import { describe, expect, test } from "bun:test";
import { GOAL_ENTRY_TYPE, lastGoal, MAX_GOAL_OBJECTIVE } from "./goal-state.ts";
import { GOAL_TOOL } from "./tool-names.ts";

/** A `goal` tool result entry on the branch. */
function toolResult(goal: unknown, error?: string): unknown {
	return {
		type: "message",
		message: { role: "toolResult", toolName: GOAL_TOOL, details: error === undefined ? { goal } : { goal, error } },
	};
}

/** A `/goal` command custom entry. */
function commandEntry(goal: unknown): unknown {
	return { type: "custom", customType: GOAL_ENTRY_TYPE, data: { goal } };
}

describe("lastGoal", () => {
	test("reads the goal a tool call wrote", () => {
		expect(lastGoal([toolResult({ objective: "ship it", status: "active" })])).toEqual({
			objective: "ship it",
			status: "active",
		});
	});

	test("reads the goal a command wrote", () => {
		expect(lastGoal([commandEntry({ objective: "ship it", status: "achieved" })])).toEqual({
			objective: "ship it",
			status: "achieved",
		});
	});

	test("keeps the last write, whether tool or command", () => {
		const branch = [
			toolResult({ objective: "first", status: "active" }),
			commandEntry({ objective: "second", status: "achieved" }),
			toolResult({ objective: "third", status: "active" }),
		];
		expect(lastGoal(branch)?.objective).toBe("third");
	});

	test("skips a rejected call, which carries the unchanged goal", () => {
		const branch = [
			toolResult({ objective: "kept", status: "active" }),
			toolResult({ objective: "kept", status: "active" }, "objective is too long"),
		];
		expect(lastGoal(branch)?.objective).toBe("kept");
		// A lone rejected result is not a write at all.
		expect(lastGoal([toolResult({ objective: "kept", status: "active" }, "rejected")])).toBeNull();
	});

	test("honours an explicit clear", () => {
		const branch = [toolResult({ objective: "old", status: "active" }), commandEntry(null)];
		expect(lastGoal(branch)).toBeNull();
	});

	test("ignores a malformed entry instead of wiping a good goal", () => {
		const branch = [
			toolResult({ objective: "good", status: "active" }),
			toolResult({ objective: 42, status: "active" }),
			toolResult({ objective: "bad status", status: "doing" }),
			toolResult(null, "no goal"),
			{ type: "custom", customType: GOAL_ENTRY_TYPE, data: {} },
			{ type: "message", message: { role: "user", content: "hi" } },
		];
		expect(lastGoal(branch)?.objective).toBe("good");
	});

	test("ignores a result from another tool", () => {
		const branch = [
			toolResult({ objective: "mine", status: "active" }),
			{
				type: "message",
				message: { role: "toolResult", toolName: "todo", details: { goal: { objective: "theirs", status: "active" } } },
			},
		];
		expect(lastGoal(branch)?.objective).toBe("mine");
	});

	test("returns a fresh goal rather than an alias of the stored value", () => {
		const stored = { objective: "original", status: "active" };
		const goal = lastGoal([toolResult(stored)]);
		goal!.objective = "mutated";
		expect(stored.objective).toBe("original");
	});

	test("ignores any malformed command payload", () => {
		const kept = toolResult({ objective: "kept", status: "active" });
		const malformed = ["nope", 42, true, [], null, undefined, {}, { goal: undefined }];
		for (const data of malformed) {
			expect(lastGoal([kept, { type: "custom", customType: GOAL_ENTRY_TYPE, data }])?.objective).toBe("kept");
		}
	});

	test("ignores a blank or over-long objective", () => {
		const blank = [toolResult({ objective: "  ", status: "active" })];
		expect(lastGoal(blank)).toBeNull();
		const long = [toolResult({ objective: "x".repeat(MAX_GOAL_OBJECTIVE + 1), status: "active" })];
		expect(lastGoal(long)).toBeNull();
	});

	test("sanitizes the objective to one terminal-safe line", () => {
		const branch = [toolResult({ objective: "ship\u0001it\u001b[31m\nnow", status: "active" })];
		expect(lastGoal(branch)?.objective).toBe("ship it [31m now");
	});

	test("reports no goal for an empty branch", () => {
		expect(lastGoal([])).toBeNull();
	});
});
