/**
 * The repaint clock on its own: when it arms, when it stops, and what a tick and
 * a paint each do.
 *
 * The runtime's cases that observe the clock through a running job — a
 * reattached pid polled on a tick, a chip re-asserted after something cleared it
 * — stay in `runtime.test.ts`, because they are about the poll, not about the
 * timer.
 */

import { describe, expect, test } from "bun:test";
import type { RepeatTimer } from "../../lib/timer.ts";
import { createRepaintClock, type RepaintClockDeps } from "./clock.ts";

/** A repeating timer a test fires by hand. */
function fakeInterval() {
	const armed: Array<{ ms: number; fire: () => void }> = [];
	let cancelled = 0;
	const interval: RepeatTimer = (ms, tick) => {
		armed.push({ ms, fire: tick });
		return () => {
			cancelled++;
		};
	};
	return { interval, armed, cancelled: () => cancelled };
}

/** Deps over one fake timer, with every call recorded. */
function harness(overrides: Partial<RepaintClockDeps> = {}) {
	const timer = fakeInterval();
	const calls: string[] = [];
	const clock = createRepaintClock({
		repaintMs: () => 25,
		running: () => true,
		disposed: () => false,
		touchMarker: () => calls.push("marker"),
		tick: () => calls.push("tick"),
		repaint: () => calls.push("repaint"),
		interval: timer.interval,
		...overrides,
	});
	return { clock, timer, calls };
}

describe("repaint clock", () => {
	test("arms one timer at the configured interval while a job runs", () => {
		const { clock, timer } = harness();

		clock.ensure();
		clock.ensure();

		expect(timer.armed).toHaveLength(1);
		expect(timer.armed[0]?.ms).toBe(25);
	});

	test("a tick is the caller's tick", () => {
		const { clock, timer, calls } = harness();

		clock.ensure();
		timer.armed[0]?.fire();

		expect(calls).toEqual(["tick"]);
	});

	test("arms nothing when no job is running", () => {
		const { clock, timer } = harness({ running: () => false });

		clock.ensure();

		expect(timer.armed).toEqual([]);
	});

	test("stops an armed timer once nothing is running", () => {
		let running = true;
		const { clock, timer } = harness({ running: () => running });

		clock.ensure();
		running = false;
		clock.ensure();

		expect(timer.cancelled()).toBe(1);
	});

	test("arms nothing once the runtime is disposed", () => {
		const { clock, timer } = harness({ disposed: () => true });

		clock.ensure();

		expect(timer.armed).toEqual([]);
	});

	test("paint arms the clock, touches the marker, then repaints", () => {
		const { clock, calls } = harness();

		clock.paint();

		expect(calls).toEqual(["marker", "repaint"]);
	});

	test("paint touches the marker but does not repaint when disposed", () => {
		const { clock, calls } = harness({ disposed: () => true });

		clock.paint();

		expect(calls).toEqual(["marker"]);
	});

	test("stop cancels the armed timer and leaves nothing pending", () => {
		const { clock, timer } = harness();
		clock.ensure();

		clock.stop();

		expect(timer.cancelled()).toBe(1);
	});
});
