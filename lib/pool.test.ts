import { describe, expect, test } from "bun:test";
import { mapConcurrent } from "./pool.ts";

/** A promise the test releases by hand, so no timer or clock is involved. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

describe("mapConcurrent", () => {
	test("returns results in input order, not completion order", async () => {
		const result = await mapConcurrent([3, 1, 2], 2, async (item) => item * 10);
		expect(result).toEqual([30, 10, 20]);
	});

	test("never exceeds the limit in flight", async () => {
		const gate = deferred();
		const started: number[] = [];
		let inFlight = 0;
		let peak = 0;

		const pending = mapConcurrent([0, 1, 2, 3, 4], 2, async (item) => {
			started.push(item);
			inFlight++;
			peak = Math.max(peak, inFlight);
			await gate.promise;
			inFlight--;
			return item;
		});

		// The pool fills its width synchronously, then waits on the gate.
		expect(started).toEqual([0, 1]);
		expect(peak).toBe(2);

		gate.resolve();
		expect(await pending).toEqual([0, 1, 2, 3, 4]);
		expect(peak).toBe(2);
	});

	test("a limit of one serializes the work", async () => {
		const gate = deferred();
		const started: number[] = [];
		let inFlight = 0;
		let peak = 0;

		const pending = mapConcurrent([0, 1, 2], 1, async (item) => {
			started.push(item);
			inFlight++;
			peak = Math.max(peak, inFlight);
			await gate.promise;
			inFlight--;
			return item;
		});

		expect(started).toEqual([0]);
		gate.resolve();
		await pending;
		expect(peak).toBe(1);
	});

	test("a limit above the item count runs everything and keeps the order", async () => {
		let peak = 0;
		let inFlight = 0;
		const gate = deferred();
		const pending = mapConcurrent([0, 1, 2], 100, async (item) => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await gate.promise;
			inFlight--;
			return item;
		});
		expect(peak).toBe(3);
		gate.resolve();
		expect(await pending).toEqual([0, 1, 2]);
	});

	test("an empty input calls nothing", async () => {
		let calls = 0;
		const result = await mapConcurrent([], 4, async () => {
			calls++;
			return 0;
		});
		expect(result).toEqual([]);
		expect(calls).toBe(0);
	});

	test("a rejection stops new work and rejects with the original error", async () => {
		const gate = deferred();
		const failure = new Error("first failed");
		const started: number[] = [];

		const pending = mapConcurrent([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2, async (item) => {
			started.push(item);
			if (item === 0) throw failure;
			await gate.promise;
			return item;
		});

		// Only the width's worth of work was claimed; nothing new starts after that.
		expect(started).toEqual([0, 1]);
		gate.resolve();
		await expect(pending).rejects.toBe(failure);
		expect(started).toEqual([0, 1]);
	});
});
