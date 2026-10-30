/**
 * Fixture for the `lib/http/` suites.
 *
 * The server arms a timer for its grace window, and a sink arms one for its
 * keepalive; both are injected, so a suite drives the callback by hand rather than
 * waiting on a real clock. One double serves both, since what a suite asserts is the
 * same: how many timers were armed, and how many were cancelled.
 */

import type { ArmTimer } from "../../../lib/timer.ts";

/** A grace timer that only fires when the test says so, counting arms and cancellations. */
export function graceTimer(): { timer: ArmTimer; fire(): void; armed: number; cancelled: number } {
	let pending: (() => void) | undefined;
	const state = {
		armed: 0,
		cancelled: 0,
		timer: ((_ms: number, run: () => void) => {
			state.armed += 1;
			pending = run;
			return () => {
				state.cancelled += 1;
				pending = undefined;
			};
		}) as ArmTimer,
		fire: () => {
			const run = pending;
			pending = undefined;
			run?.();
		},
	};
	return state;
}
