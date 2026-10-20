import { describe, expect, test } from "bun:test";
import { createTimerMap, defaultTimer, type ArmTimer } from "./timer.ts";

describe("defaultTimer", () => {
	test("runs the callback once after the delay", async () => {
		let fired = 0;
		defaultTimer(1, () => {
			fired += 1;
		});
		await Bun.sleep(20);
		expect(fired).toBe(1);
	});

	test("never runs a cancelled timer", async () => {
		let fired = 0;
		const cancel = defaultTimer(1, () => {
			fired += 1;
		});
		cancel();
		await Bun.sleep(20);
		expect(fired).toBe(0);
	});
});

/** A timer seam a test fires by hand, recording what was armed and cancelled. */
function fakeTimers(): {
	arm: ArmTimer;
	fire(id: number): void;
	armed: number[];
	cancelled: number[];
	lastArmed(): number;
} {
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
		lastArmed: () => armed[armed.length - 1] ?? 0,
		fire(id) {
			const fn = pending.get(id);
			if (!fn) return;
			pending.delete(id);
			fn();
		},
	};
}

describe("createTimerMap", () => {
	test("arms a timer and forgets the entry before the callback runs", () => {
		const timers = fakeTimers();
		const map = createTimerMap(timers.arm);
		let pendingWhenFired: boolean | undefined;
		map.arm("alice", 1000, () => {
			pendingWhenFired = map.has("alice");
		});

		expect(map.has("alice")).toBe(true);
		timers.fire(timers.lastArmed());
		// A callback that re-arms itself (the typing keep-alive) relies on this.
		expect(pendingWhenFired).toBe(false);
		expect(map.has("alice")).toBe(false);
	});

	test("re-arming a key replaces the pending timer", () => {
		const timers = fakeTimers();
		const map = createTimerMap(timers.arm);
		let first = 0;
		let second = 0;
		map.arm("alice", 10, () => {
			first += 1;
		});
		const firstId = timers.lastArmed();
		map.arm("alice", 10, () => {
			second += 1;
		});

		expect(timers.cancelled).toEqual([firstId]);
		timers.fire(firstId);
		timers.fire(timers.lastArmed());
		expect(first).toBe(0);
		expect(second).toBe(1);
	});

	test("stop cancels and forgets only its own key", () => {
		const timers = fakeTimers();
		const map = createTimerMap(timers.arm);
		let fired = 0;
		map.arm("alice", 10, () => {
			fired += 1;
		});
		const alice = timers.lastArmed();
		map.arm("bob", 10, () => {
			fired += 1;
		});

		map.stop("alice");
		expect(map.has("alice")).toBe(false);
		expect(map.has("bob")).toBe(true);
		expect(timers.cancelled).toEqual([alice]);
		map.stop("alice");
		expect(timers.cancelled).toEqual([alice]);
	});

	test("keys lists only live entries", () => {
		const timers = fakeTimers();
		const map = createTimerMap(timers.arm);
		map.arm("alice", 10, () => {});
		map.arm("bob", 10, () => {});
		map.stop("alice");
		expect(map.keys()).toEqual(["bob"]);
	});

	test("clear cancels every pending timer", () => {
		const timers = fakeTimers();
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
});
