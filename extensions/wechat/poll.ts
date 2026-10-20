/**
 * The long-poll loop for one account.
 *
 * Weixin holds a `getupdates` request for a server-chosen duration; the loop
 * feeds every returned message to the bridge, advances the stored cursor, and
 * keeps the poller lock fresh. A wedged request is retried at once with the same
 * cursor (nothing is skipped), a transport error backs off, and an expired token
 * stops the loop.
 */

import type { BotCredentials, WeixinMessage } from "./types.ts";
import { isSessionExpired, rejectionOf, type WechatClient } from "./client.ts";
import { messageOf } from "./errors.ts";
import { defaultTimer } from "./timer.ts";

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
	onMessages: (messages: WeixinMessage[]) => void;
	refreshLock: () => void;
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
			// The server tells us how long it holds a poll; remember it so the watchdog
			// can be tight instead of the generic fallback.
			let serverHint: number | undefined;
			/** One notice per failure episode, so a flapping link is reported once. */
			let timeoutNotified = false;
			let rejectedNotified = false;
			while (deps.isRunning() && !signal.aborted) {
				const client = deps.client();
				const account = deps.account();
				if (!client || !account) break;
				const watchdogMs = deps.pollTimeout(serverHint ?? deps.holdMs());
				// A cancellable watchdog: `AbortSignal.timeout` cannot be cleared, and a
				// pending timer per poll would keep the process awake long after the request
				// settled. The shared seam unrefs it, so a wedged poll never holds a
				// shutdown open either.
				const watchdog = new AbortController();
				const cancelWatchdog = defaultTimer(watchdogMs, () => watchdog.abort());
				let response;
				try {
					response = await client.getUpdates(account, deps.cursor(), AbortSignal.any([signal, watchdog.signal]), {
						holdMs: deps.holdMs(),
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
					deps.notify(`WeChat poll failed: ${messageOf(error)}`, "warning");
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
				if (response.timeoutMs !== undefined && response.timeoutMs > 0) serverHint = response.timeoutMs;
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
				const next = response.buf;
				if (next && next !== deps.cursor()) {
					deps.setCursor(next);
					deps.saveState();
				}
				deps.onMessages(response.msgs);
				deps.refreshLock();
				deps.onPoll?.({ at: deps.now(), holdMs: serverHint ?? deps.holdMs() });
			}
		},
	};
}
