/**
 * The `wait` action: waiter bookkeeping, and the promise a caller waits on.
 *
 * `wait` registers a resolver per job; a job's completion (or a kill/clear)
 * wakes every waiter for that id. Kept separate from the runtime so the map and
 * its cleanup rules are testable on their own and the runtime holds one field.
 * The race the caller sees — the record, the timeout, or an abort — is here for
 * the same reason: it is bookkeeping, not a decision about a record.
 */

/** Default `wait` timeout, for a caller that names none. */
export const DEFAULT_WAIT_MS = 30_000;

/** Why a `wait` stopped waiting; the caller reads the record itself. */
export interface WaitOutcome {
	timedOut: boolean;
	cancelled: boolean;
}

/** Resolvers waiting on a job id. */
export interface Waiters {
	/** Register `resolve` for `id`; returns a function that removes it again. */
	add(id: string, resolve: () => void): () => void;
	/** Wake and drop every waiter for `id`. */
	resolve(id: string): void;
	/** Wake and drop every waiter. */
	resolveAll(): void;
}

export function createWaiters(): Waiters {
	const sets = new Map<string, Set<() => void>>();

	const resolve = (id: string): void => {
		const set = sets.get(id);
		if (!set) return;
		sets.delete(id);
		for (const wake of set) wake();
	};

	return {
		add(id, wake) {
			const set = sets.get(id) ?? new Set<() => void>();
			set.add(wake);
			sets.set(id, set);
			return () => {
				const current = sets.get(id);
				if (!current) return;
				current.delete(wake);
				if (current.size === 0) sets.delete(id);
			};
		},
		resolve,
		resolveAll() {
			for (const id of [...sets.keys()]) resolve(id);
		},
	};
}

/**
 * Resolve when `id` settles, or when the timeout or the abort signal wins.
 *
 * One promise, one cleanup: the timer is cleared, the abort listener removed, and
 * the waiter dropped, whichever of the three settles it.
 */
export function waitFor(
	waiters: Waiters,
	id: string,
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<WaitOutcome> {
	return new Promise<WaitOutcome>((resolve) => {
		let settled = false;
		let remove = (): void => {};
		const finish = (timedOut: boolean, cancelled: boolean): void => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			remove();
			resolve({ timedOut, cancelled });
		};
		const resolveWaiter = (): void => finish(false, false);
		const onAbort = (): void => finish(false, true);
		const timer = setTimeout(() => finish(true, false), options.timeoutMs ?? DEFAULT_WAIT_MS);

		remove = waiters.add(id, resolveWaiter);
		if (options.signal?.aborted) onAbort();
		else options.signal?.addEventListener("abort", onAbort, { once: true });
	});
}
