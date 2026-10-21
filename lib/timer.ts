/**
 * The one-shot timer seam.
 *
 * Two extensions need the same thing: a cancellable timer a test can drive
 * without waiting, whose production default never holds the process open. The
 * WeChat bridge arms one per acknowledgement, typing keep-alive, and prompt
 * timeout; plan's review page arms one for the closed-tab grace. Keeping the
 * default here means one definition of "arm it, and let it be cancelled", and
 * one place where the `unref` lives.
 *
 * Value-only: a type and a constant function, no module state.
 */

/** Arm a one-shot timer; the returned function cancels it. */
export type ArmTimer = (ms: number, fn: () => void) => () => void;

/** The production timer: `setTimeout`, detached from the event loop. */
export const defaultTimer: ArmTimer = (ms, fn) => {
	const timer = setTimeout(fn, ms);
	(timer as { unref?: () => void }).unref?.();
	return () => clearTimeout(timer);
};
