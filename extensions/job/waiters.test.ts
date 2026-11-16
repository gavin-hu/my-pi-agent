import { describe, expect, jest, test } from "bun:test";
import { createWaiters, DEFAULT_WAIT_MS, effectiveWaitMs, MAX_WAIT_MS, waitFor } from "./waiters.ts";

describe("job waiters", () => {
	test("resolves every waiter for an id exactly once", async () => {
		const waiters = createWaiters();
		const seen: string[] = [];
		waiters.add("j1", () => seen.push("a"));
		waiters.add("j1", () => seen.push("b"));
		waiters.resolve("j1");
		waiters.resolve("j1");
		expect(seen.sort()).toEqual(["a", "b"]);
	});

	test("a removed waiter is not woken", async () => {
		const waiters = createWaiters();
		let fired = 0;
		const remove = waiters.add("j1", () => fired++);
		remove();
		waiters.resolve("j1");
		expect(fired).toBe(0);
	});

	test("resolveAll wakes every id", async () => {
		const waiters = createWaiters();
		let fired = 0;
		waiters.add("j1", () => fired++);
		waiters.add("j2", () => fired++);
		waiters.resolveAll();
		expect(fired).toBe(2);
	});

	test("the block a request buys is never past the cap", () => {
		expect(effectiveWaitMs(undefined)).toBe(DEFAULT_WAIT_MS);
		expect(effectiveWaitMs(5_000)).toBe(5_000);
		expect(effectiveWaitMs(MAX_WAIT_MS)).toBe(MAX_WAIT_MS);
		expect(effectiveWaitMs(900_000)).toBe(MAX_WAIT_MS);
	});

	test("a wait that asked past the cap reports both blocks", async () => {
		jest.useFakeTimers();
		try {
			const pending = waitFor(createWaiters(), "j1", { timeoutMs: 900_000 });
			jest.advanceTimersByTime(MAX_WAIT_MS);
			expect(await pending).toEqual({
				timedOut: true,
				cancelled: false,
				capped: { askedMs: 900_000, usedMs: MAX_WAIT_MS },
			});
		} finally {
			jest.useRealTimers();
		}
	});

	test("a wait inside the cap names no cap", async () => {
		jest.useFakeTimers();
		try {
			const pending = waitFor(createWaiters(), "j1", { timeoutMs: 5_000 });
			jest.advanceTimersByTime(5_000);
			expect(await pending).toEqual({ timedOut: true, cancelled: false });
		} finally {
			jest.useRealTimers();
		}
	});
});
