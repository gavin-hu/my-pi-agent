/**
 * The published session state: the goal a branch carries, the todo list, and the
 * plan-mode flag.
 *
 * All three are replayed from untrusted branch entries, so the cases here are
 * about which write counts (a rejected call does not), what a malformed entry
 * does (nothing, rather than wiping a valid value), and the sanitizing a reader
 * applies before passing text onward.
 */

import { describe, expect, test } from "bun:test";
import { GOAL_ENTRY_TYPE, isPursuedGoal, lastGoal, MAX_GOAL_OBJECTIVE } from "./goal-state.ts";
import { PLAN_MODE_ENTRY_TYPE, isPlanModeEnabled } from "./plan-state.ts";
import { type ExistingTodo, lastTodos, MAX_CONTENT, MAX_TODOS, normalizeTodos, TODO_STATUSES } from "./todo-state.ts";
import { GOAL_TOOL, TODO_TOOL } from "./tool-names.ts";
import { toolResultEntry } from "../test/helpers/entries.ts";

// --- The published goal -----------------------------------------------------

/** A `goal` tool result entry on the branch, optionally a rejected one. */
function goalResult(goal: unknown, error?: string): unknown {
	return toolResultEntry(GOAL_TOOL, error === undefined ? { goal } : { goal, error });
}

/** A `/goal` command custom entry. */
function commandEntry(goal: unknown): unknown {
	return { type: "custom", customType: GOAL_ENTRY_TYPE, data: { goal } };
}

