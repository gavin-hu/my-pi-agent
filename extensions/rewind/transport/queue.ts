/**
 * The serialized git operation queue.
 *
 * `GIT_INDEX_FILE` is applied to `process.env` for the duration of a git call
 * (see `lib/git/runner.ts`), which is process-wide. Every operation that stages
 * through a temporary index therefore runs through one queue, so two of them
 * cannot interleave. Read-only listings never set the index and need not queue.
 */

export interface OperationQueue {
	/** Run `fn` after every previously enqueued operation, in order. */
	enqueue<T>(fn: () => Promise<T>): Promise<T>;
}

export function createOperationQueue(): OperationQueue {
	let tail: Promise<unknown> = Promise.resolve();
	return {
		enqueue<T>(fn: () => Promise<T>): Promise<T> {
			const next = tail.then(fn, fn);
			tail = next.then(
				() => undefined,
				() => undefined,
			);
			return next;
		},
	};
}
