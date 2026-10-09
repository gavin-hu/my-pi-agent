import { describe, expect, test } from "bun:test";
import { createTodoRuntime } from "./runtime.ts";
import type { Todo } from "./types.ts";

const pending = (content: string): Todo => ({ content, status: "pending" });
const completed = (content: string): Todo => ({ content, status: "completed" });

describe("TodoRuntime change notifications", () => {
	test("notifies subscribers when the list is set", () => {
		const runtime = createTodoRuntime();
		const seen: Todo[][] = [];
		runtime.onChange(() => seen.push(runtime.getTodos()));

		runtime.setTodos([pending("one")]);
		expect(seen).toEqual([[pending("one")]]);
	});

	test("notifies on reconstruct", () => {
		const runtime = createTodoRuntime();
		let calls = 0;
		runtime.onChange(() => calls++);
		runtime.reconstruct({ mode: "print", sessionManager: { getBranch: () => [] } } as any);
		expect(calls).toBe(1);
	});

	test("an unsubscribe stops delivery", () => {
		const runtime = createTodoRuntime();
		let calls = 0;
		const unsubscribe = runtime.onChange(() => calls++);
		runtime.setTodos([pending("one")]);
		unsubscribe();
		runtime.setTodos([pending("two")]);
		expect(calls).toBe(1);
	});

	test("every listener fires", () => {
		const runtime = createTodoRuntime();
		let first = 0;
		let second = 0;
		runtime.onChange(() => first++);
		const off = runtime.onChange(() => second++);
		runtime.setTodos([pending("one")]);
		expect([first, second]).toEqual([1, 1]);
		off();
	});
});

describe("TodoRuntime lag tracking", () => {
	test("a reminder is due after work on an open list, once", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([pending("one")]);
		runtime.noteWork();

		expect(runtime.nudgeDue()).toBe(true);
		runtime.markNudged();
		expect(runtime.nudgeDue()).toBe(false);
		expect(runtime.isNudgeActive()).toBe(true);
	});

	test("a todo update clears the lag but does not re-arm the reminder", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([pending("one")]);
		runtime.noteWork();
		runtime.markNudged();

		runtime.setTodos([pending("one"), pending("two")]);
		expect(runtime.nudgeDue()).toBe(false);

		// New work after the update is still capped by the same user turn.
		runtime.noteWork();
		expect(runtime.nudgeDue()).toBe(false);

		// A new user turn re-arms it.
		runtime.resetNudge();
		runtime.noteWork();
		expect(runtime.nudgeDue()).toBe(true);
	});

	test("no reminder is due for a fully completed list", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([completed("done")]);
		runtime.noteWork();
		expect(runtime.nudgeDue()).toBe(false);
	});

	test("resetNudge clears the window but leaves the reminder active", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([pending("one")]);
		runtime.noteWork();
		runtime.markNudged();

		runtime.resetNudge();
		expect(runtime.nudgeDue()).toBe(false);

		runtime.noteWork();
		expect(runtime.nudgeDue()).toBe(true);
		expect(runtime.isNudgeActive()).toBe(true);
	});

	test("deactivateNudge expires the reminder", () => {
		const runtime = createTodoRuntime();
		runtime.markNudged();
		runtime.deactivateNudge();
		expect(runtime.isNudgeActive()).toBe(false);
	});

	test("reconstruct clears the lag and the reminder", () => {
		const runtime = createTodoRuntime();
		runtime.setTodos([pending("one")]);
		runtime.noteWork();
		runtime.markNudged();

		runtime.reconstruct({ mode: "print", sessionManager: { getBranch: () => [] } } as any);
		expect(runtime.nudgeDue()).toBe(false);
		expect(runtime.isNudgeActive()).toBe(false);
	});
});
