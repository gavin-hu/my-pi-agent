/**
 * Cross-extension ordering: the goal rail must stay above the todo rail.
 *
 * Pi renders above-editor widgets in insertion order and re-inserts on every
 * set, so a goal update would otherwise sink the goal below the list. The goal
 * announces on `pi.events` and the list re-asserts, pinning it to the bottom.
 * These tests drive both extensions on one fake Pi and inspect the order of
 * `setWidget` calls, which is the render order.
 */

import { describe, expect, test } from "bun:test";
import goal from "../extensions/goal/index.ts";
import { TOOL_NAME as GOAL_TOOL } from "../extensions/goal/tools.ts";
import type { Goal } from "../extensions/goal/types.ts";
import todo from "../extensions/todo/index.ts";
import { TOOL_NAME as TODO_TOOL } from "../extensions/todo/tools.ts";
import type { Todo } from "../extensions/todo/types.ts";
import { createFakePi, emit } from "./helpers/fakes.ts";
import { fakeCtx } from "./goal/helpers.ts";

const GOAL_WIDGET = "goal-widget";
const TODO_WIDGET = "todo-widget";

const active = (objective: string): Goal => ({ objective, status: "active" });
const pending = (content: string): Todo => ({ content, status: "pending" });

/** A stored `goal` tool-result entry. */
function goalEntry(value: Goal): unknown {
	return {
		type: "message",
		message: {
			role: "toolResult",
			toolName: GOAL_TOOL,
			details: { goal: value, action: value.status === "achieved" ? "achieve" : "set" },
		},
	};
}

/** A stored `todo` tool-result entry. */
function todoEntry(todos: Todo[]): unknown {
	return {
		type: "message",
		message: { role: "toolResult", toolName: TODO_TOOL, details: { todos, action: "write" } },
	};
}

/** Load both extensions on one Pi, in the given order. */
function setup(order: "todo-first" | "goal-first" = "todo-first") {
	const { pi, tools } = createFakePi();
	if (order === "todo-first") {
		todo(pi);
		goal(pi);
	} else {
		goal(pi);
		todo(pi);
	}
	return { pi, tools };
}

function keys(calls: Array<{ key: string }>): string[] {
	return calls.map((call) => call.key);
}

describe("goal above todo ordering", () => {
	test("session start ends with the todo rail re-asserted below the goal", async () => {
		const { pi } = setup();
		const { ctx, widgetCalls } = fakeCtx({
			mode: "tui",
			branch: [goalEntry(active("ship it")), todoEntry([pending("one")])],
		});

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		const order = keys(widgetCalls);
		expect(order.at(-2)).toBe(GOAL_WIDGET);
		expect(order.at(-1)).toBe(TODO_WIDGET);
	});

	test("holds whichever extension registers first", async () => {
		const { pi } = setup("goal-first");
		const { ctx, widgetCalls } = fakeCtx({
			mode: "tui",
			branch: [goalEntry(active("ship it")), todoEntry([pending("one")])],
		});

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(keys(widgetCalls).at(-1)).toBe(TODO_WIDGET);
	});

	test("a goal update re-appends the goal, then the list re-asserts below it", async () => {
		const { pi, tools } = setup();
		const { ctx, widgetCalls } = fakeCtx({
			mode: "tui",
			branch: [goalEntry(active("ship it")), todoEntry([pending("one")])],
		});
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		const before = widgetCalls.length;

		await tools.get(GOAL_TOOL).execute("call-1", { objective: "ship v2" }, undefined, undefined, ctx);

		// Exactly two new calls: the goal set, then the list re-asserted.
		const added = keys(widgetCalls.slice(before));
		expect(added).toEqual([GOAL_WIDGET, TODO_WIDGET]);
	});

	test("a todo update is already appended last", async () => {
		const { pi, tools } = setup();
		const { ctx, widgetCalls } = fakeCtx({
			mode: "tui",
			branch: [goalEntry(active("ship it")), todoEntry([pending("one")])],
		});
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		const before = widgetCalls.length;

		await tools.get(TODO_TOOL).execute("call-1", { todos: [pending("two")] }, undefined, undefined, ctx);

		expect(keys(widgetCalls.slice(before))).toEqual([TODO_WIDGET]);
	});

	test("does not announce on a non-TUI session", async () => {
		const { pi } = setup();
		const { ctx, widgetCalls } = fakeCtx({
			mode: "print",
			branch: [goalEntry(active("ship it")), todoEntry([pending("one")])],
		});

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(widgetCalls).toHaveLength(0);
	});
});
