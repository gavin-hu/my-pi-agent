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
