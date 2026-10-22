/**
 * The usage counters this package accounts in.
 *
 * A session, a delegated child run, and a priced record are all measured in the
 * same five numbers, so the list lives here rather than in each caller:
 * bytefly's footer accumulates them for the session and for its `↳` roll-up, and
 * `subagent` accumulates them from a child's JSON events.
 *
 * `turns` and the context size are deliberately not counters — one is counted
 * per message, the other is a window occupancy rather than something to sum — so
 * each owner tracks those beside these.
 */

/** The counters, in the order a usage line prints them. */
export const USAGE_COUNTERS = ["input", "output", "cacheRead", "cacheWrite", "cost"] as const;

/** One counter in a usage accumulator. */
export type UsageCounter = (typeof USAGE_COUNTERS)[number];

/** A usage accumulator: one running total per counter. */
export type UsageCounts = Record<UsageCounter, number>;

/** A zeroed accumulator, ready to sum into. */
export function zeroUsage(): UsageCounts {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}
