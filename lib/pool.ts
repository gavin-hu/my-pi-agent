/**
 * Bounded concurrency for a fan-out over I/O.
 *
 * A directory listing and a managed-worktree status sweep both run one small
 * read per entry — a `stat`, a git query — and each read is dominated by
 * waiting, not by work. Run strictly in sequence, a directory of three thousand
 * files pays three thousand round trips; run all at once, it hands the
 * filesystem (or a git index lock) an unbounded burst. This is the middle: at
 * most `limit` calls in flight, results in input order.
 *
 * The first rejection stops new work and is rethrown once every worker has
 * settled, so a failure cannot leave a rejected promise unobserved.
 *
 * Value-only: one pure function over its arguments, no module state.
 */

/**
 * Run `fn` over `items` with at most `limit` calls in flight, in input order.
 *
 * `limit` is clamped to `[1, items.length]`, so a caller may pass a configured
 * width without guarding it. `fn` receives the item and its index; the returned
 * array is in `items` order regardless of completion order. An empty input never
 * calls `fn`.
 */
export async function mapConcurrent<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const total = items.length;
	if (total === 0) return [];
	const width = Math.min(Math.max(1, Math.floor(limit)), total);
	const results = new Array<R>(total);

	let next = 0;
	let failed = false;
	let failure: unknown;

	/** Take the next unclaimed index and run it; stop taking after a failure. */
	const worker = async (): Promise<void> => {
		for (;;) {
			if (failed) return;
			const index = next++;
			if (index >= total) return;
			try {
				results[index] = await fn(items[index], index);
			} catch (error) {
				// Keep the first failure: a later one is a consequence of the work
				// already in flight, not the cause the caller needs to read.
				if (!failed) {
					failed = true;
					failure = error;
				}
				return;
			}
		}
	};

	await Promise.all(Array.from({ length: width }, worker));
	if (failed) throw failure;
	return results;
}
