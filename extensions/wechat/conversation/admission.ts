/**
 * Admission bookkeeping for the one conversation: the rolling-hour turn budget
 * and the serial admission chain.
 *
 * A burst of media messages must keep its arrival order and count against the
 * queue cap before its download completes, so a slot is reserved when the
 * message is accepted and the admissions run one after another. The budget is in
 * memory; a reload starts a fresh hour.
 */

import type { InboundItem } from "../types.ts";

/** A rolling-hour turn budget for the conversation. */
export interface TurnBudget {
	/** Reserve a turn; false when the hour's allowance is spent. */
	allow(): boolean;
	/** Drop every counter (a new connection). */
	reset(): void;
}

export function createTurnBudget(limit: number, now: () => number): TurnBudget {
	let turnTimes: number[] = [];
	return {
		allow(): boolean {
			if (limit <= 0) return true;
			const at = now();
			const cutoff = at - 60 * 60 * 1000;
			turnTimes = turnTimes.filter((entry) => entry >= cutoff);
			if (turnTimes.length >= limit) return false;
			turnTimes.push(at);
			return true;
		},
		reset(): void {
			turnTimes = [];
		},
	};
}

export interface AdmissionQueueDeps {
	/** Resolve media and hand the message to the conversation. */
	admit: (item: InboundItem) => Promise<void>;
	/** A message that could not be admitted at all. */
	notify: (message: string, kind?: "info" | "warning" | "error") => void;
}

/** The serial admission chain. */
export interface AdmissionQueue {
	/** Reserve a slot and admit in arrival order. */
	enqueue(item: InboundItem): void;
	/** Slots reserved but not yet queued (downloads in flight). */
	pending(): number;
	/** Resolves once every admission in flight right now has finished. */
	settled(): Promise<void>;
	/** Drop the bookkeeping (a new connection). */
	reset(): void;
}

export function createAdmissionQueue(deps: AdmissionQueueDeps): AdmissionQueue {
	/** Messages being resolved (media download) before they reach the queue. */
	let admitting = 0;
	/** The admission chain, so two media messages keep their arrival order. */
	let chain: Promise<void> = Promise.resolve();

	return {
		enqueue(item: InboundItem): void {
			admitting += 1;
			const previous = chain;
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
					admitting = Math.max(0, admitting - 1);
				});
			chain = next;
		},

		pending(): number {
			return admitting;
		},

		/**
		 * The tails, which wait on everything ahead of them in their own chain: the poll
		 * loop awaits this before it acknowledges a batch, so a message still downloading
		 * cannot be counted as read.
		 */
		settled(): Promise<void> {
			return chain.then(() => undefined);
		},

		reset(): void {
			admitting = 0;
			chain = Promise.resolve();
		},
	};
}
