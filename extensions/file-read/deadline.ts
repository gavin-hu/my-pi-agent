/**
 * A per-call deadline for one in-process extraction.
 *
 * A parser is a library call, not a subprocess: JavaScript cannot preempt a
 * synchronous parse, so the deadline stops *waiting* for the work and discards
 * its result rather than killing it. What it guarantees is the turn: a
 * pathological file fails with the limit named instead of parking the session,
 * and a late settle from the abandoned promise never surfaces.
 *
 * The timer is a plain `setTimeout` cleared in `finally` (unlike
 * `AbortSignal.timeout`, whose timer cannot be cancelled and would stay pending
 * after every fast read). The deadline is deliberately not passed into `work`:
 * the caller's abort signal is the only abort an extractor sees, so a timeout
 * can never be reported as a turn abort or the reverse.
 */

/** How the deadline reports, and when to give up. */
export interface DeadlineOptions {
	/** Milliseconds to wait before abandoning the work. */
	timeoutMs: number;
	/** The error message a timeout throws; the caller names its own limit. */
	timeoutMessage: string;
	/** The turn's abort signal; an abort wins over the deadline. */
	signal?: AbortSignal;
}

/**
 * Run `work` with a deadline. Resolves with its value, rethrows its error
 * unchanged, or rejects with `timeoutMessage` (or the caller's abort reason).
 */
export async function withDeadline<T>(work: () => Promise<T>, options: DeadlineOptions): Promise<T> {
	const { timeoutMs, timeoutMessage, signal } = options;

	let timer: ReturnType<typeof setTimeout> | undefined;
	const expiry = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
		// A pending timer must not keep a short-lived process alive.
		(timer as { unref?: () => void }).unref?.();
	});

	let onAbort: (() => void) | undefined;
	const aborted = signal
		? new Promise<never>((_resolve, reject) => {
				onAbort = () => reject(signal.reason ?? new Error("aborted"));
				if (signal.aborted) onAbort();
				else signal.addEventListener("abort", onAbort, { once: true });
			})
		: undefined;

	const pending = work();
	// One observed promise: if the deadline or the abort wins, a late resolve or
	// rejection from the abandoned work has nobody left to reach.
	pending.catch(() => {});

	try {
		return await Promise.race(aborted ? [pending, expiry, aborted] : [pending, expiry]);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal?.removeEventListener("abort", onAbort);
	}
}
