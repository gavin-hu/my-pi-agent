/**
 * Cross-extension ordering for the above-editor rails: goal / todo.
 *
 * Pi renders above-editor widgets in insertion order and re-inserts on every
 * set, so an update to an upper rail would otherwise sink it below the rails
 * under it. The rails chain on `pi.events`: goal announces and todo re-asserts
 * (the bottom rail). These tests drive both extensions on one fake Pi and
 * replay the `setWidget` calls into the effective render order.
 */

import { describe, expect, test } from "bun:test";
import goal from "../extensions/goal/index.ts";
import { TOOL_NAME as GOAL_TOOL } from "../extensions/goal/tools.ts";
import type { Goal } from "../extensions/goal/types.ts";
import { setRailsSuppressed } from "../extensions/_shared/rails.ts";
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

type Rail = "goal" | "todo";

/** Load the extensions on one Pi, in the given order. */
function setup(order: Rail[] = ["goal", "todo"]) {
	const { pi, tools } = createFakePi();
	for (const rail of order) {
		if (rail === "goal") goal(pi);
		else todo(pi);
	}
	return { pi, tools };
}

/**
 * Replay `setWidget` calls the way Pi mounts them: setting a key moves it to the
 * end, and an `undefined` content removes it. The result is the visible order,
 * top to bottom.
 */
function renderOrder(calls: Array<{ key: string; content: unknown }>): string[] {
	const order: string[] = [];
	for (const call of calls) {
		const existing = order.indexOf(call.key);
		if (existing !== -1) order.splice(existing, 1);
		if (call.content !== undefined) order.push(call.key);
	}
	return order;
}

const sessionBranch = (): unknown[] => [goalEntry(active("ship it")), todoEntry([pending("one")])];
const CANONICAL = [GOAL_WIDGET, TODO_WIDGET];

describe("rail ordering: goal / todo", () => {
	const loadOrders: Rail[][] = [
		["goal", "todo"],
		["todo", "goal"],
	];

	for (const order of loadOrders) {
		test(`session start renders goal/todo for load order ${order.join(">")}`, async () => {
			const { pi } = setup(order);
			const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: sessionBranch() });

			await emit(pi, "session_start", { reason: "startup" }, ctx);

			expect(renderOrder(widgetCalls)).toEqual(CANONICAL);
		});
	}

	test("a goal update keeps goal above todo", async () => {
		const { pi, tools } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: sessionBranch() });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		await tools.get(GOAL_TOOL).execute("call-1", { objective: "ship v2" }, undefined, undefined, ctx);

		expect(renderOrder(widgetCalls)).toEqual(CANONICAL);
	});

	test("a todo update keeps todo below goal", async () => {
		const { pi, tools } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: sessionBranch() });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		await tools.get(TODO_TOOL).execute("call-1", { todos: [pending("two")] }, undefined, undefined, ctx);

		expect(renderOrder(widgetCalls)).toEqual(CANONICAL);
	});

	test("does not set any widget on a non-TUI session", async () => {
		const { pi } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "print", branch: sessionBranch() });

		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(widgetCalls).toHaveLength(0);
	});
});

describe("rail suppression while a dock screen is open", () => {
	async function started() {
		const { pi } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: sessionBranch() });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		expect(renderOrder(widgetCalls)).toEqual(CANONICAL);
		return { pi, widgetCalls };
	}

	test("hides every rail while suppressed and restores them in order", async () => {
		const { pi, widgetCalls } = await started();

		setRailsSuppressed(pi, true);
		expect(renderOrder(widgetCalls)).toEqual([]);

		setRailsSuppressed(pi, false);
		expect(renderOrder(widgetCalls)).toEqual(CANONICAL);
	});

	test("stays hidden until the last nested screen closes", async () => {
		const { pi, widgetCalls } = await started();

		setRailsSuppressed(pi, true);
		setRailsSuppressed(pi, true);
		setRailsSuppressed(pi, false);
		expect(renderOrder(widgetCalls)).toEqual([]);

		setRailsSuppressed(pi, false);
		expect(renderOrder(widgetCalls)).toEqual(CANONICAL);
	});
});
