/**
 * Timing helpers for the capture scripts.
 *
 * Every capture waits on an external process (Terminal, Chrome, or a render's
 * frame file), so they share one sleep and one bounded poll instead of a
 * hand-rolled deadline loop per surface.
 */

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How long, and how often, a {@link pollUntil} call retries. */
export interface PollOptions {
	/** Give up after this long. */
	timeoutMs: number;
	/** Time between probes, in milliseconds. */
	intervalMs: number;
}

/**
 * Poll `probe` until it returns a defined value or the timeout elapses. Returns
 * the first value, or `undefined` on timeout, so the caller owns the error.
 */
export async function pollUntil<T>(probe: () => T | undefined, options: PollOptions): Promise<T | undefined> {
	const deadline = Date.now() + options.timeoutMs;
	for (;;) {
		const value = probe();
		if (value !== undefined) return value;
		if (Date.now() >= deadline) return undefined;
		await sleep(options.intervalMs);
	}
}
