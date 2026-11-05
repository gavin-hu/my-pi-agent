/**
 * Admission bookkeeping for the one conversation: the rolling-hour turn budget
 * and the serial admission chain.
 *
 * A burst of media messages must keep its arrival order and count against the
 * queue cap before its download completes, so a slot is reserved when the
 * message is accepted and the admissions run one after another. The budget is in
 * memory; a reload starts a fresh hour.
 *
 * A drain is the chat's `/stop` reaching a message the worker never saw: the
 * reservation, the download in flight, and the hand-off are all dropped, because
 * a stop that left one of them running would answer the burst it was told to
 * drop.
 */

import type { InboundItem } from "../types.ts";
import type { TurnState } from "./turn.ts";

/**
 * The conversation's state with the reservations counted as queued: a message still being
 * downloaded holds a slot and has no turn yet, so the cap, `/status`, the control screen, and
 * the doctor all read one depth.
 */
export function queuedWith(turn: TurnState | undefined, pending: number): TurnState {
	const current = turn ?? { status: "idle", queued: 0 };
	if (pending === 0) return current;
	const queued = current.queued + pending;
	return { ...current, queued, status: current.status === "running" ? "running" : "queued" };
}

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
	/**
	 * Resolve media and hand the message to the conversation. `live()` is false once a
	 * drain has dropped this admission, so an in-flight download must ask it before the
	 * hand-off: the message a stop took does not come back.
	 */
	admit: (item: InboundItem, live: () => boolean) => Promise<void>;
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
	/**
	 * Drop every admission waiting or in flight, and say how many there were. The
	 * reservations go with them, so the queue reports the room it really has, and the
	 * admissions still running stand down at their next `live()` rather than handing over.
	 */
	drain(): number;
	/** Drop the bookkeeping (a new connection). */
	reset(): void;
}

export function createAdmissionQueue(deps: AdmissionQueueDeps): AdmissionQueue {
	/** Messages being resolved (media download) before they reach the queue. */
	let admitting = 0;
	/**
	 * Bumped by every drain and every reset: an admission holds the generation it was
	 * reserved under, so one that outlives the burst it belonged to stands down instead
	 * of reaching a queue that has moved on. `reset` is a drain with nobody to report to.
	 */
	let generation = 0;
	/** The admission chain, so two media messages keep their arrival order. */
	let chain: Promise<void> = Promise.resolve();

	return {
		enqueue(item: InboundItem): void {
			const mine = generation;
			const live = (): boolean => mine === generation;
			admitting += 1;
			const previous = chain;
			const next = previous
				.then(async () => {
					// A drain between the reservation and this turn: the message went with the burst.
					if (live()) await deps.admit(item, live);
				})
				.catch((error) => {
					// One bad admission must not stall the chat's chain forever.
					deps.notify(
						`WeChat could not accept a message: ${error instanceof Error ? error.message : String(error)}`,
						"warning",
					);
				})
				.finally(() => {
					// A drained reservation is already accounted for by `drain`.
					if (live()) admitting = Math.max(0, admitting - 1);
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

		drain(): number {
			const dropped = admitting;
			admitting = 0;
			generation += 1;
			// The chain is cut here: the admissions it still holds are the ones just dropped, and
			// the next message must not queue behind a download nothing is going to use. The loop's
			// `settled()` resolving at once is the stop's report — the batch was answered, by dropping it.
			chain = Promise.resolve();
			return dropped;
		},

		reset(): void {
			admitting = 0;
			generation += 1;
			chain = Promise.resolve();
		},
	};
}
