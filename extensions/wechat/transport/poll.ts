/**
 * The long-poll loop for one account.
 *
 * Weixin holds a `getupdates` request for a server-chosen duration; the loop
 * feeds every returned message to the bridge, advances the stored cursor, and
 * keeps the poller lock fresh. A wedged request is retried at once with the same
 * cursor (nothing is skipped), a transport error backs off, an expired token
 * stops the loop, and an account another live session has taken over stops it too.
 *
 * The cursor is the batch's acknowledgement, so it moves only once the batch has
 * been handed over *and* the connection is still ours: a kill inside the hand-off,
 * or a close that interrupted it, leaves the old cursor and the next connection
 * reads the batch again.
 */

import type { BotCredentials, WeixinMessage } from "../types.ts";
import { isSessionExpired, rejectionOf, type WechatClient } from "./client.ts";
import { messageOf } from "../../../lib/errors.ts";
import { defaultTimer } from "../timer.ts";

const BACKOFF_MS = 2000;
/** Poll watchdog when the server has not told us its long-poll hold yet. */
const POLL_TIMEOUT_FALLBACK_MS = 90_000;
/** Never trust a server hint below this, so a busy loop cannot be papered over. */
const POLL_TIMEOUT_FLOOR_MS = 30_000;
/** Slack above the server's hold before a poll counts as wedged. */
const POLL_TIMEOUT_MARGIN_MS = 15_000;

/**
 * How long one `getupdates` request may hang before it is treated as wedged: the
 * server's own hold time plus a margin, so a half-open connection cannot stop
 * inbound traffic without a word.
 */
export function defaultPollTimeout(serverHintMs: number | undefined): number {
	return Math.max(serverHintMs ?? POLL_TIMEOUT_FALLBACK_MS, POLL_TIMEOUT_FLOOR_MS) + POLL_TIMEOUT_MARGIN_MS;
}

/** What the loop needs from the bridge; every value is read at call time. */
export interface PollDeps {
	client: () => WechatClient | undefined;
	account: () => BotCredentials | undefined;
	/** The server's requested hold, when the operator configured one. */
	holdMs: () => number | undefined;
	cursor: () => string;
	setCursor: (cursor: string) => void;
	saveState: () => void;
	sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
	notify: (message: string, kind?: "info" | "warning" | "error") => void;
	/** The token expired; the bridge clears its running state and reports it. */
	onExpired: () => void;
	/**
	 * Hand a batch over. Returning a promise holds the cursor back until the batch has
	 * really been taken, so a download still in flight cannot be acknowledged early.
	 */
	onMessages: (messages: WeixinMessage[]) => void | Promise<void>;
	/**
	 * Re-stamp the lock at the top of every attempt. It is also the ownership check: a
	 * bridge whose lock another live session took stops the connection here, which the
	 * `isRunning` question that follows reads as "no longer ours".
	 */
	refreshLock: () => void;
	/**
	 * Arm the lock heartbeat around this loop, and return the stop function. The stamp at the
	 * top of an attempt is not a heartbeat — one attempt is legitimately longer than the stale
	 * bar — so the record is re-stamped between attempts, and a beat that finds another
	 * session's record stops the connection just as that stamp does.
	 */
	startHeartbeat: () => () => void;
	isRunning: () => boolean;
	now: () => number;
	/** Report the last poll attempt, for the doctor/status. */
	onPoll?: (result: { at: number; error?: string; holdMs?: number }) => void;
	pollTimeout: (serverHintMs: number | undefined) => number;
}

/** The poll loop for one connection. */
export interface PollLoop {
	/** Run until `signal` aborts, the connection closes, or the token expires. */
	run(signal: AbortSignal): Promise<void>;
}

