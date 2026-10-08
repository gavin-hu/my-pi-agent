import { describe, expect, test } from "bun:test";
import { createTodoRuntime } from "../../extensions/todo/runtime.ts";
import type { Todo } from "../../extensions/todo/types.ts";

const pending = (content: string): Todo => ({ content, status: "pending" });

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
