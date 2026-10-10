/**
 * Cross-extension "keep the machine awake" hold contract.
 *
 * An extension that needs the host awake while it keeps something open (for
 * example the WeChat bridge holding a long poll) cannot import `keep-awake`:
 * extensions load with isolated module caches. It announces a hold on the
 * shared `pi.events` bus instead, and `keep-awake` treats any live hold as a
 * reason to hold its OS inhibitor.
 *
 * The channel and payload are the contract shared by both sides; the set of
 * live owners lives in `keep-awake`'s closure, never here (`lib/` is
 * value-only). This mirrors the caller-owned state pattern in `rails.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** EventBus channel: an owner acquired or released a wake hold. */
export const WAKE_HOLD_CHANNEL = "my-pi-agent/wake-hold";

/** Which owner holds, and whether it just acquired (`true`) or released. */
export interface WakeHoldEvent {
	/** Stable id of the holder, e.g. `"wechat"`. */
	owner: string;
	/** `true` while the owner needs the machine awake. */
	held: boolean;
}

/** Announce that `owner` needs the machine kept awake. */
export function requestWakeHold(pi: Pick<ExtensionAPI, "events">, owner: string): void {
	pi.events.emit(WAKE_HOLD_CHANNEL, { owner, held: true } satisfies WakeHoldEvent);
}

/** Announce that `owner` no longer needs the machine kept awake. */
export function releaseWakeHold(pi: Pick<ExtensionAPI, "events">, owner: string): void {
	pi.events.emit(WAKE_HOLD_CHANNEL, { owner, held: false } satisfies WakeHoldEvent);
}

/** Reject a foreign or malformed payload rather than trusting it. */
function isWakeHoldEvent(data: unknown): data is WakeHoldEvent {
	if (typeof data !== "object" || data === null) return false;
	const event = data as Partial<WakeHoldEvent>;
	return typeof event.owner === "string" && event.owner.length > 0 && typeof event.held === "boolean";
}

/** Run `handler` for each well-formed hold change; returns an unsubscribe. */
export function onWakeHoldChange(
	pi: Pick<ExtensionAPI, "events">,
	handler: (event: WakeHoldEvent) => void,
): () => void {
	return pi.events.on(WAKE_HOLD_CHANNEL, (data) => {
		if (isWakeHoldEvent(data)) handler(data);
	});
}
