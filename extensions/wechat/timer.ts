/**
 * The timer seam shared by the bridge and the remote-prompt channel.
 *
 * Both need a cancellable one-shot timer that a test can drive without waiting:
 * the bridge for the delayed acknowledgement and the typing keep-alive, the
 * channel for the prompt timeout. The default is a real `setTimeout`, `unref`'d
 * so a pending timer never holds the process open.
 */

/** Arm a one-shot timer; the returned function cancels it. */
export type ArmTimer = (ms: number, fn: () => void) => () => void;

/** The production timer: `setTimeout`, detached from the event loop. */
export const defaultTimer: ArmTimer = (ms, fn) => {
	const timer = setTimeout(fn, ms);
	(timer as { unref?: () => void }).unref?.();
	return () => clearTimeout(timer);
};
