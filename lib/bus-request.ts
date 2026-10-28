/**
 * The request/response handshake each caller runs over `pi.events`.
 *
 * Pi loads every extension with its own module cache, so one extension cannot call
 * another: `plan` is asked to enter plan mode, `session-bus` to join the team, and
 * `serve` to hand a page a prefix — each on a channel, each with a payload of its own.
 * What they share is not the question but the answer's two guarantees: it settles
 * exactly once, and a caller with no listener is told so rather than left waiting.
 *
 * The refusal stays with the caller: this module never names an extension, a tool, or
 * a sentence. Value-only, as `lib/` must be: the state is the caller's bus and one
 * closure.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * What a listener answers with: the value, or the promise of one it has not got yet.
 *
 * An owner may have to bind a socket, start a bus, or read a repository before it
 * knows the answer, and the *claim* is the answer, not the result — so it hands back
 * the promise and stays claimed while it works, rather than leaving the caller to
 * guess whether anyone is there.
 */
export type BusAnswer<T> = T | Promise<T>;

/** One question for one channel. */
export interface BusRequest<T, P> {
	/** The `pi.events` channel the owner answers on. */
	channel: string;
	/**
	 * The object it reads, with `respond` given beside it: the helper supplies the one
	 * answer a request has, so no listener can answer twice and no caller can settle
	 * its own request.
	 */
	payload(respond: (answer: BusAnswer<T>) => void): P;
	/**
	 * The answer when no listener claimed the request — the sentence that names the
	 * extension which is not loaded. Settled on the microtask after the emit, because
	 * a listener claims synchronously or not at all.
	 */
	unclaimed(): T;
	/**
	 * The answer when a listener claimed the request and then failed; defaults to
	 * {@link unclaimed}, which reads the same to a caller that cannot tell why.
	 */
	failed?(error: unknown): T;
}

/**
 * Ask `request`'s channel for its answer, and settle once.
 *
 * Resolves the claimant's answer — including one it is still producing — or
 * {@link BusRequest.unclaimed} when nobody claimed the request, so a session running
 * without that extension reports a sentence instead of hanging.
 */
export function requestOverBus<T, P>(pi: Pick<ExtensionAPI, "events">, request: BusRequest<T, P>): Promise<T> {
	return new Promise<T>((resolve) => {
		let claimed = false;
		let settled = false;
		const settle = (answer: T): void => {
			if (settled) return;
			settled = true;
			resolve(answer);
		};
		const respond = (answer: BusAnswer<T>): void => {
			if (claimed) return;
			claimed = true;
			// A claim that is still binding answers later, so its failure needs one place to
			// become the sentence the caller reports rather than an unhandled rejection.
			Promise.resolve(answer).then(settle, (error: unknown) => {
				const failed = request.failed;
				settle(failed === undefined ? request.unclaimed() : failed(error));
			});
		};
		pi.events.emit(request.channel, request.payload(respond));
		// A listener claims synchronously or not at all, so a request nothing claimed is one
		// no extension is listening for.
		queueMicrotask(() => {
			if (!claimed) settle(request.unclaimed());
		});
	});
}
