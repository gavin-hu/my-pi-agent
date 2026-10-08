/**
 * Waiter bookkeeping for the `wait` action.
 *
 * `wait` registers a resolver per job; a job's completion (or a kill/clear)
 * wakes every waiter for that id. Kept separate from the runtime so the map and
 * its cleanup rules are testable on their own and the runtime holds one field.
 */

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
