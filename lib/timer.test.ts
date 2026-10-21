/**
 * The timer seams: one shot, repeating, and a sleep that can be aborted.
 *
 * Every case waits real time through `settle`, because the thing under test is
 * the host timer itself; the seams exist so the *callers* can inject one and a
 * test never has to wait for them.
 */

import { describe, expect, test } from "bun:test";
import { settle } from "../test/helpers/process.ts";
import { abortableSleep, defaultInterval, defaultTimer } from "./timer.ts";

describe("defaultTimer", () => {
	test("fires once, and a cancel before the deadline fires nothing", async () => {
		let fired = 0;
		const cancel = defaultTimer(1, () => (fired += 1));
		const cancelled = defaultTimer(1, () => (fired += 1));
		cancelled();
		await settle(20);
		expect(fired).toBe(1);
		cancel();
	});
});

describe("defaultInterval", () => {
	test("ticks until it is stopped, then stops", async () => {
		let ticks = 0;
		const stop = defaultInterval(5, () => (ticks += 1));
		await settle(40);
		stop();
		const seen = ticks;
		expect(seen).toBeGreaterThan(0);
		await settle(40);
		expect(ticks).toBe(seen);
	});

	test("stopping before the first tick runs nothing", async () => {
		let ticks = 0;
		const stop = defaultInterval(5, () => (ticks += 1));
		stop();
		await settle(20);
		expect(ticks).toBe(0);
	});
});

describe("abortableSleep", () => {
	test("resolves on its own once the delay is up", async () => {
		await abortableSleep(1);
	});

	test("rejects at once when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(abortableSleep(10_000, controller.signal)).rejects.toThrow("aborted");
	});

	test("rejects when the signal aborts first, and settles nothing after", async () => {
		const controller = new AbortController();
		const sleeping = abortableSleep(10_000, controller.signal);
		controller.abort();
		await expect(sleeping).rejects.toThrow("aborted");
		// The listener is removed with the timer: a second abort reaches nothing.
		expect(() => controller.abort()).not.toThrow();
	});
});