export function createPollLoop(deps: PollDeps): PollLoop {
	return {
		async run(signal: AbortSignal): Promise<void> {
			// The record is re-stamped on a timer for as long as this loop runs: one attempt can
			// outlast the stale bar, and a beat that finds a takeover ends the connection. The beat
			// stops before the loop's caller does anything else, so nothing releases a lock that a
			// late stamp could put back.
			const stopHeartbeat = deps.startHeartbeat();
			try {
				// The server tells us how long it held the last poll; remember it so the
				// watchdog can be tight instead of the generic fallback. It is remembered
				// with the hold it answered, because a hold the operator lowered since then
				// makes the old hint stale — the watchdog must tighten with the config.
				let hint: { hold: number | undefined; timeoutMs: number } | undefined;
				/** One notice per failure episode, so a flapping link is reported once. */
				let timeoutNotified = false;
				let rejectedNotified = false;
				let errorNotified = false;
				while (deps.isRunning() && !signal.aborted) {
					// Before the request, not after the answer: an account another live session has
					// taken over is not ours to read, and applying a response under a second cursor
					// is what answers the same peer twice. The stamp is the check, and a bridge
					// that finds the lock gone stops the connection while it runs, so this asks the
					// state again instead of sending a request nothing will use.
					deps.refreshLock();
					if (!deps.isRunning()) return;
					const client = deps.client();
					const account = deps.account();
					if (!client || !account) break;
					const hold = deps.holdMs();
					const watchdogMs = deps.pollTimeout(hint !== undefined && hint.hold === hold ? hint.timeoutMs : hold);
					// A cancellable watchdog: `AbortSignal.timeout` cannot be cleared, and a
					// pending timer per poll would keep the process awake long after the request
					// settled. The shared seam unrefs it, so a wedged poll never holds a
					// shutdown open either.
					const watchdog = new AbortController();
					const cancelWatchdog = defaultTimer(watchdogMs, () => watchdog.abort());
					let response;
					try {
						response = await client.getUpdates(account, deps.cursor(), AbortSignal.any([signal, watchdog.signal]), {
							holdMs: hold,
						});
					} catch (error) {
						if (signal.aborted || !deps.isRunning()) break;
						if (watchdog.signal.aborted) {
							deps.onPoll?.({
								at: deps.now(),
								error: `timed out after ${Math.round(watchdogMs / 1000)}s`,
							});
							// A wedged request, not a server answer: retry at once with the same
							// cursor, so nothing is skipped, and say so once.
							if (!timeoutNotified) {
								timeoutNotified = true;
								deps.notify(`WeChat poll timed out after ${Math.round(watchdogMs / 1000)}s; retrying.`, "warning");
							}
							continue;
						}
						deps.onPoll?.({ at: deps.now(), error: messageOf(error) });
						if (!errorNotified) {
							errorNotified = true;
							deps.notify(`WeChat poll failed: ${messageOf(error)}`, "warning");
						}
						try {
							await deps.sleep(BACKOFF_MS, signal);
						} catch {
							break;
						}
						continue;
					} finally {
						cancelWatchdog();
					}
					if (!response) break;
					if (response.timeoutMs !== undefined && response.timeoutMs > 0) {
						hint = { hold, timeoutMs: response.timeoutMs };
					}
					if (isSessionExpired(response)) {
						deps.onExpired();
						return;
					}
					const rejection = rejectionOf(response);
					if (rejection) {
						// A body-level rejection (bad cursor, rate limit, revoked token) is not an
						// empty poll: report it once and back off instead of hammering the API.
						if (!rejectedNotified) {
							rejectedNotified = true;
							deps.onPoll?.({ at: deps.now(), error: `rejected ret ${rejection.code}` });
							deps.notify(`WeChat poll rejected (ret ${rejection.code}); retrying.`, "warning");
						}
						try {
							await deps.sleep(BACKOFF_MS, signal);
						} catch {
							break;
						}
						continue;
					}
					timeoutNotified = false;
					rejectedNotified = false;
					errorNotified = false;
					// The account is ours to answer, or it is not: a heartbeat that found another
					// session's record stopped this connection while the request was parked, and handing
					// this batch over would answer a peer the new holder is about to answer too.
					if (!deps.isRunning()) return;
					// The hand-off first, the acknowledgement after it. A batch whose messages are
					// still downloading is not ours to acknowledge: the cursor is what makes the
					// server forget them, and a poller that dies holding it loses them for good.
					await deps.onMessages(response.msgs);
					// A close or a lost lock during the hand-off: keep the old cursor, so the next
					// connection reads the batch again. Intake's seen ids do not stand in the way,
					// because they are only persisted with the message's hand-off.
					if (!deps.isRunning()) return;
					const next = response.buf;
					if (next && next !== deps.cursor()) {
						deps.setCursor(next);
						deps.saveState();
					}
					deps.onPoll?.({ at: deps.now(), holdMs: hint !== undefined && hint.hold === hold ? hint.timeoutMs : hold });
				}
			} finally {
				stopHeartbeat();
			}
		},
	};
}
