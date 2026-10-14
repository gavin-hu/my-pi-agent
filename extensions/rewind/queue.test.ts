import { describe, expect, test } from "bun:test";
import { createOperationQueue } from "./queue.ts";

describe("createOperationQueue", () => {
	test("runs operations in order, even when a later one is ready first", async () => {
		const queue = createOperationQueue();
		const order: number[] = [];
		await Promise.all([
			queue.enqueue(async () => {
				await Bun.sleep(20);
				order.push(1);
			}),
			queue.enqueue(async () => {
				order.push(2);
			}),
			queue.enqueue(async () => {
				order.push(3);
			}),
		]);
		expect(order).toEqual([1, 2, 3]);
	});

	test("a rejected operation does not break the chain and rejects its caller", async () => {
		const queue = createOperationQueue();
		const order: number[] = [];
		await expect(
			queue.enqueue(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await queue.enqueue(async () => {
			order.push(1);
		});
		expect(order).toEqual([1]);
	});

	test("returns the operation's value", async () => {
		const queue = createOperationQueue();
		await expect(queue.enqueue(async () => 42)).resolves.toBe(42);
	});
});
