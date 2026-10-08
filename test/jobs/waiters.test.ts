import { describe, expect, test } from "bun:test";
import { createWaiters } from "../../extensions/jobs/waiters.ts";

describe("waiters", () => {
	test("resolves every waiter for an id exactly once", () => {
		const waiters = createWaiters();
		const seen: string[] = [];
		waiters.add("j1", () => seen.push("a"));
		waiters.add("j1", () => seen.push("b"));
		waiters.resolve("j1");
		waiters.resolve("j1");
		expect(seen.sort()).toEqual(["a", "b"]);
	});

	test("a removed waiter is not woken", () => {
		const waiters = createWaiters();
		let fired = 0;
		const remove = waiters.add("j1", () => fired++);
		remove();
		waiters.resolve("j1");
		expect(fired).toBe(0);
	});

	test("resolveAll wakes every id", () => {
		const waiters = createWaiters();
		let fired = 0;
		waiters.add("j1", () => fired++);
		waiters.add("j2", () => fired++);
		waiters.resolveAll();
		expect(fired).toBe(2);
	});
});
