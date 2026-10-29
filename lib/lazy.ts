/**
 * One async load, run at most once.
 *
 * A surface a command needs but registration does not — a browser page, a
 * review server, a screen — is imported through this: `get()` runs the loader
 * and remembers the value, and `peek()` answers the value already loaded, or
 * `undefined`, so a shutdown path never starts a load the session never used.
 *
 * A rejected load is not remembered. A transient failure can be retried, and a
 * caller that sees the error can ask again; the alternative would make one bad
 * import permanent for the process.
 *
 * State lives in this closure, not at module scope, because `lib/` is loaded
 * with isolated module caches and is value-only.
 */

/** A value loaded on first use, with a way to ask whether it is already here. */
export interface Lazy<T> {
	/** Load the value, or return the one already loaded; concurrent calls share one load. */
	get(): Promise<T>;
	/** The loaded value, or `undefined` before a load and after a failed one. */
	peek(): T | undefined;
}

export function lazy<T>(load: () => Promise<T>): Lazy<T> {
	let loaded = false;
	let value: T;
	let pending: Promise<T> | undefined;
	const get = (): Promise<T> => {
		if (loaded) return Promise.resolve(value);
		pending ??= load().then(
			(result) => {
				loaded = true;
				value = result;
				return result;
			},
			(error: unknown) => {
				pending = undefined;
				throw error;
			},
		);
		return pending;
	};
	return { get, peek: () => (loaded ? value : undefined) };
}
