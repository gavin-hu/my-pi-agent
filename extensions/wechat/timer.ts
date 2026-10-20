/**
 * The timer seams shared by the bridge, the remote-prompt channel, and login.
 *
 * The bridge and the channel need a cancellable one-shot timer that a test can
 * drive without waiting (the delayed acknowledgement, the typing keep-alive, the
 * prompt timeout); login needs an abortable sleep between polls. The defaults use
 * a real `setTimeout`, `unref`'d for the one-shot so a pending timer never holds
 * the process open.
 */

/** Arm a one-shot timer; the returned function cancels it. */
export type ArmTimer = (ms: number, fn: () => void) => () => void;

/** The production timer: `setTimeout`, detached from the event loop. */
export const defaultTimer: ArmTimer = (ms, fn) => {
	const timer = setTimeout(fn, ms);
	(timer as { unref?: () => void }).unref?.();
	return () => clearTimeout(timer);
};

/**
 * A set of one-shot timers keyed by a caller's id (a peer, a watcher).
 *
 * Every per-key timer in this extension follows the same protocol: cancel any
 * pending entry, delete it, then act — and re-arming must replace, or a refresh
 * loop would stack timers. Both rules live here so they are one implementation.
 */
export interface TimerMap {
	/** Arm a timer for `key`, replacing a pending one. */
	arm(key: string, ms: number, fn: () => void): void;
	/** Whether a timer is pending for `key`. */
	has(key: string): boolean;
	/** Cancel and forget `key`'s timer. */
	stop(key: string): void;
	/** The keys with a pending timer. */
	keys(): string[];
	/** Cancel every pending timer and forget them. */
	clear(): void;
}

/** A {@link TimerMap} over the injected seam; the entries live in this closure. */
export function createTimerMap(arm: ArmTimer): TimerMap {
	const pending = new Map<string, () => void>();
	const map: TimerMap = {
		arm(key, ms, fn) {
			map.stop(key);
			// The entry is gone before the callback runs, so a callback that re-arms
			// itself (a keep-alive) or asks `has(key)` sees the truth rather than itself.
			pending.set(
				key,
				arm(ms, () => {
					pending.delete(key);
					fn();
				}),
			);
		},
		has(key) {
			return pending.has(key);
		},
		stop(key) {
			const cancel = pending.get(key);
			if (cancel === undefined) return;
			pending.delete(key);
			cancel();
		},
		keys() {
			return [...pending.keys()];
		},
		clear() {
			// A copy: a canceller is free to touch the map it came from.
			for (const cancel of [...pending.values()]) cancel();
			pending.clear();
		},
	};
	return map;
}

/** An abortable sleep: resolves after `ms`, rejects when `signal` aborts. */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
