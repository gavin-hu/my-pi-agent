/**
 * Per-peer admission bookkeeping: the rolling-hour turn budget and the serial
 * admission chain.
 *
 * A burst of media messages must keep its arrival order and count against the
 * queue cap before its download completes, so a slot is reserved when the
 * message is accepted and each peer's admissions run one after another. The
 * budget is in memory; a reload starts a fresh hour.
 */

import type { InboundItem } from "../types.ts";
import { peerKey } from "../text/format.ts";

/** A rolling-hour turn budget per peer. */
export interface TurnBudget {
	/** Reserve a turn; false when the peer has used its hourly allowance. */
	allow(peer: string): boolean;
	/** Drop every counter (a new connection). */
	reset(): void;
}

export function createTurnBudget(limit: number, now: () => number): TurnBudget {
	const turnTimes = new Map<string, number[]>();
	return {
		allow(peer: string): boolean {
			if (limit <= 0) return true;
			const key = peerKey(peer);
			const at = now();
			const cutoff = at - 60 * 60 * 1000;
			const times = (turnTimes.get(key) ?? []).filter((entry) => entry >= cutoff);
			if (times.length >= limit) {
				turnTimes.set(key, times);
				return false;
			}
			times.push(at);
			turnTimes.set(key, times);
			return true;
		},
		reset(): void {
			turnTimes.clear();
		},
	};
}

export interface AdmissionQueueDeps {
	/** Resolve media and hand the message to the peer's session. */
	admit: (item: InboundItem) => Promise<void>;
	/** A message that could not be admitted at all. */
	notify: (message: string, kind?: "info" | "warning" | "error") => void;
}

/** The per-peer serial admission chain. */
export interface AdmissionQueue {
	/** Reserve a slot and admit in arrival order. */
	enqueue(item: InboundItem): void;
	/** Slots reserved but not yet queued (downloads in flight). */
	pending(peer: string): number;
	/** Drop the bookkeeping (a new connection). */
	reset(): void;
}

export function createAdmissionQueue(deps: AdmissionQueueDeps): AdmissionQueue {
	/** Messages being resolved (media download) before they reach the queue. */
	const admitting = new Map<string, number>();
	/** Per-peer admission chain, so two media messages keep their arrival order. */
	const chains = new Map<string, Promise<void>>();

	return {
		enqueue(item: InboundItem): void {
			const peer = item.peer;
			admitting.set(peer, (admitting.get(peer) ?? 0) + 1);
			const previous = chains.get(peer) ?? Promise.resolve();
			const next = previous
				.then(async () => {
					await deps.admit(item);
				})
				.catch((error) => {
					// One bad admission must not stall the peer's chain forever.
					deps.notify(
						`WeChat could not accept a message: ${error instanceof Error ? error.message : String(error)}`,
						"warning",
					);
				})
				.finally(() => {
					const left = (admitting.get(peer) ?? 1) - 1;
					if (left > 0) admitting.set(peer, left);
					else admitting.delete(peer);
				});
			chains.set(peer, next);
			void next.finally(() => {
				if (chains.get(peer) === next) chains.delete(peer);
			});
		},

		pending(peer: string): number {
			return admitting.get(peer) ?? 0;
		},

		reset(): void {
			admitting.clear();
			chains.clear();
		},
	};
}
