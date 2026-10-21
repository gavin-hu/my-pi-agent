/**
 * The timer seams: one shot, repeating, and a sleep that can be aborted.
 *
 * Extensions need the same three things, and each has the same two properties a
 * test cares about: it is cancellable, and its production default never holds
 * the process open. The WeChat bridge arms a one-shot per acknowledgement,
 * typing keep-alive, and prompt timeout; plan's review page arms one for the
 * closed-tab grace; `job` and `watch` repaint on a repeating one; the browse
 * live channel needs both; `job`, `watch`, `check`, `subagent`, and `wechat`
 * sleep between polls. Keeping the defaults here means one definition of "arm
 * it, and let it be cancelled", and one place where the `unref` lives.
 *
 * Value-only: types and constant functions, no module state.
 */

/** Arm a one-shot timer; the returned function cancels it. */
export type ArmTimer = (ms: number, fn: () => void) => () => void;

/** The production timer: `setTimeout`, detached from the event loop. */
export const defaultTimer: ArmTimer = (ms, fn) => {
	const timer = setTimeout(fn, ms);
	(timer as { unref?: () => void }).unref?.();
	return () => clearTimeout(timer);
};

/** Arm a repeating timer; the returned function stops it. */
export type RepeatTimer = (ms: number, tick: () => void) => () => void;

/** The production ticker: `setInterval`, detached from the event loop. */
export const defaultInterval: RepeatTimer = (ms, tick) => {
	const timer = setInterval(tick, ms);
	(timer as { unref?: () => void }).unref?.();
	return () => clearInterval(timer);
};

/**
 * Resolve after `ms`, or reject when `signal` aborts first.
 *
 * The one rejection is `Error("aborted")` whatever the signal carries, so a
 * caller that names its own abort error maps one case rather than inspecting a
 * reason. The timer is cleared on both paths and never `unref`'d: a sleep exists
 * to keep the caller waiting, so nothing else is pending to keep the process
 * alive, and an unref'd one could be dropped mid-wait.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new Error("aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
