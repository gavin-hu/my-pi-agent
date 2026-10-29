/**
 * The lazy seam: one load, shared by concurrent callers, and a failure that can
 * be retried.
 */

import { describe, expect, test } from "bun:test";
import { lazy } from "./lazy.ts";

describe("lazy", () => {
	test("loads once for concurrent and later callers", async () => {
		let loads = 0;
		const value = lazy(async () => {
			loads += 1;
			await Promise.resolve();
			return { id: loads };
		});
		const [first, second] = await Promise.all([value.get(), value.get()]);
		const third = await value.get();
		expect(loads).toBe(1);
		expect(first).toBe(second);
		expect(third).toBe(first);
	});

	test("peek answers undefined until the value is loaded", async () => {
		const value = lazy(async () => "loaded");
		expect(value.peek()).toBeUndefined();
		await value.get();
		expect(value.peek()).toBe("loaded");
	});

	test("a rejected load is forgotten, so the next call retries", async () => {
		let attempts = 0;
		const value = lazy(async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("first attempt failed");
			return "loaded";
		});
		await expect(value.get()).rejects.toThrow("first attempt failed");
		expect(value.peek()).toBeUndefined();
		expect(await value.get()).toBe("loaded");
		expect(attempts).toBe(2);
	});
});
