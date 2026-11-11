/**
 * The request/response handshake each caller runs over `pi.events`.
 *
 * Pi loads every extension with its own module cache, so one extension cannot call
 * another: `plan` is asked to enter plan mode, `session-bus` to join the team, and
 * `serve` to hand a page a prefix — each on a channel, each with a payload of its own.
 * What they share is not the question but the answer's three guarantees: it settles
 * exactly once, a caller with no listener is told so rather than left waiting, and a
 * listener that claims the question and then never answers is bounded rather than
 * hanging the call that asked.
 *
 * The refusal stays with the caller: this module never names an extension, a tool, or
 * a sentence. Value-only, as `lib/` must be: the state is the caller's bus and one
 * closure.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// A type-only import, so this module adds no timer seam to any entry's registration graph
// (`test/dependencies.test.ts`): the bound's one timer is built here, below.
import type { ArmTimer } from "./timer.ts";

/**
 * How long a claim may go unanswered before the caller is given its own sentence back.
 *
 * Generous on purpose: a claim binds a socket, writes mail files, or reads a repository, and a
 * bound that fires while the owner is working would turn a slow answer into a failure. The
 * listeners all answer today, so this is the guard against the one failure mode with no end,
 * not a schedule they are expected to meet.
 */
export const ANSWER_BOUND_MS = 10_000;

/**
 * The production bound's timer, cleared when the request settles.
 *
 * Not `lib/timer.ts`'s `defaultTimer`: that one is `unref`'d, and a bound whose timer the event
 * loop may drop is a bound that can leave a caller waiting again. This one is never `unref`'d and
 * is cancelled by {@link requestOverBus} the moment the request ends, which is the same rule
 * `abortableSleep` states for its sleep — a wait that exists on purpose keeps the process alive
 * until it is over.
 */
const boundTimer: ArmTimer = (ms, fn) => {
	const timer = setTimeout(fn, ms);
	return () => clearTimeout(timer);
};

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
	/**
	 * The answer when a listener claimed the request and never answered it, within
	 * {@link ANSWER_BOUND_MS}; defaults to {@link unclaimed}.
	 *
	 * A caller that pre-checked its owner is loaded gives its own sentence here: the bound can
	 * only fire while that owner is on, so "not loaded" would send a reader to switch on an
	 * extension that is already running.
	 */
	timedOut?(): T;
}

/** The seams a suite drives instead of the host: the bound's timer, and nothing else. */
export interface BusRequestSeams {
	/** How the bound is armed; a `setTimeout` cleared on settle unless a suite supplies one. */
	timer?: ArmTimer;
}

/**
 * Ask `request`'s channel for its answer, and settle once.
 *
 * Resolves the claimant's answer — including one it is still producing — or
 * {@link BusRequest.unclaimed} when nobody claimed the request, so a session running
 * without that extension reports a sentence instead of hanging. A claim that outlives
 * {@link ANSWER_BOUND_MS} settles on {@link BusRequest.timedOut}, because a listener that
 * claimed and never answered is the one case with no other way out.
 */
export function requestOverBus<T, P>(
	pi: Pick<ExtensionAPI, "events">,
	request: BusRequest<T, P>,
	seams: BusRequestSeams = {},
): Promise<T> {
	return new Promise<T>((resolve) => {
		let claimed = false;
		let settled = false;
		let cancel: (() => void) | undefined;
		const settle = (answer: T): void => {
			if (settled) return;
			settled = true;
			cancel?.();
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
		// Armed before the emit, because a listener may answer while `emit` runs: a bound armed
		// after it would be a timer racing an answer that had already settled.
		cancel = (seams.timer ?? boundTimer)(ANSWER_BOUND_MS, () => {
			settle(request.timedOut?.() ?? request.unclaimed());
		});
		pi.events.emit(request.channel, request.payload(respond));
		// A listener claims synchronously or not at all, so a request nothing claimed is one
		// no extension is listening for.
		queueMicrotask(() => {
			if (!claimed) settle(request.unclaimed());
		});
	});
}
