/**
 * The timer map: one cancellable timer per key, forgotten before its callback runs
 * so the callback may re-arm itself, as the typing keep-alive does.
 */

import { describe, expect, test } from "bun:test";
import { createTimerMap, defaultSleep, type ArmTimer } from "./timer.ts";

describe("timer map", () => {
	function scriptedArm() {
		const pending = new Map<number, () => void>();
		const armed: number[] = [];
		const cancelled: number[] = [];
		let next = 1;
		const arm: ArmTimer = (_ms, fn) => {
			const id = next++;
			pending.set(id, fn);
			armed.push(id);
			return () => {
				if (pending.delete(id)) cancelled.push(id);
			};
		};
		return {
			arm,
			armed,
			cancelled,
			last: () => armed.at(-1) ?? 0,
			fire(id: number) {
				const fn = pending.get(id);
				if (!fn) return;
				pending.delete(id);
				fn();
			},
		};
	}

	test("arms a timer and forgets the entry before the callback runs", () => {
		const timers = scriptedArm();
		const map = createTimerMap(timers.arm);
		let pendingWhenFired: boolean | undefined;
		map.arm("alice", 1000, () => {
			pendingWhenFired = map.has("alice");
		});

		expect(map.has("alice")).toBe(true);
		timers.fire(timers.last());
		// A callback that re-arms itself (the typing keep-alive) relies on this.
		expect(pendingWhenFired).toBe(false);
		expect(map.has("alice")).toBe(false);
	});

	test("re-arming a key replaces the pending timer", () => {
		const timers = scriptedArm();
		const map = createTimerMap(timers.arm);
		let first = 0;
		let second = 0;
		map.arm("alice", 10, () => {
			first += 1;
		});
		const firstId = timers.last();
		map.arm("alice", 10, () => {
			second += 1;
		});

		expect(timers.cancelled).toEqual([firstId]);
		timers.fire(firstId);
		timers.fire(timers.last());
		expect(first).toBe(0);
		expect(second).toBe(1);
	});

	test("stop cancels and forgets only its own key", () => {
		const timers = scriptedArm();
		const map = createTimerMap(timers.arm);
		let fired = 0;
		map.arm("alice", 10, () => {
			fired += 1;
		});
		const alice = timers.last();
		map.arm("bob", 10, () => {
			fired += 1;
		});

		map.stop("alice");
		expect(map.has("alice")).toBe(false);
		expect(map.has("bob")).toBe(true);
		expect(timers.cancelled).toEqual([alice]);
		map.stop("alice");
		expect(timers.cancelled).toEqual([alice]);
		expect(map.keys()).toEqual(["bob"]);
	});

	test("clear cancels every pending timer", () => {
		const timers = scriptedArm();
		const map = createTimerMap(timers.arm);
		let fired = 0;
		for (const key of ["alice", "bob", "carol"]) {
			map.arm(key, 10, () => {
				fired += 1;
			});
		}
		const ids = [...timers.armed];

		map.clear();
		expect(timers.cancelled).toEqual(ids);
		expect(map.keys()).toEqual([]);
		for (const id of ids) timers.fire(id);
		expect(fired).toBe(0);
	});

	test("defaultSleep rejects at once for an already aborted signal", async () => {
		await expect(defaultSleep(60_000, AbortSignal.abort())).rejects.toThrow("aborted");
	});
});