describe("lastGoal", () => {
	test("reads the goal a tool call wrote", () => {
		expect(lastGoal([goalResult({ objective: "ship it", status: "active" })])).toEqual({
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
			goalResult({ objective: "first", status: "active" }),
			commandEntry({ objective: "second", status: "achieved" }),
			goalResult({ objective: "third", status: "active" }),
		];
		expect(lastGoal(branch)?.objective).toBe("third");
	});

	test("skips a rejected call, which carries the unchanged goal", () => {
		const branch = [
			goalResult({ objective: "kept", status: "active" }),
			goalResult({ objective: "kept", status: "active" }, "objective is too long"),
		];
		expect(lastGoal(branch)?.objective).toBe("kept");
		// A lone rejected result is not a write at all.
		expect(lastGoal([goalResult({ objective: "kept", status: "active" }, "rejected")])).toBeNull();
	});

	test("honours an explicit clear", () => {
		expect(lastGoal([goalResult({ objective: "old", status: "active" }), commandEntry(null)])).toBeNull();
	});

	test("ignores a malformed entry instead of wiping a good goal", () => {
		const branch = [
			goalResult({ objective: "good", status: "active" }),
			goalResult({ objective: 42, status: "active" }),
			goalResult({ objective: "bad status", status: "doing" }),
			goalResult(null, "no goal"),
			{ type: "custom", customType: GOAL_ENTRY_TYPE, data: {} },
			{ type: "message", message: { role: "user", content: "hi" } },
		];
		expect(lastGoal(branch)?.objective).toBe("good");
	});

	test("ignores a result from another tool", () => {
		const branch = [
			goalResult({ objective: "mine", status: "active" }),
			toolResultEntry(TODO_TOOL, { goal: { objective: "theirs", status: "active" } }),
		];
		expect(lastGoal(branch)?.objective).toBe("mine");
	});

	test("returns a fresh goal rather than an alias of the stored value", () => {
		const stored = { objective: "original", status: "active" };
		const goal = lastGoal([goalResult(stored)]);
		expect(goal).not.toBeNull();
		goal!.objective = "mutated";
		expect(stored.objective).toBe("original");
	});

	test("ignores any malformed command payload", () => {
		const kept = goalResult({ objective: "kept", status: "active" });
		const malformed = ["nope", 42, true, [], null, undefined, {}, { goal: undefined }];
		for (const data of malformed) {
			const entry = { type: "custom", customType: GOAL_ENTRY_TYPE, data };
			expect(lastGoal([kept, entry])?.objective, JSON.stringify(data)).toBe("kept");
		}
	});

	test("ignores a blank or over-long objective", () => {
		expect(lastGoal([goalResult({ objective: "  ", status: "active" })])).toBeNull();
		expect(lastGoal([goalResult({ objective: "x".repeat(MAX_GOAL_OBJECTIVE + 1), status: "active" })])).toBeNull();
	});

	test("sanitizes the objective to one terminal-safe line", () => {
		const branch = [goalResult({ objective: "ship\u0001it\u001b[31m\nnow", status: "active" })];
		expect(lastGoal(branch)?.objective).toBe("ship it [31m now");
	});

	test("reports no goal for an empty branch", () => {
		expect(lastGoal([])).toBeNull();
	});
});

describe("isPursuedGoal", () => {
	test("pursues a goal being planned or executed", () => {
		expect(isPursuedGoal({ objective: "x", status: "planning" })).toBe(true);
		expect(isPursuedGoal({ objective: "x", status: "active" })).toBe(true);
	});

	test("does not pursue an achieved goal or no goal", () => {
		expect(isPursuedGoal({ objective: "x", status: "achieved" })).toBe(false);
		expect(isPursuedGoal(null)).toBe(false);
	});
});

// --- The todo list ----------------------------------------------------------

/** A session entry carrying one todo tool result, optionally rejected. */
function todoResult(todos: unknown, error?: string): unknown {
	return toolResultEntry(
		TODO_TOOL,
		error === undefined ? { todos, action: "write" } : { todos, action: "write", error },
	);
}

describe("normalizeTodos", () => {
	test("treats missing input as an empty list", () => {
		expect(normalizeTodos(undefined)).toEqual([]);
		expect(normalizeTodos(null)).toEqual([]);
		expect(normalizeTodos([])).toEqual([]);
	});

	test("keeps content and status, trimming content", () => {
		expect(normalizeTodos([{ content: "  Write tests  ", status: "pending" }])).toEqual([
			{ content: "Write tests", status: "pending" },
		]);
	});

	test("collapses whitespace runs so content stays on one line", () => {
		expect(normalizeTodos([{ content: "first\nsecond\tthird  fourth", status: "pending" }])).toEqual([
			{ content: "first second third fourth", status: "pending" },
		]);
	});

	test("strips control characters that could corrupt the terminal", () => {
		const [todo] = normalizeTodos([{ content: "safe\u001b[31mRED\u0007", status: "pending" }]);
		expect(todo.content).toBe("safe [31mRED");
	});

	test("rejects content that is only whitespace or control characters", () => {
		expect(() => normalizeTodos([{ content: "\n\t\u001b\u0007", status: "pending" }])).toThrow("content is required");
	});

	test("keeps a non-blank activeForm and drops a blank one", () => {
		const [withForm, withoutForm] = normalizeTodos([
			{ content: "Run tests", status: "in_progress", activeForm: "  Running tests  " },
			{ content: "Ship it", status: "pending", activeForm: "   " },
		]);
		expect(withForm.activeForm).toBe("Running tests");
		expect(withoutForm.activeForm).toBeUndefined();
	});

	test("sanitizes activeForm like content, dropping one made only of control characters", () => {
		const [sanitized] = normalizeTodos([
			{ content: "Run tests", status: "in_progress", activeForm: "Running\ntests\u001b[0m" },
		]);
		expect(sanitized.activeForm).toBe("Running tests [0m");

		const [dropped] = normalizeTodos([{ content: "Run tests", status: "pending", activeForm: "\u001b\u0007" }]);
		expect(dropped.activeForm).toBeUndefined();
	});

	test("rejects an in_progress item without an activeForm", () => {
		expect(() => normalizeTodos([{ content: "Run tests", status: "in_progress" }])).toThrow("activeForm is required");
		expect(() => normalizeTodos([{ content: "Run tests", status: "in_progress", activeForm: "   " }])).toThrow(
			"activeForm is required",
		);
	});

	test("rejects an over-long activeForm", () => {
		expect(() =>
			normalizeTodos([{ content: "Run tests", status: "in_progress", activeForm: "x".repeat(MAX_CONTENT + 1) }]),
		).toThrow(`activeForm is longer than ${MAX_CONTENT}`);
	});

	test("can accept a legacy in_progress item without an activeForm", () => {
		expect(normalizeTodos([{ content: "Run tests", status: "in_progress" }], { requireActiveForm: false })).toEqual([
			{ content: "Run tests", status: "in_progress" },
		]);
	});

	test("accepts every declared status, in any case", () => {
		for (const status of TODO_STATUSES) {
			const extra = status === "in_progress" ? { activeForm: "Doing it" } : {};
			for (const form of [status, status.toUpperCase()]) {
				expect(normalizeTodos([{ content: "A", status: form, ...extra }])[0].status, form).toBe(status);
			}
		}
	});

	test("allows a single in_progress item", () => {
		expect(
			normalizeTodos([
				{ content: "A", status: "completed" },
				{ content: "B", status: "in_progress", activeForm: "Doing B" },
				{ content: "C", status: "pending" },
			]),
		).toHaveLength(3);
	});

	test("rejects more than one in_progress item", () => {
		expect(() =>
			normalizeTodos([
				{ content: "A", status: "in_progress", activeForm: "Doing A" },
				{ content: "B", status: "in_progress", activeForm: "Doing B" },
			]),
		).toThrow("At most one todo may be in_progress");
	});

	test("rejects duplicate content case-insensitively", () => {
		expect(() =>
			normalizeTodos([
				{ content: "Write tests", status: "pending" },
				{ content: "write TESTS", status: "pending" },
			]),
		).toThrow("duplicate content");
	});

	test("rejects a missing description, an unknown status, and a non-array", () => {
		expect(() => normalizeTodos([{ content: "   ", status: "pending" }])).toThrow("content is required");
		expect(() => normalizeTodos([{ content: "A", status: "blocked" }])).toThrow("status must be one of");
		expect(() => normalizeTodos("nope")).toThrow("todos must be an array");
	});

	test("rejects over-long content", () => {
		expect(() => normalizeTodos([{ content: "x".repeat(MAX_CONTENT + 1), status: "pending" }])).toThrow(
			`longer than ${MAX_CONTENT}`,
		);
	});

	test("rejects too many items", () => {
		const items = Array.from({ length: MAX_TODOS + 1 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
		expect(() => normalizeTodos(items)).toThrow(`At most ${MAX_TODOS}`);
	});
});

describe("lastTodos", () => {
	const kept: ExistingTodo[] = [{ content: "Kept", status: "pending" }];

	test("returns the last list written on the branch", () => {
		const entries = [
			todoResult([{ content: "One", status: "pending" }]),
			todoResult([{ content: "Two", status: "completed" }]),
		];
		expect(lastTodos(entries)).toEqual([{ content: "Two", status: "completed" }]);
	});

	test("a rejected call does not change the list", () => {
		expect(lastTodos([todoResult(kept), todoResult([{ content: "Ignored", status: "pending" }], "too many")])).toEqual(
			kept,
		);
	});

	test("a malformed entry does not wipe a valid list", () => {
		const entries = [
			todoResult(kept),
			todoResult("not a list"),
			{ type: "message", message: { role: "toolResult", toolName: TODO_TOOL, details: null } },
		];
		expect(lastTodos(entries)).toEqual(kept);
	});

	test("ignores a write with one invalid item instead of partially applying it", () => {
		const entries = [
			todoResult(kept),
			todoResult([
				{ content: "Valid", status: "pending" },
				{ content: "", status: "pending" },
			]),
		];
		expect(lastTodos(entries)).toEqual(kept);
	});

	test("ignores a write with two in_progress items", () => {
		const entries = [
			todoResult(kept),
			todoResult([
				{ content: "A", status: "in_progress", activeForm: "Doing A" },
				{ content: "B", status: "in_progress", activeForm: "Doing B" },
			]),
		];
		expect(lastTodos(entries)).toEqual(kept);
	});

	test("a clear resets the state", () => {
		expect(lastTodos([todoResult(kept), todoResult([])])).toEqual([]);
	});

	test("ignores results from other tools", () => {
		const entries = [todoResult([{ content: "Mine", status: "pending" }]), toolResultEntry("bash", { todos: [] })];
		expect(lastTodos(entries)).toEqual([{ content: "Mine", status: "pending" }]);
	});

	test("ignores non-message and malformed entries", () => {
		const entries = [{ type: "label", targetId: "x" }, null, todoResult(kept)];
		expect(lastTodos(entries)).toEqual(kept);
	});

	test("trims and sanitizes stored content", () => {
		expect(lastTodos([todoResult([{ content: "  line one\nline two  ", status: "pending" }])])).toEqual([
			{ content: "line one line two", status: "pending" },
		]);
	});

	test("replays a legacy in_progress item without an activeForm", () => {
		expect(lastTodos([todoResult([{ content: "Running", status: "in_progress" }])])).toEqual([
			{ content: "Running", status: "in_progress" },
		]);
	});

	test("does not alias the stored list", () => {
		const stored = [{ content: "one", status: "pending" }];
		const result = lastTodos([todoResult(stored)]);
		result[0].content = "mutated";
		expect(stored[0].content).toBe("one");
	});
});

// --- The plan-mode flag -----------------------------------------------------

describe("isPlanModeEnabled", () => {
	/** One persisted plan-mode state entry. */
	function state(enabled: unknown): unknown {
		return { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled } };
	}

	test("is off for an empty or unrelated branch", () => {
		expect(isPlanModeEnabled([])).toBe(false);
		expect(
			isPlanModeEnabled([
				{ type: "message", id: "e1" },
				{ type: "custom", customType: "goal", data: { enabled: true } },
			]),
		).toBe(false);
	});

	test("follows the last valid entry on the branch", () => {
		expect(isPlanModeEnabled([state(true)])).toBe(true);
		expect(isPlanModeEnabled([state(true), state(false)])).toBe(false);
		expect(isPlanModeEnabled([state(false), state(true)])).toBe(true);
	});

	test("skips malformed entries instead of reading them as off", () => {
		expect(isPlanModeEnabled([state(true), state("yes")])).toBe(true);
		expect(isPlanModeEnabled([state(true), { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: null }])).toBe(
			true,
		);
		expect(isPlanModeEnabled([state(true), { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: {} }])).toBe(true);
		expect(isPlanModeEnabled([state(true), null, "nonsense"])).toBe(true);
	});
});
