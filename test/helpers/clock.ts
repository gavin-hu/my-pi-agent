/**
 * Deterministic clock for tests.
 *
 * Production code that reads the wall clock should take a `now: () => number`
 * seam; tests pass `clock.now`. `advance` moves time forward instead of
 * sleeping. Value-only: the returned closure owns its state, so a clock is
 * never shared between tests.
 */

export interface Clock {
	/** Current time in epoch milliseconds (or any fixed origin). */
	now(): number;
	/** Move forward by `ms` and return the new time. */
	advance(ms: number): number;
	/** Jump to an absolute time and return it. */
	set(ms: number): number;
}

/** Build an independent clock starting at `start` (default `0`). */
export function makeClock(start = 0): Clock {
	let current = start;
	return {
		now: () => current,
		advance: (ms) => (current += ms),
		set: (ms) => (current = ms),
	};
}
